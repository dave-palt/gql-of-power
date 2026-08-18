---
name: gql-of-power
description: 'Use when mapping GraphQL entities to SQL with @dav3/gql-of-power — defining @GQLEntityClass entities, FieldsSettings, relationship fields (1:1, 1:m, m:1, m:n), EntityMetadata, MetadataProvider, and advanced features (count fields, exists filters, mapNumericEnum, parseJson, mapping-strategy custom fields, excludeFromInput). Guides the full scaffold: entity class → field config → ORM metadata → resolver.'
version: 1.0.0
author: gql-of-power
license: MIT
metadata:
  hermes:
    tags: [graphql, sql, type-graphql, orm-mapping, n-plus-1, entity]
    related_skills: []
---

# gql-of-power entity mapping

## Overview

`@dav3/gql-of-power` generates a **single optimized SQL query** from a GraphQL operation, eliminating N+1 via recursive field→SQL mapping. You describe entities once (ORM class + field settings + entity metadata) and the library builds the GraphQL types, field resolvers, filter/pagination inputs, and the SQL — all via a `MetadataProvider` interface that adapts whatever ORM you already use.

This skill teaches an agent to scaffold a new entity the way the library is designed to be used, covering every relationship type and the advanced field features.

## When to use

- Adding a new GraphQL entity backed by a SQL table
- Wiring a relationship between two entities (1:1, 1:m, m:1, m:n)
- Using a gql-of-power advanced feature: count fields, `_exists`/`_not_exists` filters, `mapNumericEnum`, `parseJson`, `mapping`-strategy custom fields, `excludeFromInput`
- Implementing a `MetadataProvider` for an ORM not yet supported

**Don't use for:** raw SQL queries without GraphQL, or non-type-graphql setups.

## The mental model (3 layers)

Every entity is defined across three files. The library connects them:

1. **ORM entity class** (`schema/entities.ts`) — a plain TS class with your properties and relationship fields. This is what your ORM (MikroORM, TypeORM, custom) uses; field names here are the JS property names.
2. **FieldsSettings** (`schema/fields.ts`) — tells gql-of-power how each field maps to GraphQL: its type, whether it's filterable, its relationship target, array-ness, and the advanced options. Passed to `createGQLTypes()`.
3. **EntityMetadata** (`schema/entities.ts`) — tells gql-of-power the SQL reality: table name, primary keys, and per-property SQL column names + relationship join columns. Returned by your `MetadataProvider`.

```
ORM class (JS props)  ──┐
FieldsSettings (GQL)  ──┼──► createGQLTypes() ──► GraphQL types + resolvers
EntityMetadata (SQL)  ──┘                                │
                                                        ▼
                                  GQLQueryManager ──► single SQL query
```

## Quick start: scaffold an entity

See `templates/entity-skeleton.ts` for a copy-paste starting point. The minimum per entity:

```typescript
// 1. ORM class
export class Weapon {
	id!: number;
	name!: string;
}

// 2. FieldsSettings
export const WeaponFields: Partial<FieldsSettings<Weapon>> = {
	id: { type: () => Number, generateFilter: true },
	name: { type: () => String, generateFilter: true },
};

// 3. EntityMetadata
export const WeaponMetadata: EntityMetadata<Weapon> = {
	name: 'Weapon',
	tableName: 'weapons',
	primaryKeys: ['id'],
	properties: {
		id: { type: 'number', name: 'id', fieldNames: ['id'] /* + rel fields */ } as EntityProperty,
		name: { type: 'string', name: 'name', fieldNames: ['weapon_name'] } as EntityProperty,
	},
};

// 4. Wire it
export const WeaponGQL = createGQLTypes(Weapon, WeaponFields);
// 5. Resolver extends the generated FieldsResolver
@Resolver(() => WeaponGQL.GQLEntity || Object)
export class WeaponResolver extends WeaponGQL.FieldsResolver {
	@Query(() => [WeaponGQL.GQLEntity])
	async weapons(@Info() info: GraphQLResolveInfo) {
		return queryManager.getQueryResultsForInfo(provider, Weapon, info);
	}
}
```

## Choosing a relationship type

```
Does entity A hold the FK column?
├── yes → it's m:1 (A belongs to B). Set on A's field: relatedEntityName + the FK is in EntityMetadata.
└── no
    └── Is B the side with the FK (B references A)?
        ├── yes → it's 1:m (A has many B). Set on A's field: array:true + relatedEntityName. B's metadata has the FK.
        └── no (join table involved) → it's m:n. Set on A's field: array:true + relatedEntityName. Both metadatas reference the pivot table.
1:1 is a special case of m:1 / 1:m with a unique FK.
```

For the **exact annotated examples** of each relationship type (field settings + metadata on both sides), read `references/relationships.md`.

## Advanced features — which to use when

| Need                                                   | Feature                   | Where                          | See                               |
| ------------------------------------------------------ | ------------------------- | ------------------------------ | --------------------------------- |
| Count of related items as an Int field                 | `countFieldName`          | array relation field settings  | `references/advanced-features.md` |
| Sum/avg/min/max of a related column as a Float field   | `aggregateFields`         | array relation field settings  | `references/advanced-features.md` |
| Filter by whether a related row exists                 | `_exists` / `_not_exists` | class-level filter (automatic) | `references/advanced-features.md` |
| DB stores a number, GQL wants the enum string key      | `mapNumericEnum`          | enum field settings            | `references/advanced-features.md` |
| Store/retrieve a JSON object column                    | `parseJson`               | field settings                 | `references/advanced-features.md` |
| Custom field backed by a SQL JOIN to a non-relation FK | `mapping` strategy        | `customFields`                 | `references/advanced-features.md` |
| Server-managed field clients can't set                 | `excludeFromInput`        | field settings                 | `references/advanced-features.md` |

## Implementation checklist

For each new entity, verify:

- [ ] ORM class defined with all scalar + relationship properties
- [ ] `EntityMetadata` has `tableName`, `primaryKeys`, and a `properties` entry for EVERY field (scalars include `fieldNames: ['sql_column']`)
- [ ] Every relationship field has `reference` set in its `EntityProperty` with correct `joinColumns`/`referencedColumnNames`/`mappedBy`/`pivotTable`
- [ ] `FieldsSettings` has an entry for every field you want queryable, with `type` + `generateFilter` where you want filters
- [ ] Every relationship field has `relatedEntityName: () => 'Target'` and `array: true` if it returns many
- [ ] `createGQLTypes(Entity, Fields)` called and the result exported
- [ ] A `@Resolver` extends the generated `FieldsResolver` and exposes a `@Query`
- [ ] `MetadataProvider.getMetadata(entityName)` returns the right metadata for every entity name you use

## Common pitfalls

1. **Missing `relatedEntityName`.** A relationship field without `relatedEntityName` (or `array:true`) won't generate filters or be mappable. The library can auto-derive it for `@GQLEntityClass`-decorated types but explicit is safer.

2. **Relationship-field filters need `as any`.** Filters like `{ fellowship: { id_in: [1,2] } }` work at runtime but `GQLEntityFilterInputFieldType<T>` doesn't statically surface relation sub-filters. Cast the filter object to `any` (the library's own tests do this).

3. **`mapNumericEnum` value direction + `mapEnumOutput` output mode.** DB stores the number (e.g. `100`); GraphQL exposes the enum string key (`"Forged"`). The library converts filter values to numbers for SQL (via `enum-filter-converter.ts`). On the output side, `mapEnumOutput` controls the SQL:
   - `'raw'` (default) — raw DB values pass through. Works when the schema is built live via type-graphql's `buildSchema()`.
   - `'key'` — SQL `CASE WHEN` returns the enum string key. Required when the schema is rebuilt from SDL (Apollo Server + `.graphql` file), because SDL strips numeric values and `serialize(0)` fails.
   - Set via per-field `mapEnumOutput`, global `setGlobalConfig({ mapEnumOutput: 'key' })`, or env `GQL_OF_POWER_MAP_ENUM_OUTPUT=key`.
   - You must still `registerEnumType(MyEnum)` with type-graphql.

4. **`_exists` / `_not_exists` are class-level, not field settings.** They work on relationship fields automatically — no schema change needed. Use them in filters: `persons(filter: { _exists: { Ring: { forgedBy: "Sauron" } } })`. Multiple keys are AND-combined.

5. **`mapping` strategy vs `resolve` strategy custom fields are mutually exclusive.** A `customField` (a field NOT on the ORM class) uses exactly one: `mapping` (library generates the JOIN, no resolver function) OR `resolve` + `resolveDecorators` (you provide a FieldResolver). If both are set on the same field, only the resolver registers — the mapping filter silently disappears. See `references/advanced-features.md`.

6. **`createGQLEntity()` requires a manual `buildResolvers()` call.** This is the deferred API (for circular imports between entity files). Unlike `@GQLEntityClass` / `createGQLTypes()`, it does **not** register the FilterInput until you call `.buildResolvers()`. If you forget, any filter referencing that entity (relationship fields, mapping custom-field filters, `_exists`) throws at `buildSchema()` time: `FilterInput for referenced entity "X" (XFilterInput) is not registered`. The fix is to call `.buildResolvers()` on **every** entity before building the schema. See the README's "Three Ways to Define an Entity" section.

7. **`requires` fetches columns silently.** Fields listed in `requires` are added to the SQL SELECT even if the client didn't request them — needed when your resolver reads a FK the query didn't ask for.

8. **`fieldNames` in metadata are SQL columns, not JS props.** `properties.name.fieldNames: ['person_name']` means the SQL column is `person_name`. Getting this wrong produces wrong SQL that may silently return nulls.

9. **`_or` compiles to UNION ALL by default; `orStrategy: 'or'` switches to plain OR.** Each `_or` branch normally becomes a separate SELECT. Pass `pagination: { orStrategy: 'or' }` (or `setGlobalConfig({ orStrategy: 'or' })` / env `GQL_OF_POWER_OR_STRATEGY=or`) to flatten branches into one `((w1) or (w2))` WHERE — index-friendly. Both modes are verified equivalent by integration tests, including relationship-based branches (they compile to self-contained EXISTS subqueries) and count/aggregate subqueries (they dedupe on child PKs). See `references/advanced-features.md` → "orStrategy" and the README's "OR Strategy" section.

## Verification

- [ ] `bunx tsc --noEmit` passes (type-graphql decorator typing is strict)
- [ ] The entity appears in the GraphQL schema (boot the server or run an introspection query)
- [ ] A query for the entity with a nested relationship produces a single SQL query (check logs — gql-of-power logs the generated SQL)
- [ ] Filters on the entity work (`{ name: { _like: "..." } }`, relationship filters, `_exists`)

## References

- `references/relationships.md` — annotated 1:1, 1:m, m:1, m:n examples (both sides)
- `references/advanced-features.md` — count fields, exists filters, mapNumericEnum, parseJson, mapping custom fields, excludeFromInput
- `references/metadata-providers.md` — implementing the MetadataProvider interface
- `templates/entity-skeleton.ts` — copy-paste scaffold
- The library's own `examples/web-playground/` — a full working reference covering all features
