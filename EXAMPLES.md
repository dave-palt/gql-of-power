# GQL of Power — Mapping Guide

This guide shows how to map a database table through to a GraphQL type using `@dav3/gql-of-power`. There are two strategies for exposing related entities, each demonstrated below with examples drawn from the archives of Middle-earth.

---

## The Full Pipeline

Every entity follows the same 4-step pipeline:

```
Database Table → ORM Entity → GQL Entity (defineFields + @GQLEntityClass) → Resolver (@GQLResolver)
```

### Step 1 — Database Migration

Create the table with foreign key columns as plain columns (no ORM-level constraints needed):

```sql
CREATE TABLE IF NOT EXISTS "quest" (
  "id" UUID PRIMARY KEY,
  "fellowship_id" UUID,
  "status_code" INT
);
CREATE INDEX IF NOT EXISTS "quest_fellowship_id_idx" ON "quest" ("fellowship_id");
```

### Step 2 — ORM Entity

Define the entity with your ORM. The key decision point is **how you declare relationships** — this determines which GQL mapping strategy you use (see below).

### Step 3 — GQL Entity

Use `defineFields` to declare the GraphQL schema and `@GQLEntityClass` to generate the type, filters, pagination, and field resolver automatically.

### Step 4 — Resolver

Use `@GQLResolver` to declare custom queries (list, get, etc.) that feed into the query manager.

---

## Strategy A — Direct ORM Relation (recommended when possible)

Use this when the ORM entity declares the relationship as a `@ManyToOne` / `@OneToMany` / `@ManyToMany`. GQL of Power reads the ORM metadata and generates the SQL JOINs automatically.

### ORM Entity Example

```typescript
@Entity({ tableName: 'quest_item' })
export class QuestItem extends BaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'string', nullable: true })
  questId?: string;

  // The FK column is stored as a plain property...
  @ManyToOne(() => Quest, {
    fieldName: 'quest_id',
    columnType: 'uuid',
    ref: true,
    nullable: true,
    persist: false,   // ...but the relation is NOT persisted through the ORM
  })
  quest?: Ref<Quest>;

  @Property({ type: 'float', nullable: true })
  quantity?: number;
}
```

**Key points:**
- The FK value (`questId`) is a regular `@Property` — it gets persisted normally.
- The relation (`quest`) is `@ManyToOne` with `persist: false` — the ORM knows the metadata (table, join columns, reference type) but will never try to write through this field.
- The `ref: true` wraps the relation in a `Ref<T>` proxy for lazy loading if needed outside of GQL of Power.

### GQL Entity

```typescript
import { defineFields, GQLEntityBase, GQLEntityClass } from '@dav3/gql-of-power';
import { QuestItem } from './quest-item.orm';
import { ID } from 'type-graphql';
import { QuestGQL } from './quest.gql';

const fields = defineFields(QuestItem, {
  id: { type: () => ID, generateFilter: true },
  questId: { type: () => String, generateFilter: true },
  quantity: { type: () => Float, generateFilter: true },
  // Direct relation — the ORM metadata tells GQL of Power how to JOIN
  quest: {
    type: () => QuestGQL,
    generateFilter: true,
    relatedEntityName: () => QuestGQL.relatedEntityName,
    getFilterType: () => QuestGQL.FilterInput,
    options: { nullable: true },
  },
});

@GQLEntityClass(QuestItem, fields)
export class QuestItemGQL extends GQLEntityBase {}
```

**Key points:**
- `relatedEntityName` returns the ORM class name (e.g. `'Quest'`), used to look up metadata.
- `getFilterType` returns the generated `FilterInput` class for nested filtering.
- The `type` must point to another `@GQLEntityClass`-decorated class.

### Resolver

```typescript
import { GQLQueryManager, GQLResolver } from '@dav3/gql-of-power';
import { Arg, Info, Query } from 'type-graphql';
import { QuestItemGQL } from '../../entities';
import { mikroMetadataProvider } from '../../mikro-metadata-provider';

const queryManager = new GQLQueryManager();

@GQLResolver(QuestItemGQL)
export class QuestItemGQLResolver {
  @Query(() => [QuestItemGQL])
  async questItemsV2(
    @Arg('filter', () => QuestItemGQL.FilterInput, { nullable: true }) filter: any,
    @Arg('pagination', () => QuestItemGQL.PaginationInput, { nullable: true }) pagination: any,
    @Info() info: GraphQLResolveInfo
  ): Promise<any[]> {
    return queryManager.getQueryResultsForInfo(
      mikroMetadataProvider,
      QuestItemGQL,
      info,
      filter,
      pagination
    );
  }
}
```

---

## Strategy B — Custom Field Mapping (no ORM relation)

Use this when the FK column exists as a plain property on the ORM entity but there is **no** `@ManyToOne` declaration. GQL of Power generates the SQL JOIN from the `mapping` config alone.

### ORM Entity Example

```typescript
@Entity({ tableName: 'weapon' })
export class Weapon extends BaseEntity {
  @PrimaryKey({ type: new BigIntType('string') })
  id!: string;

  // Plain FK column — no @ManyToOne relation declared
  @Property({ type: 'string', columnType: 'uuid', nullable: false })
  weaponTypeId?: string;
}
```

### GQL Entity

```typescript
import { defineFields, GQLEntityBase, GQLEntityClass } from '@dav3/gql-of-power';
import { Weapon } from './weapon.orm';
import { ID } from 'type-graphql';
import { WeaponTypeGQL } from './weapon-type.gql';

const fields = defineFields(Weapon, {
  id: { type: () => ID, generateFilter: true },
  weaponTypeId: { type: () => String, generateFilter: true },
});

@GQLEntityClass(Weapon, fields, {
  customFields: {
    // This field does NOT exist as an ORM relation — it's resolved purely via SQL JOIN
    weaponType: {
      type: () => WeaponTypeGQL,
      options: { nullable: true },
      mapping: {
        refEntity: WeaponType,       // ORM class to JOIN to
        refFields: 'id',              // column on WeaponType to match
        fields: 'weaponTypeId',       // column on Weapon (the FK)
      },
    },
  },
})
export class WeaponGQL extends GQLEntityBase {}
```

**Key points:**
- `weaponType` is not a property on the ORM entity, so it goes in `customFields` (not `fields`).
- `mapping.refEntity` is the **ORM class** (not the GQL class). GQL of Power uses the metadata provider to resolve table/column names.
- `mapping.refFields` and `mapping.fields` accept a single string or an array for composite keys.
- No `resolve` function is needed — the library generates a `LEFT OUTER JOIN LATERAL` subquery automatically.

---

## When to use which strategy?

| Situation | Strategy | Why |
|---|---|---|
| ORM already has a `@ManyToOne` / `@OneToMany` | **A — Direct relation** | GQL of Power reads the ORM metadata directly. Less config. |
| FK exists as a plain `@Property` column, no ORM relation | **B — Custom field mapping** | No need to add an ORM relation just for GQL. The `mapping` config handles the JOIN. |
| You need a DataLoader or custom resolver logic | **B — Custom field with `resolve`** | Use `resolve` + `resolveDecorators` for batch loading. |
| Composite FK (multi-column join) | **B — Custom field mapping** | `mapping.fields` and `mapping.refFields` accept arrays. |

---

## Registration Checklist

After creating your entity and resolver, wire them into the application:

1. **Migration index** — `export * from './624-AddMyTable';`
2. **ORM entities index** — `export * from './my-entity';` + add to `allEntities()` array
3. **GQL entities index** — `export * from './my-entity.gql';`
4. **Schema resolver index** — Import the resolver class and add to the resolvers array
5. The auto-generated `FieldsResolver` (for custom fields) is picked up via `...getAutoResolvers()` in the schema index

---

## How the Metadata Provider Bridges ORM → GQL

The `mikroMetadataProvider` in `graphql-api/src/v2/mikro-metadata-provider.ts` is the bridge. It:

1. Reads MikroORM's `getMetadata()` for each entity
2. Maps `ReferenceKind` enums to GQL of Power's `ReferenceType` enums
3. Extracts `fieldNames`, `joinColumns`, `referencedColumnNames`, etc.
4. Provides `executeQuery()` to run the generated SQL

When using Strategy A, the provider already has all the relation metadata. When using Strategy B, the `mapping` config in `customFields` provides the join information directly.
