# Advanced features

## countFieldName — Int count of related items

Set on an **array relation field** to auto-generate an Int field returning the count of related entities, plus a filter argument to filter-before-counting.

```typescript
// FieldsSettings — Author
books: {
  type: () => BookGQL.GQLEntity,
  generateFilter: true,
  array: true,
  relatedEntityName: () => Book.name,
  countFieldName: 'bookCount', // <-- generates `bookCount` Int field + filter
},
```

Generated SQL is a correlated subquery:

```sql
(SELECT COUNT(*) FROM "books" AS e_w1 WHERE e_w1.author_id = a_1.id AND <filter>) AS "bookCount"
```

Query it:

```graphql
authors {
  id
  bookCount(filter: { genre: "Fantasy" })  # count only fantasy books
}
```

Filter operators auto-generate too: `bookCount_gt`, `bookCount_lte`, etc.

**Requires:** `array: true` + `relatedEntityName`.

## aggregateFields — sum/avg/min/max of related columns

Set on an **array relation field** to auto-generate numeric fields returning aggregated values of a column on the related entities. Each aggregate is a correlated subquery.

```typescript
// FieldsSettings — Author
books: {
  type: () => BookGQL.GQLEntity,
  generateFilter: true,
  array: true,
  relatedEntityName: () => Book.name,
  countFieldName: 'bookCount',
  aggregateFields: [
    { fn: 'sum', column: 'pages', fieldName: 'totalPages' }, // Float
    { fn: 'avg', column: 'pages', fieldName: 'avgPages' }, // Float
    { fn: 'min', column: 'publishedYear', fieldName: 'oldestBookYear' }, // Float
    { fn: 'max', column: 'publishedYear', fieldName: 'newestBookYear' }, // Float
  ],
},
```

Generated SQL (per aggregate):

```sql
(SELECT SUM(page_count) FROM "books" AS e_w1 WHERE e_w1.author_id = a_1.id) AS "totalPages"
```

Query it:

```graphql
authors {
  id
  totalPages
  avgPages
  oldestBookYear
  newestBookYear
}
```

Filter operators auto-generate too: `totalPages_gt`, `totalPages_lte`, etc. (same numeric operators as count fields).

> The `column` is the **property name** on the related entity (resolved to the SQL column via metadata).

**Requires:** `array: true` + `relatedEntityName`.

## orderBy on related columns — nested objects, all cardinalities

`pagination.orderBy` accepts **nested-object** keys (not dot-notation) so
TypeScript gives autocomplete at every level. The join direction is resolved by
the shared ownership dispatch (`src/queries/relation-dispatch.ts`), so every
cardinality works:

```typescript
// m:1 or owning-side 1:1 — plain scalar subquery (one related row):
await queryManager.getQueryResultsForFields(provider, Book, fields, undefined, {
	orderBy: [{ author: { name: 'asc' } }],
});

// 1:m / inverse-1:1 / m:n — MIN-for-asc / MAX-for-desc aggregated subquery:
await queryManager.getQueryResultsForFields(provider, Author, fields, undefined, {
	orderBy: [{ books: { publishedYear: 'desc' } }],
});
```

```sql
-- m:1:            ORDER BY (SELECT e_o.author_name FROM "authors" e_o WHERE e_a1.author_id = e_o.id) ASC
-- 1:m (desc→MAX): ORDER BY (SELECT MAX(e_o.published_year) FROM "books" e_o WHERE e_a1.id = e_o.author_id) DESC
```

Rules:

- Aggregated sorts (1:m / inverse-1:1 / m:n) need a **single-column** related
  field — multi-column is ambiguous under aggregation.
- An orderBy key that is neither a relation nor a scalar field throws a named
  error (`gql-of-power: orderBy key "…" cannot be resolved`) instead of
  silently producing malformed SQL.
- Works with `limit`/`offset` (the correlated parent columns are projected
  through the wrapping subquery) and inside `_or`/`_and` UNION ALL branches.

> **GraphQL schema note:** the generated `<Entity>OrderBy` input type exposes
> flat `Sort` fields only. Nested related-column orderBy is a **programmatic
> pagination API** feature (`getQueryResultsForInfo` / `getQueryResultsForFields`
> — or a resolver pagination arg typed `any`); the GraphQL input does not yet
> express nested objects.

## _exists / _not_exists — filter by related-row existence

These are **class-level** filter operators (not field settings). They work automatically on relationship fields — no schema change needed.

```graphql
# Persons who own a ring forged by Sauron
persons(filter: { _exists: { Ring: { forgedBy: "Sauron" } } })

# Persons who have never fought in a battle
persons(filter: { _not_exists: { Battle: {} } })
```

- The key (`Ring`, `Battle`) is the **ORM entity name** of the related table.
- Multiple keys are AND-combined: `{ _exists: { Ring: {...} }, _not_exists: { Battle: {...} } }`.
- The library auto-generates `EntityExistsFilterInput` types.

- `_not` takes an array of filter objects, AND-combines them, and wraps the result in `NOT (...)`: `{ _not: [{ name: "Sauron" }, { race: "Maiar" }] }` produces `NOT (name = 'Sauron' AND race = 'Maiar')`. Enum values inside `_not` are converted recursively (same path as `_and`/`_or`). Note: nesting `_or` inside `_not` is not fully negated (UNION ALL is not invertible) — use De Morgan's law instead.

## orStrategy — plain OR instead of UNION ALL

By default `_or` branches compile to separate SELECTs joined with `union all`
(each branch keeps its INNER JOINs isolated). Set `orStrategy: 'or'` to
flatten branches into one query with `((w1) or (w2))` in the WHERE instead —
an index-friendly single scan:

```typescript
// per query (pagination arg):
getQueryResultsForFields(provider, Person, fields, filter, { orStrategy: 'or' });

// or globally:
setGlobalConfig({ orStrategy: 'or' });
// or env: GQL_OF_POWER_OR_STRATEGY=or
```

Same filter, two strategies:

```sql
-- union-all (default):
(select ... where (name = :v1)) union all (select ... where (race = :v2))
-- or:
select ... where ((name = :v1) or (race = :v2))
```

Applies at every `_or` compilation site: root query, relationship `EXISTS`
subqueries, and count/aggregate correlated subqueries.

**Per-branch selection (v1.11+).** `orStrategy` is a native field on the
generated `PaginationInput`, so a relation field's own pagination selects the
strategy for that branch only — `books(pagination: { orStrategy: OR })`.
Nearest-wins inheritance: a child without its own value inherits the root's,
which itself falls back to the global. Sibling branches are isolated.
Precedence (highest first): explicit `buildQueryAndBindingsFor({ orStrategy })`
argument (query-wide hard override that ignores root AND child pagination
values, warning per override — filter logs with `D3GOP_LOG_TYPE=orStrategy`) >
branch pagination > root pagination > `setGlobalConfig`/env > `'union-all'`.
The trailing `orStrategy` param on `getQueryResultsForFields` /
`getQueryResultsForInfo` is the same hard override at the manager level.
One invariant: inline scalar `_or` inside a lateral `json_agg` (children
collections) always compiles to plain OR regardless of strategy — union-all
there would duplicate children matching 2+ branches.

**Note on relationship branches:** relationship filter branches compile to
self-contained correlated `EXISTS` subqueries (not parent-level INNER JOINs),
so both strategies are semantically equivalent for them — verified by PG
integration tests (mixed relationship+scalar, dual-relationship). Count and
aggregate fields over `_or`-filtered children dedupe on the child PKs, so a
child matching multiple branches is counted/summed once in both modes.

## mapNumericEnum — DB stores number, GQL wants the string key

For fields where the DB column holds a numeric enum value but GraphQL must serialize the string key.

```typescript
enum RingStatus {
  Forged = 100,
  Lost = 200,
  Destroyed = 300,
}
registerEnumType(RingStatus, { name: 'RingStatus' }); // type-graphql registration

// FieldsSettings — Ring
status: {
  type: () => RingStatus,
  generateFilter: true,
  mapNumericEnum: true, // <-- DB stores 100, GQL exposes "Forged"
  mapEnumOutput: 'raw', // 'raw' (default) or 'key' — see below
},
```

What the library does automatically:

- **Output (serialize):** controlled by `mapEnumOutput` setting:
  - `'raw'` (default) — raw DB value passes through untouched. graphql-js serializes it natively (works when schema is built live via `buildSchema()`).
  - `'key'` — SQL `CASE WHEN 100 THEN 'Forged' END` wraps the column so the query returns the string key directly. Required when the schema is rebuilt from SDL (Apollo Server + `.graphql` file), because SDL strips numeric values.
  - Set via per-field `mapEnumOutput`, global `setGlobalConfig({ mapEnumOutput: 'key' })`, or env `GQL_OF_POWER_MAP_ENUM_OUTPUT=key`.
- **Filter/input:** converts filter values to numbers for SQL parameters (client sends `"Forged"`, query uses `100`). Uses `enum-filter-converter.ts`.
- This conversion applies at **every nesting level** — top-level filters, inline field-argument filters on nested relation selections (`rings { bearer(filter: { questState: InProgress }) { ... } }`), count-field filters (`bookCount(filter: { status: Active })`), and any depth of nested relation/custom-field filters. `_or` / `_and` arrays and operator-object shapes (`{ _eq: Active }`) are handled recursively.

The DB column must exist in metadata: `status: { type: 'number', name: 'status', fieldNames: ['status'] }`.

## parseJson — JSON object column

Wrap a field's column so it's returned as a JSON object (handles both jsonb and stringified-JSON-in-text).

```typescript
import GraphQLJSON from 'graphql-type-json';

// FieldsSettings
metadata: {
  type: () => GraphQLJSON,
  parseJson: true, // wraps column with JSON-parsing SQL expression
},
```

Uses PostgreSQL `TRIM + REPLACE` to unescape stringified values before casting to jsonb.

## mapping strategy — custom field via SQL JOIN (no resolver function)

For a GraphQL field that isn't an ORM relation but is reachable via a FK column. The library generates the JOIN; you provide no resolver.

```typescript
// customFields on Person — a `homeRegion` field joined via person.homeRegionId → Region.id
// (Person has homeRegionId, Region is its own entity)
createGQLTypes(Person, PersonFields, {
	customFields: {
		homeRegion: {
			type: () => RegionGQL.GQLEntity,
			options: { nullable: true },
			generateFilter: true,
			mapping: {
				refEntity: Region,
				refFields: 'id', // column on Region (property name)
				fields: 'homeRegionId', // FK property on Person
			},
		},
	},
});
```

- `mapping` and `resolve`/`resolveDecorators` are **mutually exclusive** — pick one strategy per custom field. If both are set, only the resolver registers and the mapping filter **silently disappears** (the `as any` escape hatch bypasses the TS union that normally prevents this).
- `generateFilter: true` on a mapping custom field produces `EXISTS (SELECT 1 FROM region WHERE fk_join AND nested_filter)` SQL and works inside `_or`/`_and`.
- The filter key in the FilterInput is **PascalCase** (`HomeRegion: { name_eq: '...' }`), even though the field selection in the query is camelCase (`homeRegion { ... }`).
- The referenced entity must have its FilterInput registered. `@GQLEntityClass` / `createGQLTypes()` do this automatically; `createGQLEntity()` requires a manual `.buildResolvers()` call. A missing registration throws `FilterInput for referenced entity "X" is not registered` at `buildSchema()` time.
- Composite keys: pass arrays — `refFields: ['a','b']`, `fields: ['a','b']`.

## excludeFromInput — hide server-managed fields from the Input type

Each entity auto-generates an `Input` type (for create/update/upsert) containing all scalar fields. Exclude server-managed or computed fields:

```typescript
forgedDate: {
  type: () => String,
  excludeFromInput: true, // won't appear in EntityGQL.Input
},
```

Only applies to scalar fields — relation fields are always excluded from Input.

## requires — silently fetch FK columns for a resolver

When a `resolve`-strategy custom field needs a FK column the client didn't request, list it in `requires`:

```typescript
customFields: {
  firstMember: {
    type: () => PersonGQL.GQLEntity,
    requires: ['id'], // always fetched even if client didn't ask for id
    resolve: (root) => loadFirstMember(root.id),
    resolveDecorators: [Root()],
  },
}
```

`requires` columns are added to both the outer SELECT and the inner rawSelect subquery.
