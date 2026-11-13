import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export async function validateSnapshotFilePath(snapshotPath: string, filePath: string) {
  if (isAbsolute(filePath)) {
    throw new Error("Snapshot file path must be relative.");
  }

  const realSnapshotPath = await realpath(snapshotPath);
  const realFilePath = await realpath(join(realSnapshotPath, filePath));
  const relativeFilePath = relative(realSnapshotPath, realFilePath);

  if (relativeFilePath === "") {
    throw new Error("Snapshot file path must point to a file, not the snapshot directory.");
  }

  if (
    relativeFilePath === ".." ||
    relativeFilePath.startsWith(`..${sep}`) ||
    isAbsolute(relativeFilePath)
  ) {
    throw new Error("Snapshot file path must stay within the snapshot directory.");
  }

  const fileStats = await stat(realFilePath);

  if (!fileStats.isFile()) {
    throw new Error("Snapshot file path must point to a regular file.");
  }

  return realFilePath;
}
