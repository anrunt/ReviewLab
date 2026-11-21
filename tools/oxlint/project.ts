import { definePlugin } from "@oxlint/plugins";

export default definePlugin({
  meta: { name: "project" },
  rules: {
    "no-comments": {
      meta: {
        type: "suggestion",
        docs: { description: "Disallow comments in first-party source files." },
        messages: {
          comment: "Remove this comment. Record a non-obvious decision in an ADR or file an issue for a workaround.",
        },
      },
      createOnce(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              context.report({ loc: comment.loc, messageId: "comment" });
            }
          },
        };
      },
    },
  },
});
