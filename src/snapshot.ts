import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Octokit } from "octokit";
import { extract } from "tar";
import { getDataDir } from "./auth.js";

export async function downloadSnapshot(reviewId: string, owner: string, repo: string, head_sha: string, token: string) {
  const octokit = new Octokit({
    auth: token,
    throttle: {
      onRateLimit: () => false,
      onSecondaryRateLimit: () => false,
    },
  });

  const snapshotPath = join(getDataDir(), "snapshots", reviewId, "snapshot");

  await mkdir(snapshotPath, { recursive: true, mode: 0o700 });

  const response = await octokit.rest.repos.downloadTarballArchive({
    owner,
    repo,
    ref: head_sha,
  });

  const archiveData: unknown = response.data;

  if (!(archiveData instanceof ArrayBuffer)) {
    throw new Error("GitHub returned an invalid repository archive.");
  }

  await pipeline(
    Readable.from([Buffer.from(archiveData)]),
    extract({
      cwd: snapshotPath,
      // GitHub wraps repository files in one top-level directory.
      strip: 1,
      strict: true,
      preserveOwner: false,
    }),
  );

  return snapshotPath;
}
