# Relationship types — annotated examples

The library supports four relationship types (`ReferenceType` enum). Each needs the right `reference` value in `EntityMetadata` and matching field settings. Below: both sides of every relationship, Middle-earth themed.

The `createProperty` helper used here matches the one in `examples/web-playground/src/schema/entities.ts`.

## 1:1 — Person ↔ Ring (via Ring.bearerId)

A one-to-one is a m:1/1:m pair with a unique FK. Here Ring holds `bearerId`.

**Ring side (holds the FK → m:1 shape):**

```typescript
// schema/entities.ts — EntityMetadata
bearer: createProperty('Person', 'bearer', ['bearer_id'], {
  referenceType: ReferenceType.MANY_TO_ONE,
  joinColumns: ['bearer_id'],        // column on Ring's table
  referencedColumnNames: ['id'],      // column on Person's table
}),
```

```typescript
// schema/fields.ts — FieldsSettings
bearer: {
  type: () => PersonGQL.GQLEntity,
  options: { nullable: true },
  generateFilter: true,
  relatedEntityName: () => Person.name,
  getFilterType: () => Int, // type of the FK column for contains/overlap filters
},
```

**Person side (inverse → 1:1 via mappedBy):**

```typescript
// EntityMetadata — Person
ring: createProperty('Ring', 'ring', [], {
  referenceType: ReferenceType.ONE_TO_ONE,
  mappedBy: 'bearer', // the property name on Ring that holds the FK
}),
```

```typescript
// FieldsSettings
ring: {
  type: () => RingGQL.GQLEntity,
  generateFilter: true,
  relatedEntityName: () => Ring.name,
  getFilterType: () => Int,
},
```

## 1:m — Fellowship → Members (Fellowship has many Person)

**Fellowship side (the "one"):**

```typescript
// EntityMetadata — Fellowship
members: createProperty('Person', 'members', [], {
  referenceType: ReferenceType.ONE_TO_MANY,
  mappedBy: 'fellowship', // the FK property on Person
}),
```

```typescript
// FieldsSettings
members: {
  type: () => PersonGQL.GQLEntity,
  generateFilter: true,
  array: true,                         // <-- returns many
  relatedEntityName: () => Person.name,
  countFieldName: 'memberCount',       // optional: generates an Int count field + filter
  getFilterType: () => Int,
},
```

**Person side (holds the FK → m:1):**

```typescript
// EntityMetadata — Person
fellowship: createProperty('Fellowship', 'fellowship', ['fellowship_id'], {
  referenceType: ReferenceType.MANY_TO_ONE,
  joinColumns: ['fellowship_id'],
  referencedColumnNames: ['id'],
}),
```

## m:1 — Person → Fellowship (Person belongs to one Fellowship)

See the Person side above. The m:1 field sits on the entity that holds the FK column. It needs `joinColumns` (local FK column) and `referencedColumnNames` (target PK column) in metadata.

## m:n — Person ↔ Battle (join table `person_battles`)

Both sides reference the **same pivot table** with swapped join/inverse columns.

**Person → Battles:**

```typescript
// EntityMetadata — Person
battles: createProperty('Battle', 'battles', [], {
  referenceType: ReferenceType.MANY_TO_MANY,
  pivotTable: 'person_battles',
  joinColumns: ['person_id'],          // pivot column pointing at THIS entity
  inverseJoinColumns: ['battle_id'],   // pivot column pointing at the OTHER entity
  referencedColumnNames: ['id'],       // PK on Battle
}),
```

```typescript
// FieldsSettings
battles: {
  type: () => BattleGQL.GQLEntity,
  generateFilter: true,
  array: true,
  relatedEntityName: () => Battle.name,
  countFieldName: 'battleCount', // optional
  getFilterType: () => Int,
},
```

**Battle → Warriors (the inverse):**

```typescript
// EntityMetadata — Battle
warriors: createProperty('Person', 'warriors', [], {
  referenceType: ReferenceType.MANY_TO_MANY,
  pivotTable: 'person_battles',
  joinColumns: ['battle_id'],          // swapped
  inverseJoinColumns: ['person_id'],   // swapped
  referencedColumnNames: ['id'],
}),
```

## Relationship filter usage

Once a relationship field has `generateFilter: true`, you can filter by fields on the related entity:

```graphql
persons(filter: { fellowship: { name: "Fellowship of the Ring" } })
persons(filter: { battles: { outcome: "Victory" } })
```

In TypeScript resolver code, cast these to `any` since the generated filter type doesn't statically surface relation sub-filters:

```typescript
const filter = { fellowship: { name: 'Fellowship of the Ring' } } as any;
await queryManager.getQueryResultsForFields(provider, Person, fields, filter);
```
