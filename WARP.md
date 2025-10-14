# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

`@dav3/gql-of-power` is a TypeScript library that generates SQL queries from GraphQL queries based on ORM entities. It bridges GraphQL operations with SQL databases by automatically creating optimized queries, handling joins, filters, and pagination.

**Note**: This project references Lord of the Rings lore ("Ring of Power" → "GQL of Power"). Examples and tests should be made referencing Middle-earth lore, characters, and locations (e.g., Hobbits, Elves, Dwarves, Gondor, Rohan, etc.).

## Core Architecture

### Main Components

- **GQLtoSQLMapper**: Core class that transforms GraphQL field selections and filters into SQL queries with proper joins and projections
- **QueryManager**: High-level interface that orchestrates the mapping process and executes queries
- **Entity System**: Type-safe system for defining GraphQL entities with automatic filter/pagination input generation
- **Operations**: Defines filtering operations (`_eq`, `_in`, `_like`, etc.) and class-level operations (`_and`, `_or`, `_not`)

### Key Files

- `src/queries/gql-to-sql-mapper.ts`: Main transformation logic from GQL to SQL
- `src/query-manager.ts`: Entry point for query execution
- `src/entities/gql-entity.ts`: GraphQL type generation and field metadata management
- `src/types.ts`: Complex type definitions for filters, pagination, and metadata
- `src/operations.ts`: Field and class-level operation definitions

### Metadata System

The library uses a `MetadataProvider` interface to abstract ORM metadata:
- **Entity metadata**: Table names, primary keys, field mappings
- **Relationship metadata**: Join columns, reference types (1:1, 1:m, m:1, m:m)
- **Field metadata**: Column names, data types

## Common Commands

### Development
```bash
# Install dependencies
pnpm install

# Build the library
pnpm run build

# Watch mode for development
pnpm run watch

# Run tests
pnpm test

# Build for publishing
pnpm run prepublishOnly
```

### Testing
```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test -- tests/gql-to-sql-mapper.basic.test.ts

# Run tests with coverage
pnpm test -- --coverage
```

## Key Concepts

### Query Mapping Flow
1. GraphQL field selection is parsed using `graphql-fields`
2. Filters and pagination are applied through generated input types
3. `GQLtoSQLMapper.recursiveMap()` builds SQL fragments recursively
4. Final SQL query is constructed with proper joins, WHERE clauses, and JSON aggregation

### JSON Aggregation
The library generates JSONB objects to return nested data efficiently:
- Uses `jsonb_build_object()` for single records
- Uses `json_agg(jsonb_build_object())` for arrays
- String concatenation mode available via `D3GOP_USE_STRING_FOR_JSONB=true`

### Filter Operations
Supports comprehensive filtering via generated input types:
- Field operations: `_eq`, `_ne`, `_in`, `_like`, `_gt`, etc.
- Class operations: `_and`, `_or`, `_not` with nested conditions
- OR conditions are converted to UNION ALL queries for performance

### Relationship Handling
- **1:1 and m:1**: Simple joins with condition filtering
- **1:m and m:m**: Subquery generation with proper aggregation
- **Nested filtering**: Filters can be applied at any level of the relationship tree

## Development Notes

### Testing Strategy
- Basic functionality tests focus on core mapping utilities
- Comprehensive tests cover complex relationship scenarios
- Mock metadata providers allow testing without actual ORM setup

### Environment Variables
- `D3GOP_USE_STRING_FOR_JSONB`: Toggle between JSONB and string concatenation for JSON building

### Debugging
The mapper includes extensive console timing for performance monitoring:
- Query building phases are timed and logged
- Result mapping performance is tracked

### Known Limitations (from TODO.md)
- OR conditions work only for columns in the same table (resolved via UNION ALL)
- Class-level AND/NOT conditions need enhancement
- Order by reference table not yet supported
- ACL (Access Control List) system planned for future

## Architecture Decisions

### Alias Management
Uses incremental alias generation (`a1`, `a2`, etc.) to avoid conflicts in complex joins

### Type Safety
Heavily uses TypeScript's type system to ensure:
- Field selections match entity properties
- Filters are type-safe against entity fields
- Relationship traversal maintains type information

### Performance Optimizations
- Uses Sets for field selection to avoid duplicates
- Converts OR conditions to UNION ALL for better query performance
- Supports string concatenation as alternative to JSON aggregation