import { defineTool, type ConversationId } from "@earendil-works/pi-durable";
import { z } from "zod";
import { validateReviewPatch } from "./review-patch.js";
import { reviewReportSchema } from "./review-report.js";
import { readSnapshotFile } from "./snapshot-tools.js";
import { getSnapshotPath } from "./snapshot.js";

export const submitReviewReportTool = defineTool({
  name: "submit_review_report",
  description: "Submit the complete review report after finishing the analysis.",
  parameters: z.toJSONSchema(reviewReportSchema, { io: "input" }),
  async execute(args, api, context) {
    await submitReviewReport(args, api.conversationId, context.abortSignal);

    return {
      output: [{ type: "text", text: "Review report structure, locations and proposed diffs validated." }],
    };
  },
});

async function submitReviewReport(input: unknown, conversationId: ConversationId, signal: AbortSignal | undefined) {
  const report = reviewReportSchema.parse(input);
  const snapshotPath = getSnapshotPath(conversationId);

  for (const { filePath, line, fix } of report.findings) {
    let content: string;

    try {
      content = await readSnapshotFile(snapshotPath, filePath);
    } catch {
      throw new Error(`Could not read ${JSON.stringify(filePath)} from the review snapshot.`);
    }

    const lines = content.split("\n");

    if (lines.at(-1) === "") {
      lines.pop();
    }

    if (line > lines.length) {
      throw new Error(`Line ${line} is outside ${JSON.stringify(filePath)}, which has ${lines.length} lines.`);
    }

    if (fix.type === "diff") {
      await validateReviewPatch(snapshotPath, filePath, fix.diff, signal);
    }
  }

  return report;
}
