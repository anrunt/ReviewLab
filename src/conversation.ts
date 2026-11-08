import { chmod, mkdir, open, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT, withAbortSignal, type Context } from "@earendil-works/chord/context";
import {
  AssistantEntry,
  createRegistry,
  Harness,
  type Conversation,
  type HarnessOptions,
  type Storage,
  type SubmissionRecord,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { getConversationModelRuntime, getDataDir } from "./auth.js";

const MODEL = { provider: "openai", modelId: "gpt-6.1-sol" };

const CONVERSATION_TIMEOUT_MS = 150_000;

// Only these application-authored messages may reach the CLI. Raw provider and
// storage errors can include sensitive details and are not printed.
class ConversationError extends Error {}

async function readAnswer(
  conversation: Conversation,
  record: SubmissionRecord,
  context: Context,
) {
  if (record.type !== "input" || record.status !== "done" || record.conversationId !== conversation.id) {
    throw new ConversationError("The saved submission does not contain a completed answer.");
  }

  const answer = await conversation.commit(
    (tx) => tx.entry(AssistantEntry, record.answer),
    context,
  );

  const response = answer?.model?.[0];

  if (response?.role !== "assistant") {
    throw new ConversationError("The saved answer is missing or invalid.");
  }

  if (response.stopReason !== "stop") {
    throw new ConversationError("The model did not return a complete final answer.");
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new ConversationError("The model completed without a text answer.");
  }

  return text;
}

export async function runConversation(content: string) {
  if (!content.trim()) {
    throw new ConversationError("Conversation input must not be empty.");
  }

  // This helper exposes only sanitized errors and uses a bounded auth operation.
  const models = await getConversationModelRuntime();

  if (!models.getModel(MODEL.provider, MODEL.modelId)) {
    throw new ConversationError("openai/gpt-6.1-sol is not in the installed model catalog. No alternative model will be selected.");
  }

  const dataDir = getDataDir();
  const databasePath = join(dataDir, "conversations.sqlite");
  const lockPath = join(dataDir, "conversations.lock");
  const controller = new AbortController();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CONVERSATION_TIMEOUT_MS);

  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  const context = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);

  const options: HarnessOptions = {
    models,
    registry: createRegistry(),
    identity: { attribution: null, userAgent: { custom: "ReviewLab" } },
    settings: {
      stream: { timeoutMs: 60_000, maxRetries: 0, deferred: false },
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 1_000, maxAgentDelayMs: 5_000 },
      compaction: { enabled: false },
      afterFailedRun: "withdraw",
    },
  };

  let ownsLock = false;
  let storage: Storage | undefined;
  let harness: Harness | undefined;
  let conversation: Conversation | undefined;
  let workSettled = false;

  try {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });

    if (((await stat(dataDir)).mode & 0o077) !== 0) {
      throw new ConversationError("The application data directory must be private (permissions 0700). Set its permissions before running a conversation.");
    }

    try {
      // Durable's SQLite adapter does not coordinate multiple Harness owners.
      await mkdir(lockPath, { mode: 0o700 });
      ownsLock = true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new ConversationError("Conversation storage is locked. Stop the other conversation process first. After a crash, remove conversations.lock from the application data directory only after confirming no process is using it.");
      }

      throw error;
    }

    // Create privately before SQLite opens it; SQLite's WAL/SHM inherit DB mode.
    const file = await open(databasePath, "a", 0o600);

    try {
      await file.chmod(0o600);
    } finally {
      await file.close();
    }

    // Existing sidecars from an interrupted process must also remain private.
    for (const suffix of ["-wal", "-shm"]) {
      try {
        await chmod(`${databasePath}${suffix}`, 0o600);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      }
    }

    storage = await openNodeSqliteStorage(databasePath);
    harness = await Harness.open(storage, options, context);
    const pending = await harness.inspect(context);

    if (pending.tasks.length > 0 || pending.submissions.length > 0) {
      throw new ConversationError("The database contains unfinished work. It will not be resumed automatically and no new request will be submitted. Keep the database for explicit recovery.");
    }

    conversation = await harness.createConversation({
      ownership: { kind: "ownerless" },
      agent: { model: MODEL, thinkingLevel: "high", tools: [] },
    }, context);
    const submission = await conversation.submit({ type: "input", content }, context);
    const settled = await submission.wait(context);
    workSettled = true;

    if (settled.status === "unanswered") {
      if (settled.reason === "model_error" || settled.reason === "no_model") {
        throw new ConversationError("OpenAI did not complete the request. Check OAuth login, model access, quota and connectivity. No model or API-key fallback was used.");
      }

      throw new ConversationError("The input was saved but ended without an answer.");
    }

    const text = await readAnswer(conversation, settled, context);

    return {
      text,
      conversationId: conversation.id,
      submissionId: submission.id,
      databasePath,
    };
  } catch (error) {
    if (conversation && !workSettled) {
      try {
        // Cancelling wait() alone does not stop generation. Use a fresh cleanup
        // context to persist the abort and signal the actual model request.
        await conversation.abort(withAbortSignal(AbortSignal.timeout(10_000), BACKGROUND_CONTEXT));
      } catch {
        throw new ConversationError("Could not confirm that the conversation stopped. Storage will be closed; unfinished work may remain for explicit recovery.");
      }
    }

    if (controller.signal.aborted) {
      throw new ConversationError(timedOut ? "Conversation exceeded its 150-second time limit." : "Conversation cancelled.");
    }

    if (error instanceof ConversationError) {
      throw error;
    }

    throw new ConversationError("Failed to open, run or read the conversation. Check the application data directory, permissions and available disk space.");
  } finally {
    try {
      // Close also interrupts running tasks. Do not pass the cancelled context.
      if (harness) {
        await harness.close(BACKGROUND_CONTEXT);
      } else if (storage) {
        await storage.close(BACKGROUND_CONTEXT);
      }

      if (ownsLock) {
        await rmdir(lockPath);
      }
    } catch {
      throw new ConversationError("Could not cleanly close conversation storage or release its lock. Confirm no process is using the database before removing conversations.lock.");
    } finally {
      clearTimeout(timeout);
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
    }
  }
}
