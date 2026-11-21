import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ConversationId } from "@earendil-works/pi-durable";
import { Octokit } from "octokit";
import { extract } from "tar";
import { getDataDir } from "./auth.js";

export async function downloadSnapshot(reviewId: ConversationId, owner: string, repo: string, head_sha: string, token: string) {
  const octokit = new Octokit({
    auth: token,
    throttle: {
      onRateLimit: () => false,
      onSecondaryRateLimit: () => false,
    },
  });

  const snapshotPath = getSnapshotPath(reviewId);

  const response = await octokit.rest.repos.downloadTarballArchive({
    owner,
    repo,
    ref: head_sha,
  });

  const archiveData: unknown = response.data;

  if (!(archiveData instanceof ArrayBuffer)) {
    throw new Error("GitHub returned an invalid repository archive.");
  }

  await rm(snapshotPath, { recursive: true, force: true });
  await mkdir(snapshotPath, { recursive: true, mode: 0o700 });

  await pipeline(
    Readable.from([Buffer.from(archiveData)]),
    extract({
      cwd: snapshotPath,
      strip: 1,
      strict: true,
      preserveOwner: false,
    }),
  );

  return snapshotPath;
}

export function getSnapshotPath(reviewId: ConversationId) {
  if (!Number.isSafeInteger(reviewId) || reviewId <= 0) {
    throw new Error("Snapshot review ID must be a positive safe integer.");
  }

  return join(getDataDir(), "snapshots", String(reviewId), "snapshot");
}
