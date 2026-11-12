# General instructions

- Write code only when the user asks for it.
- Before writing code, list exactly what you will change and why.
- Do not commit changes or write tests unless the user explicitly asks for it.
- Prefer explicit control flow and clear code. Add abstractions only when they provide a concrete benefit. Do not shorten code at the expense of readability.

## Agent skills

### Issue tracker

Specs and issues are stored locally as Markdown files under `.scratch/`.
Before creating, reading, or updating issues, read
`docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage statuses. Before triaging or changing an issue's status,
read `docs/agents/triage-labels.md`.

### Domain docs

This project has a single domain context: `GLOSSARY.md` and `docs/adr/`.
Before exploring the codebase, read `docs/agents/domain.md`.
