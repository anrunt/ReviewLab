import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

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
