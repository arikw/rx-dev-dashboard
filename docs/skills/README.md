# Skills

Repeatable, opinionated walkthroughs for tasks an AI assistant (Claude, Cursor,
Cline, GitHub Copilot Chat, …) or a human contributor will want to do but
might forget a step on. Each file is a self-contained markdown document with
YAML frontmatter for machine readability.

## Format

```markdown
---
name: <skill-slug>
description: <one-line summary — used by tools that index skills>
audience: <who this is written for>
---

# Human-readable title

Body — step-by-step instructions, schemas, examples, pitfalls.
```

The frontmatter is optional from a rendering standpoint (any markdown viewer
ignores it) but useful for tools that want to enumerate skills by name and
description. Claude Code, in particular, will treat `name` and `description`
as the skill's slash-command identifier and tooltip if these files are
symlinked or referenced from `.claude/skills/`.

## Available skills

- **[add-manual-entry.md](add-manual-entry.md)** — add a `ManualProject` (a
  project no connector covers) or a `ManualOrigin` (an authoritative
  override of a scraped number) to the dashboard config.

## Adding a new skill

1. Drop a new `<skill-name>.md` here with the frontmatter above.
2. Link it from `README.md` and from this index.
3. Keep the body action-oriented: what to ask the user, what files to edit,
   what to verify after.
