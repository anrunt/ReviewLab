import { chmod, mkdir, open, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT, withAbortSignal, type Context } from "@earendil-works/chord/context";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import {
  AssistantEntry,
  createRegistry,
  defineExtension,
  Harness,
  type Conversation,
  type ConversationId,
  type HarnessOptions,
  type Registry,
  type Storage,
  type SubmissionRecord,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { getConversationModelRuntime, getDataDir } from "./auth.js";
import { ReviewDoc, type ReviewInput } from "./review-state.js";
import { createSnapshotListTool, createSnapshotReadTool, createSnapshotSearchTool } from "./snapshot-tools.js";
import { getSnapshotPath } from "./snapshot.js";

const MODEL = { provider: "openai", modelId: "gpt-6.1-sol" };

const CONVERSATION_TIMEOUT_MS = 150_000;

// Only these application-authored messages may reach the CLI. Raw provider and
// storage errors can include sensitive details and are not printed.
class ConversationError extends Error {}

export type PreparedConversation = {
  conversation: Conversation;
  close: () => Promise<void>;
};

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

async function openConversationHarness(models: HarnessOptions["models"]) {
  const dataDir = getDataDir();
  const databasePath = join(dataDir, "conversations.sqlite");
  const lockPath = join(dataDir, "conversations.lock");
  const context = withAbortSignal(AbortSignal.timeout(CONVERSATION_TIMEOUT_MS), BACKGROUND_CONTEXT);
  const registry = createRegistry();

  const options: HarnessOptions = {
    models,
    registry,
    identity: { attribution: null, userAgent: { custom: "ReviewLab" } },
    settings: {
      stream: { timeoutMs: 60_000, maxRetries: 0, deferred: false },
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 1_000, maxAgentDelayMs: 5_000 },
      compaction: { enabled: true },
      afterFailedRun: "withdraw",
    },
  };

  let ownsLock = false;
  let storage: Storage | undefined;
  let harness: Harness | undefined;

  async function close() {
    try {
      // Closing the Harness also closes its storage. Use a fresh context.
      if (harness) {
        await harness.close(BACKGROUND_CONTEXT);
        harness = undefined;
        storage = undefined;
      } else if (storage) {
        await storage.close(BACKGROUND_CONTEXT);
        storage = undefined;
      }

      if (ownsLock) {
        await rmdir(lockPath);
        ownsLock = false;
      }
    } catch {
      throw new ConversationError("Could not cleanly close conversation storage or release its lock. Confirm no process is using the database before removing conversations.lock.");
    }
  }

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

    return { harness, context, registry, close };
  } catch (error) {
    await close();

    if (error instanceof ConversationError) {
      throw error;
    }

    throw new ConversationError("Failed to open conversation storage. Check the application data directory, permissions and available disk space.");
  }
}

async function getReviewModels() {
  const models = await getConversationModelRuntime();

  if (!models.getModel(MODEL.provider, MODEL.modelId)) {
    throw new ConversationError("openai/gpt-6.1-sol is not in the installed model catalog. No alternative model will be selected.");
  }

  return models;
}

async function ensureNoPendingWork(harness: Harness, context: Context) {
  const pending = await harness.inspect(context);

  if (pending.tasks.length > 0 || pending.submissions.length > 0) {
    throw new ConversationError("The database contains unfinished work. It will not be resumed automatically and no new request will be submitted. Keep the database for explicit recovery.");
  }
}

async function configureSnapshotTools(conversation: Conversation, registry: Registry, context: Context) {
  const snapshotPath = getSnapshotPath(conversation.id);

  const tools = [
    createSnapshotReadTool(snapshotPath),
    createSnapshotListTool(snapshotPath),
    createSnapshotSearchTool(snapshotPath),
  ];

  registry.install(defineExtension({ name: "repo_snapshot", tools }));

  await conversation.configure({ tools }, context);
}

export async function openReviewConversation(reviewId: ConversationId) {
  let models: Models = createModels();
  const { harness, context, registry, close } = await openConversationHarness(() => models);

  try {
    const conversation = await harness.conversation(reviewId, context);

    if (!conversation) {
      throw new ConversationError(`Review ${reviewId} not found.`);
    }

    const state = await harness.snapshot(ReviewDoc, conversation.id, context);

    const input = state?.input;

    if (!state || !input) {
      throw new ConversationError(`Review ${reviewId} has no saved review input.`);
    }

    const startAnalysis = async () => {
      const analysisContext = withAbortSignal(AbortSignal.timeout(CONVERSATION_TIMEOUT_MS), BACKGROUND_CONTEXT);

      try {
        // Submitting enables scheduling for the whole Harness. We only have
        // the snapshot tools for this review loaded here.
        await ensureNoPendingWork(harness, analysisContext);
        models = await getReviewModels();
        await configureSnapshotTools(conversation, registry, analysisContext);
      } catch (error) {
        if (error instanceof ConversationError) {
          throw error;
        }

        throw new ConversationError("Failed to prepare the saved review for analysis. Check model login and conversation storage.");
      }

      return submitConversation(conversation, JSON.stringify(input.files));
    };

    return { conversation, state: { ...state, input }, startAnalysis, close };
  } catch (error) {
    await close();

    if (error instanceof ConversationError) {
      throw error;
    }

    throw new ConversationError("Failed to read saved review state.");
  }
}

export async function prepareConversation(input: ReviewInput): Promise<PreparedConversation> {
  const models = await getReviewModels();
  const { harness, context, registry, close } = await openConversationHarness(models);

  try {
    await ensureNoPendingWork(harness, context);

    const conversation = await harness.createConversation({
      ownership: { kind: "ownerless" },
      agent: { model: MODEL, thinkingLevel: "high", instructions: input.systemPrompt, tools: [] },
      init: async (tx, conversationId) => {
        const state = await tx.doc(ReviewDoc, conversationId);

        state.input = input;
      },
    }, context);

    await configureSnapshotTools(conversation, registry, context);

    return { conversation, close };
  } catch (error) {
    await close();

    if (error instanceof ConversationError) {
      throw error;
    }

    throw new ConversationError("Failed to prepare the conversation. Check the application data directory, permissions and available disk space.");
  }
}

export async function submitConversation(conversation: Conversation, content: string) {
  if (!content.trim()) {
    throw new ConversationError("Conversation input must not be empty.");
  }

  const controller = new AbortController();
  let timedOut = false;
  let submissionInProgress = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CONVERSATION_TIMEOUT_MS);

  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  const context = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);

  try {
    const requestId = await conversation.commit(async (tx) => {
      const state = await tx.doc(ReviewDoc, conversation.id);

      if (!state.input) {
        throw new ConversationError("The review input has not been saved.");
      }

      if (state.stage !== "snapshot_ready" && state.stage !== "analyzing") {
        throw new ConversationError("The repository snapshot is not ready for analysis.");
      }

      if (state.requestId === null) {
        state.requestId = `review-${conversation.id}:analysis:1`;
      }

      state.stage = "analyzing";
      state.lastError = null;

      return state.requestId;
    }, context);

    submissionInProgress = true;
    const submission = await conversation.submit({ type: "input", content, requestId }, context);
    const settled = await submission.wait(context);
    submissionInProgress = false;

    if (settled.status === "unanswered") {
      if (settled.reason === "model_error" || settled.reason === "no_model") {
        throw new ConversationError("OpenAI did not complete the request. Check OAuth login, model access, quota and connectivity. No model or API-key fallback was used.");
      }

      throw new ConversationError("The input was saved but ended without an answer.");
    }

    const text = await readAnswer(conversation, settled, context);

    return { text };
  } catch (error) {
    if (submissionInProgress) {
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

    throw new ConversationError("Failed to run or read the conversation. Check the application data directory, permissions and available disk space.");
  } finally {
    clearTimeout(timeout);
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
