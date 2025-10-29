# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

`@dav3/gql-of-power` is a TypeScript library that generates optimized SQL queries from GraphQL queries, eliminating the N+1 query problem by producing a single SQL query for complex nested data structures. It's framework-agnostic and works with any ORM through a `MetadataProvider` interface.

**Theme**: This project references Lord of the Rings lore ("Ring of Power" → "GQL of Power"). All examples, tests, and entity names should use Middle-earth themes (Hobbits, Elves, Dwarves, Gondor, Rohan, Fellowship, etc.).

## Core Architecture

### Query Flow
1. **GraphQL parsing** → `getGQLFields()` extracts field selections from GraphQL resolve info
2. **SQL mapping** → `GQLtoSQLMapper.recursiveMap()` builds SQL fragments recursively
3. **JSON aggregation** → Nested data is aggregated using PostgreSQL's `jsonb_build_object()` or string concatenation
4. **Query execution** → Final SQL is executed via the provider's `executeQuery()` method

### Main Components

- **GQLtoSQLMapper** (`src/queries/gql-to-sql-mapper.ts`): Core transformation engine that converts GraphQL field selections and filters into SQL with proper joins and projections
- **GQLQueryManager** (`src/query-manager.ts`): Orchestrates the entire query process from GraphQL info to result mapping
- **Entity System** (`src/entities/`): Type-safe GraphQL entity definitions with automatic filter/pagination input generation via TypeGraphQL decorators
- **Operations** (`src/operations.ts`): Defines field-level (`_eq`, `_in`, `_like`, etc.) and class-level (`_and`, `_or`, `_not`) filter operations

### Supporting Systems

- **Alias Manager** (`src/queries/alias.ts`): Generates incremental table aliases (`a1`, `a2`, ...) to prevent conflicts in complex joins
- **Filter Processor** (`src/queries/filter-processor.ts`): Converts GraphQL filter inputs into SQL WHERE clauses, handles OR→UNION ALL transformation
- **SQL Builder** (`src/queries/sql-builder.ts`): Constructs final SQL with proper escaping and named parameter binding
- **Relationship Handler** (`src/queries/relationship-handler.ts`): Manages 1:1, 1:m, m:1, m:m relationships and generates appropriate JOINs or subqueries

### MetadataProvider Interface

The library abstracts ORM-specific logic through a `MetadataProvider` that provides:
- **Entity metadata**: Table names, primary keys, field→column mappings
- **Relationship metadata**: Join columns, reference types, junction tables (for m:m)
- **Query execution**: `executeQuery()` method to run generated SQL
- **Type checking**: `exists()` to validate entity names

This design allows the library to work with TypeORM, MikroORM, Prisma, or any custom ORM.

## Common Commands

This project uses **Bun** for all operations (package management, building, and testing).

### Development
```bash
# Install dependencies
bun install

# Build the library (compiles TypeScript to dist/)
bun run build

# Watch mode for development
bun run watch

# Prepare for publishing (runs build)
bun run prepublishOnly
```

### Testing

Tests are organized into `tests/unit/` and `tests/integration/` directories. The test runner uses Bun with the `D3GOP_LOG_TYPE="disabled"` environment variable to suppress logging during tests.

```bash
# Run all tests
bun test
# or
bun run test

# Run only unit tests
bun run test:unit

# Run only integration tests
bun run test:integration

# Watch mode (re-run tests on file changes)
bun run test:watch

# Generate coverage report
bun run test:coverage

# Run a specific test file
bun test tests/unit/gql-to-sql-mapper.test.ts

# Run tests matching a pattern
bun test --filter="relationship"
```

## Key Concepts

### Custom Fields

Beyond automated SQL generation, you can define **custom fields** on entities that execute custom logic (e.g., DataLoaders, computed properties, ACL checks). Custom fields are configured when calling `createGQLTypes()` and must specify:

- `type`: GraphQL return type
- `requires`: Array of fields that must be fetched from the database for the resolver
- `resolve`: Function receiving `(root, ctx, info)` that returns the field value
- `resolveDecorators`: TypeGraphQL parameter decorators (`Root()`, `Ctx()`, `Info()`)

Custom fields are resolved **after** the main query completes, receiving the fetched entity data.

### Filter Operations

**Field-level operations** (applied to individual columns):
- `_eq`, `_ne`: Equality/inequality
- `_in`, `_nin`: Array membership
- `_like`, `_ilike`: Pattern matching
- `_gt`, `_gte`, `_lt`, `_lte`: Numeric/date comparisons
- `_is_null`: NULL checks

**Class-level operations** (combine multiple conditions):
- `_and`: All conditions must be true
- `_or`: At least one condition must be true (converted to UNION ALL for performance)
- `_not`: Negates the condition

**Important**: OR conditions work across all fields but generate separate queries combined with UNION ALL. This prevents inefficient OR joins and improves query performance.

### Relationship Handling Strategy

| Relationship | SQL Strategy | Aggregation |
|--------------|--------------|-------------|
| **1:1, m:1** | Direct JOIN to related table | Single `jsonb_build_object()` |
| **1:m, m:m** | Subquery with aggregation | `json_agg(jsonb_build_object())` for arrays |

Nested filters are applied at each relationship level. For example, filtering books by author name will add a WHERE clause to the author join.

### JSON Aggregation Modes

The library can generate nested JSON in two ways:

1. **JSONB (default)**: Uses PostgreSQL's native `jsonb_build_object()` and `json_agg()` functions
2. **String concatenation**: Set `D3GOP_USE_STRING_FOR_JSONB=true` to build JSON via string concatenation (useful for debugging or non-PostgreSQL databases)

## Development Guidelines

### Testing Strategy

- **Unit tests** (`tests/unit/`): Focus on individual components (filter-processor, sql-builder, relationship-handler) with mocked dependencies
- **Integration tests** (`tests/integration/`): Test full query flow with actual database connections and complex relationship scenarios
- **Mock metadata providers**: Tests use custom metadata providers to avoid requiring a full ORM setup

### Environment Variables

```bash
# JSON aggregation mode (default: false, uses JSONB)
D3GOP_USE_STRING_FOR_JSONB=true

# Logging level for development/debugging
D3GOP_LOG_TYPE="debug"    # Options: "debug", "disabled"
```

### Debugging & Performance

The library includes extensive timing logs when `D3GOP_LOG_TYPE="debug"`:
- Query building phases are timed with `logger.time()` and `logger.timeLog()`
- Result mapping performance is tracked
- SQL queries and bindings are logged before execution

### Known Limitations

From `TODO.md`, these features are not yet implemented:
- ❌ **Class-level NOT conditions**: `_not` operator has limited support
- ❌ **Order by reference table**: Cannot order entities by fields in related tables (e.g., "order authors by their latest book's publication date")
- ⚠️ **ACL system**: Types exist but async implementation is postponed (would require making query generation async)

### Type System Design

The library leverages TypeScript's advanced type system heavily:

- **Entity definitions**: Use TypeGraphQL decorators (`@ObjectType`, `@Field`) that are analyzed at runtime
- **Filter inputs**: Auto-generated from entity properties with proper typing for all operations
- **Pagination inputs**: Type-safe limit/offset/orderBy with field name validation
- **Metadata types**: Generic types ensure entity metadata matches entity class structure

### Architecture Decisions

**Alias generation**: Uses incremental numeric aliases (`a1`, `a2`, ...) instead of descriptive names to avoid collisions in deeply nested joins.

**OR→UNION ALL transformation**: OR conditions across filters are split into separate SELECT queries combined with UNION ALL, avoiding expensive OR joins.

**Named parameters**: Supports both named (`:param`) and positional (`?`) parameter binding depending on the database driver.

**Framework agnosticism**: The `MetadataProvider` interface allows any ORM to be used by implementing entity/relationship metadata extraction.

## Working with Examples

The `examples/` directory contains a full implementation using the go-collect system:
- Complete entity definitions with relationships
- Metadata provider implementation
- GraphQL schema and resolvers
- Authentication/authorization setup

To run examples:
```bash
cd examples/go-collect
bun install
bun run dev
```

## Release Process

The project uses a **git-flow** release process with two workflows:

1. **`prepare-release.yml`**: Manual trigger to create a release PR from `develop` to `main`
2. **`release.yml`**: Auto-publishes when release PR is merged to `main`

### Version Strategy
- **`main`**: Stable releases (e.g., `1.2.0`)
- **`develop`**: Next minor with `-dev` suffix (e.g., `1.3.0-dev`)

### Key Rules
- **Patch** (hotfix): Bumps main (e.g., `1.0.0` → `1.0.1`), develop stays at `1.1.0-dev` (already ahead)
- **Minor/Major**: Bumps main AND creates PR to bump develop to next minor

### Quick Release
```bash
# GitHub Actions → Prepare Release → Select develop → Choose patch/minor/major
# Review and merge PR to main
# Release workflow auto-publishes and handles version bumping
```

**Full documentation**: See `.github/RELEASE_PROCESS.md` for detailed workflows, examples, and troubleshooting.
