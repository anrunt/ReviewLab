import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { devNull } from "node:os";
import { dirname } from "node:path";

const MAX_PATCH_LINES = 30;

export async function validateReviewPatch(
  snapshotPath: string,
  filePath: string,
  diff: string,
  signal: AbortSignal | undefined,
) {
  const snapshotDirectory = await realpath(snapshotPath).catch(() => {
    throw new Error("Could not access the review snapshot to validate the patch.");
  });

  const details = await runGitApply(snapshotDirectory, diff, ["--numstat", "--summary", "-z"], signal);

  if (details === null) {
    throw new Error("Git could not read the proposed diff.");
  }

  const [statistics, summary, ...otherEntries] = details.split("\0");

  if (!statistics || summary === undefined || otherEntries.length > 0) {
    throw new Error("Patch must change exactly one file.");
  }

  if (summary.startsWith(" rename ") || summary.startsWith(" copy ")) {
    throw new Error("Patch must change one file without renaming or copying it.");
  }

  const match = /^(\d+)\t(\d+)\t([\s\S]+)$/.exec(statistics);

  if (!match) {
    throw new Error("Patch must contain text changes with countable lines.");
  }

  const [, addedLines, removedLines, patchPath] = match;

  if (patchPath !== filePath) {
    throw new Error(`Patch changes ${JSON.stringify(patchPath)}, but the finding points to ${JSON.stringify(filePath)}.`);
  }

  const changedLines = Number(addedLines) + Number(removedLines);

  if (changedLines > MAX_PATCH_LINES) {
    throw new Error(`Patch changes ${changedLines} lines. The maximum is ${MAX_PATCH_LINES}.`);
  }

  const check = await runGitApply(snapshotDirectory, diff, ["--check"], signal);

  if (check === null) {
    throw new Error(`Patch does not apply to ${JSON.stringify(filePath)} in the review snapshot.`);
  }
}

function runGitApply(snapshotPath: string, diff: string, options: string[], signal: AbortSignal | undefined) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

  env.GIT_CEILING_DIRECTORIES = dirname(snapshotPath);
  env.GIT_CONFIG_GLOBAL = devNull;
  env.GIT_CONFIG_NOSYSTEM = "1";

  return new Promise<string | null>((resolve, reject) => {
    let inputFailed = false;

    const child = execFile("git", ["apply", ...options, "-"], { cwd: snapshotPath, env, signal }, (error, stdout) => {
      if (error && typeof error.code === "number") {
        resolve(null);

        return;
      }

      if (error || inputFailed) {
        reject(new Error("Could not run Git to validate the patch. Check that Git is installed and the snapshot is accessible."));

        return;
      }

      resolve(stdout);
    });

    child.stdin?.once("error", () => {
      inputFailed = true;
    });
    child.stdin?.end(diff);
  });
}
