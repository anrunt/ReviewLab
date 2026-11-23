# General instructions

- Write code only when the user asks for it.
- Before writing code, list exactly what you will change and why.
- Do not commit changes or write tests unless the user explicitly asks for it.
- Prefer explicit control flow and clear code. Add abstractions only when they provide a concrete benefit. Do not shorten code at the expense of readability.
- Put the main functions first in each file, followed by the helpers they call. Preserve any declaration order required for initialization.
- Before proposing or implementing a new mechanism, check whether the project's existing libraries already provide it. Prefer their built-in capabilities over custom solutions, and explain any gaps before suggesting additional work.
- When talking about some code, show relevant code snippets in chat, not just line numbers where it is.
- Use established terms. When introducing a new term, explain what it means in context the first time you use it.

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
