# ⚔️ GQL of Power

> **"One Query to Rule Them All"** — Master your data with the power of a single GraphQL query

---

## The Ring Bearer's Tale

In the age of microservices and data loaders, a shadow falls upon performance: _the N+1 query problem_. Weary developers traverse the lands of Middleware-earth, orchestrating countless queries to fetch interconnected data.

But what if there was another way? What if, with the power of a single query, you could bind all your data together?

**GQL of Power** is a TypeScript library that harnesses ancient sorcery to generate perfectly optimized SQL queries from your GraphQL operations. It eliminates the need for data loaders entirely—one query to fetch your complete data structure, no matter how deeply nested your relationships run.

Like the One Ring wielding dominion over all other Rings, GQL of Power commands your database with singular authority.

---

## Features

### 🗡️ Query Unification

Generate a **single, optimized SQL query** from any GraphQL query structure—no matter how complex your relationships are.

- ✨ **Eliminate Data Loaders** – Replace the tedious choreography of multiple queries with one powerful statement
- 🏰 **Intelligent Relationship Handling** – Navigate 1:1, 1:m, m:1, and m:m relationships seamlessly
- 🔍 **Comprehensive Filtering** – Filter at any level of your nested query tree
- 📄 **Type-Safe Operations** – Full TypeScript support ensures your queries are error-free
- ⚡ **Performance Optimized** – UNION ALL for OR conditions, efficient JSONB aggregation, and strategic aliasing

### 🧙 Core Powers

- **Recursive Query Mapping** – Transforms GraphQL field selections into SQL recursively
- **Automatic Join Generation** – Intelligently creates JOINs based on ORM entity relationships
- **Dynamic Filtering** – Support for field-level and class-level filter operations (`_eq`, `_in`, `_like`, `_gt`, `_and`, `_or`, etc.)
- **Pagination Support** – Native limit and offset handling through generated input types
- **Custom Fields** – Extend entities with computed properties, DataLoaders, and business logic
- **Framework Agnostic** – Works with any ORM through a simple MetadataProvider interface

---

## Installation

```bash
# Using pnpm (recommended)
pnpm add @dav3/gql-of-power

# Using npm
npm install @dav3/gql-of-power

# Using yarn
yarn add @dav3/gql-of-power
```

---

## Quick Start

### 1. Define Your Entities

```typescript
import { GQLEntity } from '@dav3/gql-of-power';
import { ObjectType, Field, Int } from 'type-graphql';

@ObjectType()
export class Author extends GQLEntity {
	@Field(() => Int)
	id: number;

	@Field()
	name: string;

	@Field(() => [Book])
	books: Book[];
}

@ObjectType()
export class Book extends GQLEntity {
	@Field(() => Int)
	id: number;

	@Field()
	title: string;

	@Field()
	publicationYear: number;

	@Field(() => Author)
	author: Author;
}
```

### 2. Configure Metadata

Provide ORM metadata that tells GQL of Power about your tables, columns, and relationships:

```typescript
const metadataProvider = {
	getEntityMetadata: (entity) => ({
		tableName: 'authors',
		primaryKey: 'id',
		fields: {
			id: { columnName: 'id' },
			name: { columnName: 'name' },
		},
	}),
	// ... implement for all entities
};
```

### 3. Execute Your Query

```typescript
import { QueryManager } from '@dav3/gql-of-power';

const queryManager = new QueryManager(metadataProvider, knexInstance);

// Execute a complex query with a single SQL statement
const result = await queryManager.execute(
	Author,
	gqlInfo, // GraphQL resolve info
	{
		filter: { name: { _eq: 'Tolkien' } },
		pagination: { limit: 10, offset: 0 },
	}
);

// Returns all authors with all their books, published authors, and nested relationships
```

---

## Architecture: The Rings of Power

### The Fellowship: Core Components

| Component          | Purpose                                                           |
| ------------------ | ----------------------------------------------------------------- |
| **GQLtoSQLMapper** | The main artifact—transforms GraphQL into SQL with proper joins   |
| **QueryManager**   | The orchestrator—manages the entire query execution flow          |
| **EntitySystem**   | The registry—defines GraphQL entities with auto-generated filters |
| **Operations**     | The spells—defines all available filtering operations             |

### The Fellowship's Journey: Query Flow

1. **Parsing** – GraphQL field selections are parsed using `graphql-fields`
2. **Mapping** – `GQLtoSQLMapper.recursiveMap()` builds SQL recursively
3. **Aggregation** – JSON aggregation combines nested results efficiently
4. **Execution** – Final SQL is executed against your database

---

## Advanced Usage

### Comprehensive Filtering

Filter at any nesting level with powerful operations:

```typescript
// Find authors with published books
await queryManager.execute(Author, gqlInfo, {
	filter: {
		books: {
			publicationYear: { _gte: 2000 },
		},
	},
});

// Complex nested AND/OR conditions
await queryManager.execute(Author, gqlInfo, {
	filter: {
		_and: [{ name: { _like: '%Tolkien%' } }, { books: { publicationYear: { _gte: 1950 } } }],
	},
});
```

### Pagination & Sorting

```typescript
await queryManager.execute(Author, gqlInfo, {
	pagination: {
		limit: 20,
		offset: 40,
		orderBy: 'name', // ASC by default
		orderByDirection: 'DESC',
	},
});
```

### Filter Operations

| Operation      | Example                           | Meaning                            |
| -------------- | --------------------------------- | ---------------------------------- |
| `_eq`          | `{ id: { _eq: 5 } }`              | Equal to                           |
| `_ne`          | `{ status: { _ne: 'inactive' } }` | Not equal to                       |
| `_in`          | `{ id: { _in: [1, 2, 3] } }`      | In array                           |
| `_like`        | `{ name: { _like: '%Frodo%' } }`  | String contains (case-insensitive) |
| `_gt` / `_gte` | `{ year: { _gte: 1900 } }`        | Greater than (or equal)            |
| `_lt` / `_lte` | `{ year: { _lte: 2000 } }`        | Less than (or equal)               |

### Custom Fields

Beyond GQL of Power's automated query generation, you can add **custom fields** that execute custom logic alongside your data fetching. Perfect for computed properties, cross-cutting concerns, or batch loading.

```typescript
// Define custom fields when creating GraphQL types
const FellowshipGQL = createGQLTypes(Fellowship, FellowshipFields, {
  customFields: {
    // Custom field that fetches the first fellowship member
    firstMember: {
      type: () => GraphQLJSON,
      options: { nullable: true },
      requires: ['id'], // Fields that must be fetched from the database for this resolver
      resolveDecorators: [Root(), Ctx(), Info()], // TypeGraphQL parameter decorators for the resolve function
      resolve: (root: Fellowship, ctx: any, info: any) => {
        // Your custom logic—can use DataLoader for batch loading
        return memberDataLoader.load(root.id);
      },
    },
  },
});

// Export FieldsResolver to use in your resolver classes
export const FellowshipFieldsResolver = FellowshipGQL.FieldsResolver;
```

#### Custom Field Configuration

| Property | Purpose | Connection |
|----------|---------|------------|
| `type` | Declares the GraphQL return type that appears in the schema | The type clients see when querying this field |
| `options` | TypeGraphQL field options like nullable, deprecation, descriptions | Controls field behavior in the GraphQL schema |
| `requires` | Specifies which fields from the main query must be present in the result | GQL of Power ensures these database columns are fetched alongside the optimized query |
| `resolve` | Function that receives the root entity object and returns the custom field value | Executed after the main query completes, receiving the fetched entity data |
| `resolveDecorators` | TypeGraphQL decorators that map function parameters | Determines which context parameters (`Root`, `Ctx`, `Info`) are injected into the resolve function |

#### Use Cases

🧙 **DataLoader Integration** – Batch-load related data without N+1
```typescript
firstMember: {
  type: () => PersonGQL.GQLEntity,
  resolve: (root: Fellowship) => memberDataLoader.load(root.id),
}
```

✨ **Computed Properties** – Calculate derived values
```typescript
memberCount: {
  type: () => Number,
  resolve: (root: Fellowship) => root.members?.length || 0,
}
```

🎭 **Business Logic** – Apply formatting, ACL, or transformations
```typescript
formattedName: {
  type: () => String,
  resolve: (root: Fellowship) => formatTitle(root.name),
}
```

#### Using Custom Fields in Resolvers

To make custom fields available in your GraphQL resolvers, extend the generated `FieldsResolver` class:

```typescript
import { Resolver, Query, Arg, Info } from 'type-graphql';
import { FellowshipGQL, FellowshipFieldsResolver } from './entities';

@Resolver(() => FellowshipGQL.GQLEntity)
export class FellowshipResolver extends FellowshipFieldsResolver {
  @Query(() => [FellowshipGQL.GQLEntity])
  async fellowships(
    @Info() info: GraphQLResolveInfo,
    @Arg('filter', () => FellowshipGQL.GQLEntityFilterInput, { nullable: true })
    filter?: GQLEntityFilterInputFieldType<Fellowship>
  ) {
    return await queryManager.getQueryResultsForInfo(
      metadataProvider,
      Fellowship,
      info,
      filter
    );
  }
}
```

The `FieldsResolver` automatically handles custom field resolution alongside the main query execution. When a client requests a custom field, it will be resolved using your custom resolver logic while the rest of the query is handled by GQL of Power's optimized SQL generation.

---

## Configuration

### Environment Variables

```bash
# Toggle between JSONB and string concatenation for JSON aggregation
D3GOP_USE_STRING_FOR_JSONB=true

# Control logging output
D3GOP_LOG_TYPE="debug"  # Options: debug, disabled
```

---

## Common Commands

### Development

```bash
# Install dependencies
pnpm install

# Build the library
pnpm run build

# Watch mode for development
pnpm run watch

# Run all tests
pnpm test

# Run unit tests only
pnpm test:unit

# Run integration tests only
pnpm test:integration

# Watch mode for tests
pnpm test:watch

# Generate coverage report
pnpm test:coverage

# Build for publishing
pnpm run prepublishOnly
```

---

## Why GQL of Power?

### The Problem It Solves

Traditional GraphQL + ORM combinations suffer from the **N+1 query problem**:

- Query 1: Fetch 10 authors
- Query 2-11: Fetch books for each author (10 queries)
- Query 12-21: Fetch publication details for each book (10 queries)
- **Total: 21 queries** ❌

### The Solution

```
GQL of Power: Fetch all data in **1 query** ✅
```

By analyzing your GraphQL query structure and ORM relationships, GQL of Power generates a single, optimized SQL query with intelligent joins and aggregations that returns your complete data structure.

---

## Architecture Highlights

### Relationship Handling

| Relationship | Strategy                                |
| ------------ | --------------------------------------- |
| **1:1**      | Simple INNER/LEFT JOIN                  |
| **m:1**      | INNER/LEFT JOIN to parent table         |
| **1:m**      | Subquery with JSON aggregation          |
| **m:m**      | Through junction table with aggregation |

### Performance Optimizations

- **Alias Management** – Incremental aliases (`a1`, `a2`, ...) prevent naming conflicts
- **Set-Based Field Selection** – Eliminates duplicate fields automatically
- **OR to UNION ALL** – Converts OR conditions to UNION queries for optimal execution plans
- **JSONB Aggregation** – Efficient nested data structure building

---

## Known Limitations

These dragons still slumber in the cave—future challenges for brave developers:

- ⚠️ Class-level `NOT` conditions not yet supported
- ⚠️ Order by reference table columns (e.g., "order authors by their latest book publication")
- ⚠️ Access Control Lists (ACL) pending async refactoring

---

## Examples

See the `/examples` directory for complete, runnable examples:

- **Middle-earth Schema** – Full Author/Book relationship example inspired by Tolkien's lore
- **Database Integration** – Real PostgreSQL examples with TypeTypeORM metadata

---

## Contributing

Contributions are welcome! Whether you're fixing bugs, improving performance, or adding features, please submit a pull request.

---

## License

MIT NON-AI License

Forged by [Dav3](https://github.com/dave-palt) with the wisdom of Middle-earth.

---

## Support & Community

- 📖 Full documentation coming soon
- 🐛 Found a bug? [Open an issue](https://github.com/dave-palt/gql-of-power/issues)
- 💬 Have a question? Reach out to the fellowship

---

> _"All we have to decide is what to do with the queries that are given us. And by using GQL of Power, that decision becomes much simpler."_
>
> — Adapted from J.R.R. Tolkien
