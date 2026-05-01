# AGENTS.md

## Project

`@dav3/gql-of-power` — TypeScript library that generates a single optimized SQL query from GraphQL operations, eliminating N+1 via recursive field-to-SQL mapping. Framework-agnostic through a `MetadataProvider` interface.

## Commands

```bash
bun install                  # install deps (uses bun, not npm/pnpm)
bun run build                # tsc → dist/
bun run test                 # all tests (D3GOP_LOG_TYPE="disabled" set automatically)
bun run test:unit            # unit tests only
bun run test:integration     # integration tests only (requires running PostgreSQL)
bun run test:watch           # watch mode
bun test tests/unit/filter-processor.test.ts   # single test file
bun test --filter="relationship"               # tests matching a pattern
```

There is no separate lint or typecheck command — `bun run build` (tsc) is the typecheck.

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

## Testing

- Test runner: **Bun built-in** (not Jest). `jest.config.js` is legacy and unused.
- `bunfig.toml` configures test discovery; `tests/setup.ts` is preloaded (imports `reflect-metadata`, silences console timers).
- Unit tests: `tests/unit/` — mocked dependencies, no database needed.
- Integration tests: `tests/integration/` — require a running PostgreSQL instance.
- Test fixtures in `tests/fixtures/` use a LotR/Middle-earth themed schema.
- `D3GOP_LOG_TYPE="disabled"` is required for clean test output (already in npm scripts).

## Key Conventions

- **Runtime**: Bun only. Package manager, test runner, and build tooling all use Bun.
- **Module output**: CommonJS (`"module": "CommonJS"` in tsconfig).
- **Decorators**: `experimentalDecorators: true` — required for TypeGraphQL `@GQLEntityClass`.
- **Prettier**: tabs, single quotes, trailing comma es5, print width 100. Config is in `.prettierrc`.
- **`reflect-metadata`** must be imported before any decorator usage (handled in `tests/setup.ts` for tests).
- **No separate lint step** — rely on `tsc --strict` and Prettier.
- **Format before commit**: Always run `bunx prettier --write .` to format all files before committing. This ensures consistent style without relying on pre-commit hooks.
- **Theming**: All code examples, JSDoc comments, test data, and fixtures use **Lord of the Rings / Middle-earth** references (Person, Ring, Fellowship, Battle, Book, Author, etc.). Never use real-world business entity names like Account, Customer, Order, Tenant, etc.

## Gotchas

- Integration tests need PostgreSQL. CI uses a `postgres:16-alpine` service container with env vars `DATABASE_URL`, `POSTGRES_HOST`, etc.
- `setGlobalConfig()` must be called **before** any `@GQLEntityClass` decorators run (before importing entity files).
- The package has a workspace for `examples/*` (currently `examples/web-playground`).
- **Git-flow versioning**: `develop` always carries a `-dev` suffix (e.g., `1.1.0-dev`), `main` has clean versions. Release workflows strip `-dev`, bump, publish, then merge back and set the next `-dev` version.
