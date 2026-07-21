# Implementing a MetadataProvider

The `MetadataProvider` interface adapts gql-of-power to whatever ORM you use. It tells the library: does this entity exist, what's its SQL metadata, and how do I execute raw SQL.

## The interface

```typescript
export type MetadataProvider = {
	/** Does this ORM entity name exist? */
	exists: (entityName: string) => boolean;
	/** Return the SQL metadata for an entity (table, primary keys, columns, relationships). */
	getMetadata: <T, K extends EntityMetadata<T>>(entityName: string) => K;
	/** Execute a raw SQL string with bindings, return rows. */
	executeQuery: (sql: string, ...params: any[]) => Promise<any>;
} & SqlClientConfiguration; // `client: string | typeof Knex.Client` for SQL dialect
```

`DatabaseDriver` is satisfied by either a `rawQuery(sql, bindings)` method (preferred — you fully control binding) or a Knex `client` (the library uses Knex to bind).

## Minimal in-memory provider (for examples/testing)

```typescript
import { knex } from 'knex';
import type { EntityMetadata, MetadataProvider } from '@dav3/gql-of-power';

const ALL_METADATA: Record<string, EntityMetadata<any>> = {
	Person: { name: 'Person', tableName: 'persons', primaryKeys: ['id'], properties: {/* ... */} },
};

export class MyProvider implements MetadataProvider {
	client = 'pg'; // Knex dialect: 'pg' | 'mysql' | 'sqlite3' | ...

	exists(name: string): boolean {
		return name in ALL_METADATA;
	}

	getMetadata<T, K extends EntityMetadata<T>>(name: string): K {
		return ALL_METADATA[name] as K;
	}

	async executeQuery(sql: string, ...params: any[]) {
		// Use your DB driver. With Knex binding:
		const bound = knex({ client: this.client }).raw(sql, params).toString();
		return await myDb.query(bound);
	}
}
```

## Adapting an existing ORM

For a real ORM (MikroORM, TypeORM, Prisma), you translate its metadata into `EntityMetadata`:

- `tableName` — the ORM's table name for the entity
- `primaryKeys` — the ORM's PK column(s)
- `properties[prop].fieldNames` — the SQL column name(s) for that property (often one, can be composite)
- `properties[prop].reference` — set `ReferenceType` + join columns for relationship properties

The provider caches/memoizes metadata lookups as needed — `getMetadata` is called per field during query mapping, so it should be fast (a pre-built map is ideal).

## Using the provider

```typescript
const provider = new MyProvider();
const queryManager = new GQLQueryManager();

// Plural
const rows = await queryManager.getQueryResultsForInfo(provider, Person, info, filter, pagination);
// Singular (forces LIMIT 1)
const one = await queryManager.getQueryResultForInfo(provider, Person, info, filter, orderBy);
```

The library never opens a DB connection itself — it generates SQL and hands it to `provider.executeQuery`. You own the connection lifecycle.
