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
},
```

What the library does automatically:

- Generates a `@FieldResolver` that converts the DB number → enum string key at serialization (uses TS reverse-mapping `RingStatus[100] === "Forged"`; falls back to iterating `Object.keys()` for string-valued enums).
- Converts **filter values** back to numbers for SQL parameters (client sends `"Forged"`, query uses `100`).

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

- `mapping` and `resolve`/`resolveDecorators` are **mutually exclusive** — pick one strategy per custom field.
- `generateFilter: true` on a mapping custom field produces `EXISTS (SELECT 1 FROM region WHERE fk_join AND nested_filter)` SQL and works inside `_or`/`_and`.
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
