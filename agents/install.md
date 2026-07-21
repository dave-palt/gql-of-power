# Installing the gql-of-power agent skill

This directory (`agents/`) contains a cross-tool agent skill that teaches AI coding agents how to scaffold gql-of-power entities, relationships, and advanced features correctly.

The skill content lives in one shared source (`SKILL.md` + `references/` + `templates/`). Each agent tool discovers it differently — pick your tool below.

## What's in here

```
agents/
  SKILL.md                          # core skill (cross-tool YAML frontmatter)
  references/
    relationships.md                # 1:1, 1:m, m:1, m:n annotated examples
    advanced-features.md            # count fields, _exists, mapNumericEnum, parseJson, mapping, excludeFromInput
    metadata-providers.md           # implementing the MetadataProvider interface
  templates/
    entity-skeleton.ts.txt          # copy-paste entity scaffold
  install.md                        # this file
```

## Claude Code

Claude Code auto-loads a `CLAUDE.md` at the project root and discovers skills under `.claude/`.

**Option A — one-off copy (simplest):**

```bash
# from your consumer project root
mkdir -p .claude/skills
cp -R node_modules/@dav3/gql-of-power/agents/ .claude/skills/gql-of-power/
```

**Option B — symlink (tracks gql-of-power updates):**

```bash
mkdir -p .claude/skills
ln -s ../../node_modules/@dav3/gql-of-power/agents .claude/skills/gql-of-power
```

Optional: add a slash command for repeatable scaffolding. Create `.claude/commands/map-entity.md`:

```markdown
---
description: Scaffold a new gql-of-power entity (class + fields + metadata + resolver)
---

Use the gql-of-power skill to create a new entity named $1. Follow the implementation checklist in the skill, using the entity-skeleton template as the starting point. Ask me for the table name, primary key, and any relationships before generating code.
```

Then invoke with `/map-entity Weapon`.

## Cursor

Cursor reads `.cursor/rules/*.mdc` files (Markdown with frontmatter).

**Copy approach:**

```bash
mkdir -p .cursor/rules
cp node_modules/@dav3/gql-of-power/agents/SKILL.md .cursor/rules/gql-of-power.mdc
# also copy the references so they resolve:
cp -R node_modules/@dav3/gql-of-power/agents/references .cursor/rules/gql-of-power-refs
```

Add frontmatter to `.cursor/rules/gql-of-power.mdc` (Cursor format):

```yaml
---
description: gql-of-power entity mapping — relationships, metadata, advanced features
globs: ['src/**/*.ts', 'schema/**', 'graphql/**']
alwaysApply: false
---
```

## Hermes Agent

Hermes auto-discovers skills under `~/.hermes/skills/` (user-local) or a repo-local `skills/` directory.

**Option A — user-local (available in all your projects):**

```bash
ln -s /path/to/gql-of-power/agents ~/.hermes/skills/gql-of-power
# or if gql-of-power is a dependency:
ln -s node_modules/@dav3/gql-of-power/agents ~/.hermes/skills/gql-of-power
```

**Option B — in-repo (committed to your consumer project):**

```bash
mkdir -p skills
cp -R node_modules/@dav3/gql-of-power/agents skills/gql-of-power
```

The SKILL.md frontmatter (`name`, `description`, `metadata.hermes.tags`) is already in the Hermes format.

## Generic (any agent reading AGENTS.md / CLAUDE.md)

Append to your project's `AGENTS.md` or `CLAUDE.md`:

```markdown
## gql-of-power entity mapping

When creating or modifying gql-of-power entities, load the skill at
`node_modules/@dav3/gql-of-power/agents/SKILL.md` and follow its implementation
checklist. Reference docs are in `agents/references/`. Key rules:

- Every entity needs: ORM class + EntityMetadata + FieldsSettings + createGQLTypes + Resolver
- Relationship fields need relatedEntityName (+ array:true for many)
- Relationship filters need `as any` casts in resolver code
- mapNumericEnum fields need registerEnumType + a numeric DB column
```

## Updating

- **Copy approach:** re-run the copy command after upgrading `@dav3/gql-of-power` to pick up skill improvements.
- **Symlink approach:** updates flow automatically — no action needed.

## Verification

After install, confirm the skill is discoverable:

- **Claude Code:** the agent should reference gql-of-power patterns when you ask it to "add an entity." Run `/map-entity <Name>` if you added the slash command.
- **Cursor:** the rule should trigger on edits to `schema/` or `graphql/` files.
- **Hermes:** `skill_view(name='gql-of-power')` returns the SKILL.md content in a fresh session.
