# AGENTS.md

## Project

`@dav3/gql-of-power` — TypeScript library that generates a single optimized SQL query from GraphQL operations, eliminating N+1 via recursive field-to-SQL mapping. Framework-agnostic through a `MetadataProvider` interface.

## Commands

| Command                    | Description                                  |
| -------------------------- | -------------------------------------------- |
| `bun run build`            | Compile tsc → dist/                          |
| `bun run typecheck`        | Type-check without emitting                  |
| `bun run format`           | Format all files with Prettier               |
| `bun run test`             | Run all tests                                |
| `bun run test:unit`        | Unit tests only                              |
| `bun run test:integration` | Integration tests only (requires PostgreSQL) |
| `bun run test:watch`       | Watch mode                                   |
| `bun run precommit`        | format → typecheck → test                    |

### Agent commands

| Command   | Description                                                            |
| --------- | ---------------------------------------------------------------------- |
| `/commit` | Run precommit checks, analyze changes, and commit with proper grouping |

## Architecture

```
src/
  index.ts              # public entrypoint (re-exports everything)
  query-manager.ts      # GQLQueryManager — orchestrates parse → map → execute
  operations.ts         # filter operators (_eq, _in, _and, _or, …)
  variables.ts          # env config (D3GOP_SORT_SUFFIX, D3GOP_LOG_TYPE, …)
  entities/
    gql-entity.ts       # @GQLEntityClass decorator, GQLEntityBase, defineFields
  queries/
    gql-to-sql-mapper.ts       # GQLtoSQLMapper — core recursive field→SQL engine
    filter-processor.ts        # FilterProcessor — filter inputs → WHERE clauses
    relationship-handler.ts    # RelationshipHandler — JOIN generation per relation type
    sql-builder.ts             # SQLBuilder — assembles final SQL + param binding
    alias.ts                   # AliasManager — incremental aliases (a1, a2, …)
    utils.ts
  types/                        # all type definitions
  utils/
```

- Query flow: GraphQL resolve info → `GQLtoSQLMapper.recursiveMap()` → `SQLBuilder` → single SQL → `executeQuery()`
- OR conditions are split into separate SELECTs combined with UNION ALL
- **Count fields**: Set `countFieldName` on array relation fields to auto-generate an Int count field via correlated `COUNT(*)` subquery. Also generates filter operators (`bookCount_gt`, etc.). Registry: `CountFieldsMap` in `gql-entity.ts`, accessor `getCountFieldsFor()`.
- **Existence filters**: `_exists` and `_not_exists` are class-level filter operators that generate `EXISTS`/`NOT EXISTS` subqueries for relationship fields. Multiple keys are AND-combined. Auto-generates `EntityExistsFilterInput` types.
- **Numeric enum mapping** (`mapNumericEnum`): TypeScript enums (numeric or string-valued) may store raw values in the DB that GraphQL enums cannot serialize directly. Set `mapNumericEnum: true` on a field to auto-generate a `@FieldResolver` that converts DB values → string keys at GraphQL serialization time, and convert filter values (string keys → raw values) for SQL parameters. The FieldResolver first tries TypeScript's built-in reverse mapping (`Status[913710001] === "Active"`) for numeric enums, then falls back to iterating `Object.keys()` for string-valued enums (e.g., `Frequency["6"]` won't work as a reverse mapping, but iterating finds `Frequency.OnCall === "6"`). Nested entities (via mapping/relations) are handled by their own FieldsResolvers — no recursive result walking needed. Registry: `MapEnumFieldsMap` in `gql-entity.ts`, accessor `getMapEnumFieldsFor()`.
- **Mapped custom field filters** (`generateFilter` on mapping custom fields): Custom fields with `mapping` strategy can opt into filtering by setting `generateFilter: true`. Generates a nested filter input on the entity's `FilterInput` (e.g., `Account: CrmAccountFilterInput`) and produces `EXISTS (SELECT 1 FROM ref_table WHERE fk_join AND nested_filter)` SQL. Works inside `_or`/`_and`. Enum conversion in nested filters is handled recursively. Handler: `handleMappedCustomFieldFilter()` in `filter-processor.ts`.
- **CRUD Input types**: Each `@GQLEntityClass` entity auto-generates an `InputType` containing all scalar fields (all nullable). Accessible as `EntityGQL.Input` (same pattern as `.FilterInput`, `.PaginationInput`). Array relation fields, object relation fields (with `relatedEntityName`), and custom fields are excluded. Individual fields can be excluded via `excludeFromInput: true` in field settings. Designed for create/update/upsert mutations — a single type works for all operations. TypeScript type: `GQLEntityInputType<T>`.
- **Singular queries**: `GQLQueryManager` provides `getQueryResultForInfo` and `getQueryResultForFields` (singular) that return a single `K | null` instead of `K[]`. These force `LIMIT 1` — no `limit`/`offset` params are exposed. An optional `orderBy` parameter lets the caller control which record is selected (e.g. `orderBy: [{ forgedYear: 'desc' }]` to get the most recently forged ring). Delegates to the plural methods internally with `pagination: { limit: 1, orderBy }`.

## Key Conventions

- **Runtime**: Bun only (package manager, test runner, build tooling).
- **Module output**: CommonJS. **Decorators**: `experimentalDecorators: true`.
- **Prettier**: tabs, single quotes, trailing comma es5, print width 100.
- **`reflect-metadata`** must be imported before any decorator usage.
- **No separate lint step** — rely on `tsc --strict` and Prettier.
- **Theming**: All code, comments, and fixtures use **Lord of the Rings / Middle-earth** references.
- Test runner: Bun built-in (not Jest). `bunfig.toml` configures discovery; `tests/setup.ts` is preloaded.

## Gotchas

- Integration tests need PostgreSQL. CI uses a `postgres:16-alpine` service container with env vars `DATABASE_URL`, `POSTGRES_HOST`, etc.
- `setGlobalConfig()` must be called **before** any `@GQLEntityClass` decorators run (before importing entity files).
- The package has a workspace for `examples/*` (currently `examples/web-playground`).
- **Git-flow versioning**: `develop` always carries a `-dev` suffix (e.g., `1.1.0-dev`), `main` has clean versions. Release workflows strip `-dev`, bump, publish, then merge back and set the next `-dev` version.
