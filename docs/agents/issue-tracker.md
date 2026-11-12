# Issue tracker: Local Markdown

Specs and issues for this repository are stored in `.scratch/`.

## Conventions

- One directory per feature: `.scratch/<feature-slug>/`.
- Spec: `.scratch/<feature-slug>/spec.md`.
- Each implementation issue has its own file:
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`.
- Issue numbering starts at `01`.
- Record the triage status as a `Status:` line near the top of the file.
  See `triage-labels.md` for the available values.
- Append comments and conversation history under `## Comments` at the end
  of the file.

## Publishing and reading issues

When a skill says to publish a spec or issue to the issue tracker,
create the appropriate file using the conventions above.

When a skill says to fetch an issue, read the referenced file.
Resolve an issue number within the specified feature; if the reference
is ambiguous, ask for the file path.

## Operations for /wayfinder

- Map: `.scratch/<effort>/map.md`, with Notes, Decisions-so-far,
  and Fog sections.
- Each question or task has its own file:
  `.scratch/<effort>/issues/<NN>-<slug>.md`.
- `Type:` is `research`, `prototype`, `grilling`, or `task`.
- /wayfinder tasks use a separate `Status:` lifecycle:
  `open`, `claimed`, `resolved`.
- Record dependencies as `Blocked by: NN, NN`.
  A task is unblocked when all its dependencies have status `resolved`.
- Select the first open, unblocked task by number.
- Before starting work, save `Status: claimed`.
- When finished, append the result under `## Answer`, set `Status: resolved`,
  and add a summary with a link to Decisions-so-far in the map.
