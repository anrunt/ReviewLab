import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { Writable } from "node:stream";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { CredentialSynchronizationError, ModelRuntime } from "@earendil-works/pi-coding-agent";

const supportedProviderIds = [
  "anthropic",
  "openai",
  "openai-codex",
  "github-copilot",
  "openrouter",
];

function getDataDir() {
  const configuredDataDir = process.env.AI_REVIEWER_DATA_DIR?.trim();
  return configuredDataDir
    ? resolve(configuredDataDir)
    : join(homedir(), ".local", "share", "ai-reviewer");
}

export async function getModelRuntime() {
  const runtime = await ModelRuntime.create({
    authPath: join(getDataDir(), "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });

  return runtime;
}

export async function getAuthStatus() {
  try {
    const runtime = await getModelRuntime();
    // Passing a signal makes storage read errors propagate instead of falling
    // back to a cached snapshot. It also bounds waiting for the file lock.
    const credentials = await runtime.listCredentials({
      signal: AbortSignal.timeout(10_000),
    });

    return credentials
      .filter((credential) => supportedProviderIds.includes(credential.providerId))
      .map((credential) => {
        if (credential.type !== "oauth" && credential.type !== "api_key") {
          throw new Error("Invalid saved credential type.");
        }

        return {
          providerId: credential.providerId,
          name: runtime.getProvider(credential.providerId)?.name ?? credential.providerId,
          credentialType: credential.type,
        };
      });
  } catch {
    throw new Error("Failed to read authentication status. Check the application data directory, saved credentials and file permissions.");
  }
}

export async function logout(providerId: string) {
  if (!supportedProviderIds.includes(providerId)) {
    throw new Error(`Unsupported provider. Choose one of: ${supportedProviderIds.join(", ")}.`);
  }

  try {
    const runtime = await getModelRuntime();
    const credentials = await runtime.listCredentials({
      signal: AbortSignal.timeout(10_000),
    });
    const hasSavedCredentials = credentials.some((entry) => entry.providerId === providerId);
    if (!hasSavedCredentials) {
      return false;
    }

    await runtime.logout(providerId, { signal: AbortSignal.timeout(10_000) });
    return true;
  } catch (error) {
    if (error instanceof CredentialSynchronizationError) {
      throw new Error("Local credentials were removed, but runtime synchronization did not complete. Run auth status to check saved credentials.");
    }
    throw new Error("Failed to clear local credentials. Check the application data directory, saved credentials and file permissions.");
  }
}

function getInstallationId() {
  const dataDir = getDataDir();
  const idPath = join(dataDir, "installation-id");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  try {
    // Exclusive creation preserves the existing ID, including across processes.
    writeFileSync(idPath, randomUUID(), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
  }

  const id = readFileSync(idPath, "utf8").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Invalid installation ID.");
  }

  return id;
}

async function selectOption(
  terminal: Interface,
  message: string,
  options: readonly { id: string; label: string }[],
  signal: AbortSignal,
) {
  if (options.length === 0) {
    throw new Error("No login options are available.");
  }

  console.log(message);
  for (const [index, option] of options.entries()) {
    console.log(`${index + 1}. ${option.label}`);
  }

  const answer = (await terminal.question("Option number: ", { signal })).trim();
  if (!/^[1-9]\d*$/.test(answer)) {
    throw new Error(`Enter a number from 1 to ${options.length}.`);
  }

  const number = Number(answer);
  if (!Number.isSafeInteger(number) || number > options.length) {
    throw new Error(`Enter a number from 1 to ${options.length}.`);
  }

  const selected = options[number - 1];
  if (!selected) {
    throw new Error("Selected login option is unavailable.");
  }

  return selected.id;
}

export async function login(): Promise<{
  providerId: string;
  status: "completed" | "unchanged";
}> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Login requires an interactive terminal.");
  }

  let runtime: ModelRuntime;
  try {
    runtime = await getModelRuntime();
  } catch {
    throw new Error("Failed to initialize model access. Check the application data directory and its permissions.");
  }

  const controller = new AbortController();
  let hideInput = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (hideInput) {
        callback();
      } else {
        process.stdout.write(chunk, encoding, callback);
      }
    },
  });
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: true,
    historySize: 0,
  });
  const cancel = () => controller.abort();
  terminal.on("SIGINT", cancel);
  terminal.on("close", cancel);
  process.on("SIGINT", cancel);

  let loginStarted = false;
  try {
    const providers = runtime.getProviders().filter((provider) =>
      supportedProviderIds.includes(provider.id) && provider.auth.oauth !== undefined
    );
    const providerId = await selectOption(
      terminal,
      "Select a provider:",
      providers.map((provider) => ({ id: provider.id, label: provider.name })),
      controller.signal,
    );
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (!provider || !supportedProviderIds.includes(provider.id) || !provider.auth.oauth) {
      throw new Error("Selected provider is not supported for OAuth login.");
    }

    let hasSavedCredentials: boolean;
    try {
      const credentials = await runtime.listCredentials({
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      });
      hasSavedCredentials = credentials.some((entry) => entry.providerId === providerId);
    } catch {
      throw new Error("Failed to read saved credentials. Check the application data directory and file permissions.");
    }

    if (hasSavedCredentials) {
      console.log(`Saved credentials already exist for ${provider.name}. Their validity has not been verified.`);
      const confirmation = (await terminal.question(
        "Signing in again will replace them after successful authorization. Continue? [y/N] ",
        { signal: controller.signal },
      )).trim().toLowerCase();

      if (confirmation !== "y" && confirmation !== "yes") {
        return { providerId, status: "unchanged" };
      }
    }

    const interaction: AuthInteraction = {
      signal: controller.signal,
      async prompt(prompt) {
        const signal = prompt.signal
          ? AbortSignal.any([controller.signal, prompt.signal])
          : controller.signal;
        signal.throwIfAborted();

        if (prompt.type === "select") {
          return selectOption(terminal, prompt.message, prompt.options, signal);
        }

        const hidden = prompt.type === "secret" || prompt.type === "manual_code";
        if (hidden) {
          console.log("Input is hidden. Paste the requested value and press Enter.");
        }

        try {
          // question() prints its prompt before input echo is suppressed.
          const answer = terminal.question(`${prompt.message} `, { signal });
          hideInput = hidden;
          return (await answer).trim();
        } finally {
          hideInput = false;
          if (hidden) {
            console.log();
          }
        }
      },
      notify(event) {
        switch (event.type) {
          case "info":
            console.log(event.message);
            for (const link of event.links ?? []) {
              console.log(`${link.label ?? "More information"}: ${link.url}`);
            }
            break;
          case "auth_url":
            console.log(`Open in your browser: ${event.url}`);
            if (event.instructions) {
              console.log(event.instructions);
            }
            break;
          case "device_code":
            console.log(`Open in your browser: ${event.verificationUri}`);
            console.log(`Enter this device code: ${event.userCode}`);
            break;
          case "progress":
            console.log(event.message);
            break;
        }
      },
    };

    loginStarted = true;
    await runtime.login(providerId, "oauth", interaction, {
      agentName: "ReviewLab",
      getDeviceId: getInstallationId,
    });

    return { providerId, status: "completed" };
  } catch (error) {
    if (error instanceof CredentialSynchronizationError) {
      throw new Error("Login credentials were saved, but provider setup did not complete. Run auth login again. This does not confirm access to a model.");
    }
    if (controller.signal.aborted) {
      throw new Error("Login cancelled.");
    }
    if (loginStarted) {
      // Provider errors may contain token endpoint bodies or callback URLs.
      throw new Error("Provider login failed. Check the browser authorization, callback port and application data permissions, then try again.");
    }
    throw error;
  } finally {
    process.off("SIGINT", cancel);
    terminal.close();
    output.end();
  }
}
