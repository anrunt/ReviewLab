import { defineDoc } from "@earendil-works/pi-durable";
import type { getPullRequest, getPullRequestFiles } from "./github.js";

export type ReviewInput = {
  owner: string;
  repo: string;
  pullRequest: Awaited<ReturnType<typeof getPullRequest>>;
  mergeBaseSha: string;
  files: Awaited<ReturnType<typeof getPullRequestFiles>>;
  systemPrompt: string;
};

export type ReviewState = {
  input: ReviewInput | null;
  stage: "preparing_snapshot" | "snapshot_ready" | "analyzing";
  requestId: string | null;
  lastError: string | null;
};

export const ReviewDoc = defineDoc<ReviewState>({
  kind: "app.review",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({
    input: null,
    stage: "preparing_snapshot",
    requestId: null,
    lastError: null,
  }),
  checkpointWhen: () => false,
});
