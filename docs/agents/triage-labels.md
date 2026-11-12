# Triage statuses

In the local tracker, record triage roles in the issue's `Status:` field.

| Skill role | Status value | Meaning |
| --- | --- | --- |
| needs-triage | needs-triage | The issue needs evaluation by the project maintainer. |
| needs-info | needs-info | More information is needed from the reporter. |
| ready-for-agent | ready-for-agent | The issue is ready for an agent to implement independently. |
| ready-for-human | ready-for-human | The issue requires human implementation. |
| wontfix | wontfix | The issue will not be implemented. |

When a skill says to apply a triage label, set the corresponding `Status:`
value in the issue file. An issue being ready does not replace the user's
authorization to write code required by AGENTS.md.
