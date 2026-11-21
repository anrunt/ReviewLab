---
name: delete-comment
description: Audit source comments, remove redundant or stale prose, file issues for workarounds, and move decisions to ADRs. Use for /delete-comment or a comment cleanup and lint ratchet.
---

# Delete comments

1. Inventory comments in the requested paths, defaulting to first-party source. Include line, block, and documentation comments. Use parser output, or check search results against the source to distinguish comments from strings and regular expressions. Count physical lines that would disappear, excluding lines that also contain code. Track vendored and generated source separately and check its provenance and maintenance policy before editing it.
2. Read each comment alongside the code it describes. Assign each prose comment a category and act on it:
   - **Tautology** repeats what the code already shows. Delete it.
   - **Stale** describes behavior or constraints that no longer apply. Delete it.
   - **Excuse** explains a workaround worth replacing. Delete it and file a local issue with the affected code, the failure or maintenance cost, and the behavior a fix must preserve. Check the installed libraries for an existing mechanism. Follow `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.
   - **Decision Record** explains a non-obvious choice or constraint. Move the rationale to the relevant ADR under `docs/adr/`. Record the trade-off and keep related decisions together.
3. Identify compiler directives, generated markers, and license notices before deleting anything. Preserve their effect and required notices, and report any that remain. List the planned edits before changing code, following `AGENTS.md`.
4. Keep `.oxlintrc.json` and `project/no-comments` strict for cleaned first-party paths. Expand coverage as more paths reach zero. When onboarding a path with existing comment debt, use an exact baseline by path and comment text, and remove entries as the corresponding comments are deleted.
5. Run `pnpm lint` and check that the application diff contains only the intended removals. Report the category and disposition of every audited comment, the comment-only lines removed, and the remaining line estimate by scope.
