# ⚔️ GQL of Power

> **"One Query to Rule Them All"** — Master your data with the power of a single GraphQL query

---

## The Ring Bearer's Tale

In the age of microservices and data loaders, a shadow falls upon performance: _the N+1 query problem_. Weary developers traverse the lands of Middleware-earth, orchestrating countless queries to fetch interconnected data.

But what if there was another way? What if, with the power of a single query, you could bind all your data together?

**GQL of Power** is a TypeScript library that harnesses ancient sorcery to generate perfectly optimized SQL queries from your GraphQL operations. It eliminates the need for data loaders entirely — one query to fetch your complete data structure, no matter how deeply nested your relationships run.

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

| Operation      | Meaning                                                |
| -------------- | ------------------------------------------------------ |
| `_eq`          | Equal                                                  |
| `_ne`          | Not equal                                              |
| `_in`          | In array                                               |
| `_nin`         | Not in array                                           |
| `_like`        | ILIKE (case-insensitive contains)                      |
| `_gt` / `_gte` | Greater than / greater than or equal                   |
| `_lt` / `_lte` | Less than / less than or equal                         |
| `_and`         | Logical AND                                            |
| `_or`          | Logical OR (generates UNION ALL)                       |
| `_exists`      | Check related entities exist (AND-combined per key)    |
| `_not_exists`  | Check no related entities exist (AND-combined per key) |

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

## Known Limitations

- ⚠️ Class-level `_not` conditions not yet supported
- ⚠️ Order by columns on related/joined tables not supported
- ⚠️ ACL pending async refactoring

---

## Development

```bash
bun install        # Install dependencies
bun run build      # Compile TypeScript → dist/
bun run test       # Run all tests
bun run test:watch # Watch mode
```

---

## License

MIT NON-AI License — Forged by [Dav3](https://github.com/dave-palt) with the wisdom of Middle-earth.

---

> _"All we have to decide is what to do with the queries that are given us. And by using GQL of Power, that decision becomes much simpler."_
>
> — Adapted from J.R.R. Tolkien
