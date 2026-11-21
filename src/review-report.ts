import { win32 } from "node:path";
import { z } from "zod";

export const findingSchema = z.strictObject({
  severity: z.enum(["high", "medium", "low"]),
  filePath: z.string().refine((filePath) => {
    const segments = filePath.split("/");

    return (
      filePath.trim().length > 0 &&
      !win32.isAbsolute(filePath) &&
      !filePath.includes("\\") &&
      !filePath.includes("\0") &&
      segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
    );
  }, "Use a file path relative to the repository root."),
  line: z.int().positive(),
  scenario: z.string().trim().min(1),
  impact: z.string().trim().min(1),
  fix: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("diff"),
      diff: z.string().refine((diff) => diff.trim().length > 0, "Diff must not be empty."),
    }),
    z.strictObject({
      type: z.literal("prompt"),
      prompt: z.string().trim().min(1),
    }),
  ]),
});

export const reviewReportSchema = z.strictObject({
  summary: z.string().trim().min(1),
  findings: z.array(findingSchema),
  limitations: z.string(),
});
