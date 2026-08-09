# ⚔️ GQL of Power

> **"One Query to Rule Them All"** — Master your data with the power of a single optimized SQL query

---

## The Ring Bearer's Tale

In the age of microservices and data loaders, a shadow falls upon performance: _the N+1 query problem_. Weary developers traverse the lands of Middleware-earth, orchestrating countless queries to fetch interconnected data.

But what if there was another way? What if, with the power of a single SQL query, you could bind all your data together?

**GQL of Power** is a TypeScript library that harnesses ancient sorcery to generate perfectly optimized SQL queries from your GraphQL operations. It eliminates the need for data loaders entirely — one SQL query to fetch your complete data structure, no matter how deeply nested your relationships run.

Like the One Ring wielding dominion over all other Rings, GQL of Power commands your database with singular authority.

---

## Features

### 🗡️ Query Unification

Generate a **single, optimized SQL query** from any GraphQL query structure — no matter how complex your relationships are.

- ✨ **Eliminate Data Loaders** – Replace the tedious choreography of multiple queries with one powerful statement
- 🏰 **Intelligent Relationship Handling** – Navigate 1:1, 1:m, m:1, and m:m relationships seamlessly
- 🔍 **Comprehensive Filtering** – Filter at any level of your nested query tree
- 📄 **Type-Safe Operations** – Full TypeScript support ensures your queries are error-free
- ⚡ **Performance Optimized** – UNION ALL for OR conditions, efficient JSONB aggregation, and strategic aliasing

### 🧙 Core Powers

- **Recursive Query Mapping** – Transforms GraphQL field selections into SQL recursively
- **Automatic Join Generation** – Intelligently creates JOINs based on ORM entity relationships
- **Dynamic Filtering** – Support for field-level and class-level filter operations (`_eq`, `_in`, `_like`, `_gt`, `_and`, `_or`, etc.)
- **Pagination & Sorting** – Native limit, offset, and order-by handling
- **Custom Fields** – Extend entities with computed properties, DataLoaders, or automatic SQL JOINs for unmapped foreign keys
- **Framework Agnostic** – Works with any ORM through a simple `MetadataProvider` interface

---

## Installation

```bash
pnpm add @dav3/gql-of-power
```

---

## Quick Start

### 1. Define Your GQL Entities

Use `defineFields` + `@GQLEntityClass` to declare GraphQL entities. `defineFields` is typed against the ORM class — invalid field names are caught at compile time.

```typescript
import { defineFields, GQLEntityBase, GQLEntityClass } from '@dav3/gql-of-power';
import { Author, Book } from './orm-entities';
import { ID, Int } from 'type-graphql';

// --- Author ---
const authorFields = defineFields(Author, {
	id: { type: () => ID, generateFilter: true },
	name: { type: () => String, generateFilter: true },
});

@GQLEntityClass(Author, authorFields)
export class AuthorGQL extends GQLEntityBase {}

// --- Book ---
const bookFields = defineFields(Book, {
	id: { type: () => ID, generateFilter: true },
	title: { type: () => String, generateFilter: true },
	publishedYear: { type: () => Int, generateFilter: true },
	author: { type: () => AuthorGQL, options: { nullable: true } },
});

@GQLEntityClass(Book, bookFields)
export class BookGQL extends GQLEntityBase {}
```

The decorator attaches generated statics to the class:

| Static                      | Purpose                                   |
| --------------------------- | ----------------------------------------- |
| `BookGQL.FilterInput`       | Generated filter input type               |
| `BookGQL.PaginationInput`   | Generated pagination input type           |
| `BookGQL.OrderBy`           | Generated order-by input type             |
| `BookGQL.FieldsResolver`    | Auto-generated field resolver class       |
| `BookGQL.gqlEntityName`     | GQL type name (with suffix if configured) |
| `BookGQL.relatedEntityName` | ORM entity class name (`'Book'`)          |

### 2. Write Resolvers

```typescript
import { Resolver, Query, Arg, Info } from 'type-graphql';
import { GQLResolver, getAutoResolvers } from '@dav3/gql-of-power';
import { GraphQLResolveInfo } from 'graphql';

@GQLResolver(BookGQL)
export class BookResolver {
	@Query(() => [BookGQL])
	async books(
		@Arg('filter', () => BookGQL.FilterInput, { nullable: true }) filter: any,
		@Arg('pagination', () => BookGQL.PaginationInput, { nullable: true }) pagination: any,
		@Info() info: GraphQLResolveInfo
	) {
		return queryManager.getQueryResultsForInfo(metadataProvider, BookGQL, info, filter, pagination);
	}
}
```

### 3. Build the Schema

```typescript
import { buildSchemaSync } from 'type-graphql';
import { getAutoResolvers } from '@dav3/gql-of-power';
import '../entities'; // trigger @GQLEntityClass decoration

const schema = buildSchemaSync({
	resolvers: [
		BookResolver,
		...getAutoResolvers(), // FieldsResolver for every @GQLEntityClass entity
	],
});
```

---

## Examples

For complete, LotR-themed walkthroughs of both mapping strategies (direct ORM relation and custom field mapping), see **[EXAMPLES.md](./EXAMPLES.md)**.

---

## Entity API

### `defineFields<T>(OrmClass, config)`

Typed wrapper that constrains config keys to `keyof T`. Identity function at runtime — it exists purely for TypeScript inference.

```typescript
const fields = defineFields(Book, {
	id: { type: () => ID, generateFilter: true },
	title: { type: () => String, generateFilter: true },
	typo: { type: () => String }, // TS error — 'typo' is not keyof Book ✗
});
```

#### Field options

| Option              | Type                | Purpose                                                                               |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `type`              | `() => GraphQLType` | GraphQL return type (required)                                                        |
| `generateFilter`    | `boolean`           | Generate filter input fields for this property                                        |
| `options`           | `FieldOptions`      | type-graphql field options (nullable, description, etc.)                              |
| `alias`             | `string`            | Override the GQL field name                                                           |
| `array`             | `true`              | Mark as array return type                                                             |
| `relatedEntityName` | `() => string`      | ORM entity name for array relation fields (auto-derived when using `@GQLEntityClass`) |
| `countFieldName`    | `string`            | Generate a count field for this relationship (see [Count Fields](#count-fields))      |
| `enum`              | `EnumData`          | Register an enum type                                                                 |

### `@GQLEntityClass(OrmClass, fields, extra?)`

Class decorator that registers the entity with type-graphql and attaches generated statics.

```typescript
@GQLEntityClass(Book, fields, {
  customFields: { ... }, // optional — see Custom Fields
  acl: { ... },          // optional — access control
})
export class BookGQL extends GQLEntityBase {}
```

### `extends GQLEntityBase`

Required base class. Provides TypeScript visibility of the decorator-attached statics (`FilterInput`, `PaginationInput`, etc.) without `declare static` boilerplate on each entity.

### `@GQLResolver(EntityClass)`

Marks a class as a custom resolver for the given GQL entity. Applies `@Resolver(() => EntityClass)` and integrates with type-graphql's resolver merging (the auto `FieldsResolver` and your custom query resolver coexist seamlessly).

### `getAutoResolvers()`

Returns all `FieldsResolver` classes registered by `@GQLEntityClass` decorators. Pass the result into `buildSchemaSync({ resolvers: [...getAutoResolvers()] })`.

---

## Custom Fields

Custom fields extend a GQL entity with fields that don't exist as direct ORM properties. There are two mutually exclusive strategies.

### Strategy 1: `resolve` — DataLoader / computed

Provide a GraphQL `@FieldResolver` function. The library fetches field(s) listed in `requires` from the main query, then your `resolve` function runs at GraphQL resolution time.

```typescript
@GQLEntityClass(Fellowship, fields, {
	customFields: {
		firstMember: {
			type: () => GraphQLJSON,
			options: { nullable: true },
			requires: 'id', // ensure 'id' is fetched even if client didn't request it
			resolveDecorators: [Root(), Ctx()],
			resolve: (root: Fellowship, ctx: any) => {
				return memberDataLoader.load(root.id);
			},
		},
	},
})
export class FellowshipGQL extends GQLEntityBase {}
```

#### `resolve` field options

| Option              | Purpose                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `type`              | GraphQL return type                                                    |
| `options`           | type-graphql field options                                             |
| `requires`          | Field name(s) to ensure are fetched from DB                            |
| `resolve`           | The resolver function (required)                                       |
| `resolveDecorators` | type-graphql parameter decorators in order (`[Root(), Ctx(), Info()]`) |

### Strategy 2: `mapping` — automatic SQL JOIN

Provide a `FieldMappingConfig`. The library generates a SQL `LEFT JOIN LATERAL` automatically and returns the related object directly from the SQL result. No resolver function needed.

Use this when the foreign key exists as a plain column on the entity (not declared as an ORM relation).

```typescript
import { Kingdom } from './orm-entities';

@GQLEntityClass(Hobbit, fields, {
	customFields: {
		kingdom: {
			type: () => KingdomGQL,
			options: { nullable: true },
			mapping: {
				refEntity: Kingdom, // ORM entity class to JOIN to
				refFields: 'id', // column(s) on Kingdom — keyof Kingdom ✓
				fields: 'kingdomId', // column(s) on Hobbit — keyof Hobbit ✓
			},
		},
	},
})
export class HobbitGQL extends GQLEntityBase {}
```

Composite FK — use arrays (must have the same length):

```typescript
mapping: {
  refEntity: Weapon,
  refFields: ['realmId', 'weaponCode'],
  fields:    ['realmId', 'weaponExternalId'],
}
```

#### `mapping` field options

| Option              | Type                              | Purpose                                                        |
| ------------------- | --------------------------------- | -------------------------------------------------------------- |
| `type`              | `() => GraphQLType`               | GraphQL return type                                            |
| `options`           | `FieldOptions`                    | type-graphql field options (nullable, etc.)                    |
| `mapping.refEntity` | `new () => TRef`                  | ORM entity class to JOIN to (must be in the metadata provider) |
| `mapping.refFields` | `keyof TRef \| Array<keyof TRef>` | Column(s) on the ref entity to match against                   |
| `mapping.fields`    | `keyof T \| Array<keyof T>`       | Column(s) on the owner entity to match from                    |

> **Note**: `resolve` and `mapping` are mutually exclusive — TypeScript enforces this via a discriminated union. `resolveDecorators` and `requires` are only valid on the `resolve` branch.

#### Generated SQL

For `kingdom: { mapping: { refEntity: Kingdom, refFields: 'id', fields: 'kingdomId' } }`:

```sql
select e_a1.id, e_a1.kingdom_id, f_j1.value as "kingdom"
from (
  select e_a1.id, e_a1.kingdom_id
  from hobbit as e_a1
  where true
) as e_a1
left outer join lateral (
  select row_to_json(f_j1)::jsonb as value
  from (
    select f_j1.id, f_j1.name
    from kingdom as f_j1
    where e_a1.kingdom_id = f_j1.id
  ) as f_j1
) as f_j1 on true
```

Returns `null` when the FK column is null (LEFT JOIN).

---

## Three Ways to Define an Entity

There are three APIs for registering a GQL entity. They differ in **when** the generated types (FilterInput, PaginationInput, FieldsResolver, etc.) are registered — that difference matters for filter-type resolution (see [Troubleshooting](#troubleshooting)).

### Quick comparison

| API                 | When to use                                                                                              | Calls `buildResolvers()`?                                    | FilterInput registered   |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------ |
| `@GQLEntityClass`   | **Default.** No circular imports between entity files.                                                   | ✅ Automatically (at decoration time)                        | ✅ Yes                   |
| `createGQLTypes()`  | Same as `@GQLEntityClass` but as a function call (can't decorate a class, or prefer the explicit style). | ✅ Automatically (internally)                                | ✅ Yes                   |
| `createGQLEntity()` | **Circular imports** between entity definitions — you need to defer resolver registration.               | ❌ **Deferred** — you must call `.buildResolvers()` yourself | ❌ No, until you call it |

### `@GQLEntityClass` — the default (recommended)

The decorator registers the entity **and** its FilterInput/FieldsResolver immediately at decoration time. All generated statics (`FilterInput`, `PaginationInput`, `FieldsResolver`) are available on the class.

```typescript
@GQLEntityClass(Book, bookFields)
export class BookGQL extends GQLEntityBase {}
// BookGQL.FilterInput is ready. Done.
```

### `createGQLTypes()` — function-call equivalent

Same behaviour as the decorator — it calls `createGQLEntity().buildResolvers()` internally (see `gql-entity.ts:1221-1222`). Use it when you can't or don't want to decorate a class.

```typescript
export const BookGQL = createGQLTypes(Book, bookFields);
// BookGQL.FilterInput is ready. Done.
```

### `createGQLEntity()` — for circular imports (advanced)

Returns the entity definition **without** registering the FilterInput or FieldsResolver. You must call `.buildResolvers()` yourself before `buildSchema()` runs. This split exists so two entity files can reference each other's `GQLEntity` type thunks without a circular-import deadlock at module-load time.

```typescript
// book.entity.ts
export const BookEntity = createGQLEntity(Book, bookFields);
//   ↑ FilterInput NOT registered yet

// author.entity.ts — can import BookEntity for the thunk even if Book imports Author
export const AuthorEntity = createGQLEntity(Author, authorFields, {
	customFields: {/* ... uses () => BookEntity.GQLEntity ... */},
});

// schema/index.ts — YOU must call buildResolvers() on EVERY entity
export const BookGQL = BookEntity.buildResolvers(); // ← registers BookFilterInput
export const AuthorGQL = AuthorEntity.buildResolvers(); // ← registers AuthorFilterInput
```

> ⚠️ **If you forget a `.buildResolvers()` call**, any filter that references that entity (relationship fields, mapping custom-field filters, `_exists` filters) will throw at schema-build time:
>
> ```
> gql-of-power: FilterInput for referenced entity "Book" (BookFilterInput) is not registered.
> Make sure Book's buildResolvers() is called (or use createGQLTypes / @GQLEntityClass)
> before building the schema.
> ```
>
> The error names the missing entity so you know exactly which file to fix.

---

## Filtering

Filter at any nesting level:

```typescript
// Simple equality
filter: { title: 'The Fellowship of the Ring' }

// Operators
filter: { publishedYear: { _gte: 1950 } }

// Nested relation filter
filter: { author: { name: { _like: '%Tolkien%' } } }

// AND / OR
filter: {
  _or: [
    { title: { _like: '%Ring%' } },
    { publishedYear: { _lt: 1960 } },
  ],
}
```

### Filter operations

| Operation      | Meaning                                                 |
| -------------- | ------------------------------------------------------- |
| `_eq`          | Equal                                                   |
| `_ne`          | Not equal                                               |
| `_in`          | In array                                                |
| `_nin`         | Not in array                                            |
| `_like`        | LIKE (case-sensitive contains)                          |
| `_nlike`       | NOT LIKE                                                |
| `_ilike`       | ILIKE (case-insensitive contains)                       |
| `_nilike`      | NOT ILIKE                                               |
| `_startsWith`  | LIKE prefix (case-sensitive)                            |
| `_istartsWith` | ILIKE prefix (case-insensitive)                         |
| `_endsWith`    | LIKE suffix (case-sensitive)                            |
| `_iendsWith`   | ILIKE suffix (case-insensitive)                         |
| `_re`          | Regex match (`~`)                                       |
| `_nre`         | Regex non-match (`!~`)                                  |
| `_gt` / `_gte` | Greater than / greater than or equal                    |
| `_lt` / `_lte` | Less than / less than or equal                          |
| `_between`     | BETWEEN low AND high                                    |
| `_nbetween`    | NOT BETWEEN low AND high                                |
| `_is_null`     | IS NULL (true) / IS NOT NULL (false)                    |
| `_and`         | Logical AND                                             |
| `_or`          | Logical OR (generates UNION ALL)                        |
| `_not`         | Negates a conjunction of conditions (NOT (...) wrapper) |
| `_exists`      | Check related entities exist (AND-combined per key)     |
| `_not_exists`  | Check no related entities exist (AND-combined per key)  |

### Existence Filters (`_exists` / `_not_exists`)

Check whether related entities match a set of conditions. Each key is a relationship field name; the value is a filter applied to that related entity. Multiple keys are AND-combined.

```graphql
# Authors that have at least one book titled "The Hobbit"
filter: {
  _exists: {
    books: { title: "The Hobbit" }
  }
}

# Authors that have a book titled "The Hobbit" AND no books in the "Horror" genre
filter: {
  _and: [
    { _exists: { books: { title: "The Hobbit" } } }
    { _not_exists: { books: { genre: "Horror" } } }
  ]
}

# Persons who fought in a victory battle AND wrote a book about it
filter: {
  _exists: {
    battles: { outcome: "Victory" }
    books: { title: { _like: "%War%" } }
  }
}
```

`_exists` generates `EXISTS (SELECT 1 FROM ... WHERE ...)` subqueries. `_not_exists` generates `NOT EXISTS (...)`. Multiple keys within one `_exists`/`_not_exists` each produce a separate `EXISTS`/`NOT EXISTS` clause, AND-combined in the WHERE. OR across exists conditions is achieved via `_or`.

### Negation Filter (`_not`)

Negate a set of conditions. `_not` takes an array of filter objects, AND-combines them, and wraps the result in `NOT (...)`.

```graphql
# Persons whose name is NOT "Sauron" AND race is NOT "Maiar"
filter: {
  _not: [
    { name: "Sauron" }
    { race: "Maiar" }
  ]
}

# Combine _not with other filters
filter: {
  age_gt: 50
  _not: [{ race: "Orc" }]
}
```

Generates `NOT (cond1 AND cond2)` in the WHERE clause. For simple field-level negation, the negated operators (`_ne`, `_nin`) are more direct — `_not` is for negating compound expressions. Note: nesting `_or` inside `_not` is not fully negated (the UNION ALL path is not invertible); use De Morgan's law (`_and` of negated conditions) instead.

---

## Count Fields

Add `countFieldName` to any relationship field with `array: true` to auto-generate an Int count field. The count is computed via a correlated `COUNT(*)` subquery — no JOINs in the outer query.

### Definition

```typescript
const authorFields = defineFields(Author, {
	id: { type: () => ID, generateFilter: true },
	name: { type: () => String, generateFilter: true },
	books: {
		type: () => BookGQL,
		array: true,
		relatedEntityName: () => 'Book',
		countFieldName: 'bookCount', // generates an `bookCount: Int` field
	},
});
```

### Querying

```graphql
query {
	authors {
		name
		bookCount # total books
		bookCount(filter: { publishedYear: { _gt: 1950 } }) # filtered count
	}
}
```

### Filtering by Count

The count field is also available as a filter key with numeric operators:

```graphql
# Authors with exactly 4 books
filter: { bookCount: 4 }

# Authors with more than 3 books
filter: { bookCount_gt: 3 }

# Nested object form
filter: { BookCount: { _gte: 2, _lte: 10 } }
```

Supported operators: `_eq`, `_ne`, `_gt`, `_gte`, `_lt`, `_lte`.

### Generated SQL

```sql
-- bookCount (select)
SELECT ...,
  (SELECT COUNT(*) FROM "books" AS e_w1 WHERE e_w1.author_id = a_1.id) AS "bookCount"
FROM authors AS a_1 ...

-- bookCount_gt (filter)
WHERE (SELECT COUNT(*) FROM "books" AS e_w1 WHERE e_w1.author_id = a_1.id) > :v_bookCount_gt__1
```

Works for all relationship types (1:m, m:1, m:n). For m:n, the pivot table is included in the subquery.

---

## Pagination

```typescript
pagination: {
  limit: 20,
  offset: 40,
  orderBy: [{ publishedYear: 'desc' }],
}
```

---

## Relationship Handling

| Relationship           | SQL Strategy                                      |
| ---------------------- | ------------------------------------------------- |
| **m:1** (many-to-one)  | `LEFT JOIN LATERAL` + `row_to_json`               |
| **1:1** (one-to-one)   | `LEFT JOIN LATERAL` + `row_to_json`               |
| **1:m** (one-to-many)  | `LEFT JOIN LATERAL` + `json_agg`                  |
| **m:m** (many-to-many) | Pivot table subquery + `json_agg`                 |
| **custom `mapping`**   | `LEFT JOIN LATERAL` + `row_to_json` (same as m:1) |

---

## Configuration

### Environment Variables

| Variable                     | Purpose                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `D3GOP_TYPES_SUFFIX`         | Suffix appended to all generated GQL entity type names (e.g. `'V2'` → `BookV2`, `AuthorV2`) |
| `D3GOP_SORT_SUFFIX`          | Suffix appended to sort/pagination types only (e.g. `'V2'` → `SortV2`, `BookV2OrderBy`)     |
| `D3GOP_LOG_TYPE`             | Logging level: `debug` or `disabled`                                                        |
| `D3GOP_DEFAULT_QUERY_LIMIT`  | Default query limit when pagination is not specified (default: `3000`)                      |
| `D3GOP_USE_STRING_FOR_JSONB` | Toggle between JSONB and string concatenation for JSON aggregation                          |

> **Type name collision**: If you have both v1 (`createGQLTypes`) and v2 (`@GQLEntityClass`) entities in the same schema, set `D3GOP_TYPES_SUFFIX` so v2 entity names are distinct (e.g. `Hobbit` → `HobbitV2`). Use `D3GOP_SORT_SUFFIX` separately if sort/pagination types also need a suffix. No `setGlobalConfig()` call is required — the env vars are read automatically.

### Programmatic config

```typescript
import { setGlobalConfig } from '@dav3/gql-of-power';

// Call before any @GQLEntityClass decorators run (i.e. before importing entity files)
setGlobalConfig({ gqlTypesSuffix: 'V2' });

// Optionally set a separate suffix for sort/pagination types
setGlobalConfig({ gqlTypesSuffix: 'V2', gqlSortSuffix: 'V2' });
```

---

## `GQLQueryManager`

```typescript
const queryManager = new GQLQueryManager();

// From a GraphQL resolver — fields are parsed from resolve info automatically
const results = await queryManager.getQueryResultsForInfo(
	metadataProvider,
	BookGQL, // @GQLEntityClass-decorated class or plain ORM class
	info, // GraphQLResolveInfo
	filter,
	pagination
);

// With explicit field selection (useful for testing or non-resolver contexts)
const results = await queryManager.getQueryResultsForFields(
	metadataProvider,
	BookGQL,
	{ id: {}, title: {} },
	filter,
	pagination
);
```

`BookGQL.relatedEntityName` (`'Book'`) is used automatically to look up ORM metadata — no need to pass the ORM class separately.

### Singular Queries

For fetching a single record, use the singular variants. These enforce `LIMIT 1` internally and return `K | null` instead of `K[]`:

```typescript
// From a GraphQL resolver
const ring = await queryManager.getQueryResultForInfo(
	metadataProvider,
	RingGQL,
	info,
	{ forgedBy: 'Sauron' },
	[{ forgedYear: 'desc' }] // optional orderBy — controls *which* record is returned
);
// ring: Ring | null

// With explicit field selection
const ring = await queryManager.getQueryResultForFields(
	metadataProvider,
	RingGQL,
	{ id: {}, name: {} },
	{ forgedBy: 'Sauron' },
	[{ forgedYear: 'desc' }]
);
// ring: Ring | null
```

No `limit` or `offset` parameters are accepted — `LIMIT 1` is always applied.

---

## Architecture

### Core Components

| Component             | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `GQLtoSQLMapper`      | Transforms GraphQL field selections into SQL with proper joins |
| `GQLQueryManager`     | Orchestrates query building and execution                      |
| `FilterProcessor`     | Translates GQL filter inputs to SQL WHERE clauses              |
| `RelationshipHandler` | Generates JOIN SQL for ORM-declared relations                  |
| `SQLBuilder`          | Assembles final SQL strings and JSON aggregations              |
| `AliasManager`        | Manages incremental SQL aliases to prevent naming conflicts    |

### Query Flow

1. **Parse** – `graphql-parse-resolve-info` extracts the requested fields from `GraphQLResolveInfo`
2. **Map** – `GQLtoSQLMapper.recursiveMap()` walks the field tree, building `select`, `join`, `where` sets
3. **Aggregate** – JSON aggregation (`row_to_json`, `json_agg`) combines nested results
4. **Bind** – Named parameters are bound via knex raw
5. **Execute** – Single SQL sent to the database

---

## Troubleshooting

### `FilterInput for referenced entity "X" is not registered`

This error fires at `buildSchema()` time when a relationship field, mapping custom-field filter, or `_exists` filter references an entity whose FilterInput was never registered.

**Cause:** You used `createGQLEntity()` (the deferred API) for entity `X` but forgot to call `X.buildResolvers()` before building the schema. The entity's ObjectType is registered, but its FilterInput is not.

**Fix:** Either switch the entity to `@GQLEntityClass` / `createGQLTypes()` (which call `buildResolvers()` automatically), or add the missing call:

```typescript
// schema/index.ts — collect ALL entities and call buildResolvers()
const BookGQL = BookEntity.buildResolvers();
const AuthorGQL = AuthorEntity.buildResolvers();
```

Before August 2026 this was a **silent wrong-type bug**: the missing FilterInput fell back to the parent entity's FilterInput, so `Author.books` would generate `AuthorFilterInput` instead of `BookFilterInput`. The library now throws with the message above.

### Mapping custom-field filter is missing from the schema

If a `customFields` entry with `mapping` doesn't produce its nested filter (e.g. `HomeRegion: { name_eq: '...' }` is absent), check whether `resolve` was **also** set on the same field:

```typescript
customFields: {
	homeRegion: {
		type: () => RegionGQL.GQLEntity,
		mapping: { refEntity: Region, refFields: 'id', fields: 'homeRegionId' },
		generateFilter: true,
		resolve: (root) => ...,  // ← THIS makes the filter silently disappear
	},
},
```

`resolve` and `mapping` are **mutually exclusive** on the same custom field. When both are set, only the resolver registers — the mapping filter is skipped. TypeScript's `CustomFieldSettings<T>` union enforces this at the type level, but `as any` bypasses it. Remove `resolve` (and `resolveDecorators`/`requires`) from a mapping-strategy field.

### Filter key is PascalCase, not camelCase

Mapping custom-field filters appear in the FilterInput under a **capitalized** key:

```graphql
# ✅ Correct — PascalCase filter key
persons(filter: { HomeRegion: { name_eq: 'Gondor' } }) { ... }

# ❌ Wrong — camelCase doesn't exist on the FilterInput
persons(filter: { homeRegion: { name_eq: 'Gondor' } })
# Field "homeRegion" is not defined by type "PersonFilterInput". Did you mean "HomeRegion"?
```

The field **selection** in the query stays camelCase (`homeRegion { ... }`); only the filter key is capitalized. Count-field nested filters follow the same rule (`BookCount: { _gte: 2 }`).

### Relationship-field filters aren't statically typed

`GQLEntityFilterInputFieldType<T>` surfaces filter operators for scalar fields but does **not** statically include nested relationship sub-filters (they're generated at runtime). Cast the filter object `as any` when using relationship filters:

```typescript
queryManager.getQueryResultsForInfo(provider, PersonGQL, info, {
	fellowship: { id_in: [1, 2] }, // works at runtime, not statically typed
} as any);
```

This is the library's own test-suite pattern.

### `mapNumericEnum` filter values silently fail inside nested/inline filters

If a `mapNumericEnum` field filters correctly at the **top level** but silently returns no results (or the wrong rows) when placed inside an inline field-argument filter on a nested relation — e.g.:

```graphql
# Works: top-level filter → 'InProgress' converted to 1
bearers(filter: { questState: InProgress }) { name }

# Silently failed before August 2026: inline filter → 'InProgress' passed as a string
rings { bearer(filter: { questState: InProgress }) { name } }
```

**Cause:** enum conversion (`convertFilterEnumValues`) was historically applied only to top-level filters in `GQLQueryManager`. Inline field-argument filters (`books(filter: {...})`), count-field filters (`bookCount(filter: {...})`), and multi-level nested filters entered the SQL mapper through a different code path that bypassed conversion entirely. The `mapNumericEnum` string key went straight to SQL as a string instead of being converted to the numeric DB value, so the `WHERE` clause silently matched nothing.

**Fix (August 2026):** `handleFieldArguments` and `mapCountField` in the SQL mapper now call `convertFilterEnumValues` on inline filter args before SQL generation. The conversion resolves the target entity's `mapNumericEnum` fields through the parent entity's relation-field registry and recurses to arbitrary depth. This means filters now behave identically at the top level, inside `relation(filter:)`, inside nested `relation(filter: { nested: {...} })`, inside count subqueries, and inside `_or`/`_and` arrays at any level.

**If you still see this pattern:** ensure the target entity is decorator-registered (`@GQLEntityClass` / `createGQLTypes`) so its `mapNumericEnum` fields appear in the `MapEnumFieldsMap` registry — conversion silently passes values through for unregistered entities.

---

## Known Limitations

- ⚠️ Order by columns on related/joined tables not supported
- ⚠️ ACL pending async refactoring

---

## Agent Integration

This library ships an **agent skill** (`agents/`) that teaches AI coding assistants (Claude Code, Cursor, Hermes, or any agent reading `AGENTS.md`) how to scaffold gql-of-power entities, relationships, and advanced features correctly — using copy-paste templates, annotated relationship examples, and a decision tree for picking the right relationship type.

To install it in a consumer project (one-time setup):

```bash
# Claude Code
mkdir -p .claude/skills && cp -R node_modules/@dav3/gql-of-power/agents/ .claude/skills/gql-of-power/

# Cursor
mkdir -p .cursor/rules && cp node_modules/@dav3/gql-of-power/agents/SKILL.md .cursor/rules/gql-of-power.mdc

# Hermes
ln -s node_modules/@dav3/gql-of-power/agents ~/.hermes/skills/gql-of-power
```

See [`agents/install.md`](./agents/install.md) for full instructions (including a symlink option that tracks gql-of-power updates, slash-command setup, and a generic `AGENTS.md` snippet). Once installed, ask your agent to "add a gql-of-power entity" and it will follow the library's intended patterns.

---

## Development

```bash
bun install        # Install dependencies
bun run build      # Compile TypeScript → dist/
bun run test       # Run all tests
bun run test:watch # Watch mode
bun run audit      # Codebase-intelligence gate (fallow): dead code, duplication, complexity
```

`bun run audit` runs the changed-file gate against saved baselines in `.fallow/` and fails only on **new** findings it introduces. Use `bun run audit:full` for the complete report, or `bun run audit:dead-code` / `audit:dupes` / `audit:health` for individual analyses. See `AGENTS.md` for the full audit workflow.

---

## License

MIT NON-AI License — Forged by [Dav3](https://github.com/dave-palt) with the wisdom of Middle-earth.

---

> _"All we have to decide is what to do with the queries that are given us. And by using GQL of Power, that decision becomes much simpler."_
>
> — Adapted from J.R.R. Tolkien
