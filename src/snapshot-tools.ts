import { spawn } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { rgPath } from "@vscode/ripgrep";
import { z } from "zod";
import { getRepositoryFileText, MAX_REPOSITORY_FILE_BYTES } from "./github.js";
import type { ReviewInput } from "./review-state.js";

const ripgrepEventSchema = z.object({
  type: z.string(),
  data: z.unknown(),
});

const ripgrepMatchDataSchema = z.object({
  path: z.object({ text: z.string() }),
  lines: z.object({ text: z.string() }),
  line_number: z.number().int().positive(),
});

type SnapshotTextMatch = {
  filePath: string;
  lineNumber: number;
  line: string;
};

class SnapshotFilePathError extends Error {}

export async function validateSnapshotFilePath(snapshotPath: string, filePath: string) {
  if (isAbsolute(filePath)) {
    throw new SnapshotFilePathError("Snapshot file path must be relative.");
  }

  const realSnapshotPath = await realpath(snapshotPath);
  const realFilePath = await realpath(join(realSnapshotPath, filePath));
  const relativeFilePath = relative(realSnapshotPath, realFilePath);

  if (relativeFilePath === "") {
    throw new SnapshotFilePathError("Snapshot file path must point to a file, not the snapshot directory.");
  }

  if (
    relativeFilePath === ".." ||
    relativeFilePath.startsWith(`..${sep}`) ||
    isAbsolute(relativeFilePath)
  ) {
    throw new SnapshotFilePathError("Snapshot file path must stay within the snapshot directory.");
  }

  const fileStats = await stat(realFilePath);

  if (!fileStats.isFile()) {
    throw new SnapshotFilePathError("Snapshot file path must point to a regular file.");
  }

  return realFilePath;
}

export async function readSnapshotFile(snapshotPath: string, filePath: string) {
  const validatedFilePath = await validateSnapshotFilePath(snapshotPath, filePath);
  const content = await readFile(validatedFilePath, "utf8");

  return content;
}

export async function listSnapshotFiles(snapshotPath: string) {
  const realSnapshotPath = await realpath(snapshotPath);

  const entries = await readdir(realSnapshotPath, {
    recursive: true,
    withFileTypes: true,
  });

  const files: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }

    const candidatePath = join(entry.parentPath, entry.name);
    const filePath = relative(realSnapshotPath, candidatePath);

    try {
      await validateSnapshotFilePath(realSnapshotPath, filePath);
    } catch (error) {
      if (entry.isSymbolicLink()) {
        if (error instanceof SnapshotFilePathError) {
          continue;
        }

        if (
          error instanceof Error && "code" in error && (
            error.code === "ENOENT" ||
            error.code === "ENOTDIR" ||
            error.code === "ELOOP"
          )
        ) {
          continue;
        }
      }

      throw error;
    }

    files.push(filePath);
  }

  files.sort();

  return files;
}

export async function searchSnapshotText(snapshotPath: string, searchText: string) {
  if (searchText.length === 0) {
    throw new Error("Search text must not be empty.");
  }

  if (searchText.includes("\n") || searchText.includes("\r")) {
    throw new Error("Search text must be a single line.");
  }

  const realSnapshotPath = await realpath(snapshotPath);

  const args = [
    "--json",
    "--fixed-strings",
    "--case-sensitive",
    "--hidden",
    "--no-ignore",
    "--no-config",
    "--no-follow",
    "-e",
    searchText,
    "--",
    ".",
  ];

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(rgPath, args, {
      cwd: realSnapshotPath,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.once("error", reject);

    child.once("close", (code, signal) => {
      if (code === 0 || code === 1) {
        resolve(stdout);

        return;
      }

      if (signal) {
        reject(new Error(`Ripgrep was terminated by signal ${signal}.`));

        return;
      }

      const message = stderr.trim() || `Ripgrep failed with exit code ${code}.`;
      reject(new Error(message));
    });
  });

  const matches: SnapshotTextMatch[] = [];

  for (const jsonLine of stdout.split("\n")) {
    if (jsonLine.length === 0) {
      continue;
    }

    const event = ripgrepEventSchema.parse(JSON.parse(jsonLine));

    if (event.type !== "match") {
      continue;
    }

    const data = ripgrepMatchDataSchema.parse(event.data);

    matches.push({
      filePath: data.path.text.replace(/^\.[\\/]/, ""),
      lineNumber: data.line_number,
      line: data.lines.text.replace(/\r?\n$/, ""),
    });
  }

  return { matches };
}

export function createSnapshotSearchTool(snapshotPath: string) {
  return defineTool({
    name: "search_repo_snapshot_text",
    description: "Search for literal, case-sensitive text in the reviewed repository snapshot. Returns a JSON object with a matches array containing filePath, lineNumber, and line for each matching line.",
    parameters: Type.Object({
      searchText: Type.String({
        minLength: 1,
        description: "Literal text to search for. Must be a single line, not a regular expression.",
      }),
    }),
    execute: async ({ searchText }) => {
      const result = await searchSnapshotText(snapshotPath, searchText);

      return {
        output: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  });
}

export function createSnapshotListTool(snapshotPath: string) {
  return defineTool({
    name: "list_repo_snapshot_files",
    description: "List file paths in the repository snapshot at the reviewed PR head commit. Returns alphabetically sorted paths relative to the snapshot root, one per line. Returned paths can be passed to read_repo_snapshot_file when additional context is needed.",
    parameters: Type.Object({}),
    execute: async () => {
      const files = await listSnapshotFiles(snapshotPath);

      if (files.length === 0) {
        return {
          output: [{ type: "text", text: "No files found in the repository snapshot." }],
        };
      }

      return {
        output: [{ type: "text", text: files.join("\n") }],
      };
    },
  });
}

export function createSnapshotReadTool(snapshotPath: string) {
  return defineTool({
    name: "read_repo_snapshot_file",
    description: "Read the complete UTF-8 contents of a file from the repository snapshot at the reviewed PR head commit. Use this to inspect code and gather context for the review.",
    parameters: Type.Object({
      filePath: Type.String({
        minLength: 1,
        description: "File path relative to the repository snapshot root.",
      }),
    }),
    execute: async ({ filePath }) => {
      const content = await readSnapshotFile(snapshotPath, filePath);

      return {
        output: [{ type: "text", text: content }],
      };
    },
  });
}

export function createMergeBaseReadTool(input: Pick<ReviewInput, "owner" | "repo" | "mergeBaseSha">) {
  return defineTool({
    name: "read_merge_base_file",
    description: "Read the complete UTF-8 text of one file at the review's merge base. Use this when you need to inspect the previous version of a file. For a renamed file, use its old path. Files added by the PR may be absent at the merge base.",
    replay: "safe",
    parameters: Type.Object({
      filePath: Type.String({
        minLength: 1,
        description: "Path to the file relative to the repository root at the merge base.",
      }),
    }),
    outputLimits: {
      maxBytes: MAX_REPOSITORY_FILE_BYTES,
      maxLines: MAX_REPOSITORY_FILE_BYTES + 1,
    },
    execute: async ({ filePath }, _api, context) => {
      const token = process.env.GITHUB_TOKEN;

      if (!token?.trim()) {
        throw new Error("Missing GITHUB_TOKEN. Historical file contents are unavailable.");
      }

      const text = await getRepositoryFileText({
        token,
        owner: input.owner,
        repo: input.repo,
        filePath,
        ref: input.mergeBaseSha,
        signal: context.abortSignal,
      });

      return { output: [{ type: "text", text }] };
    },
  });
}
