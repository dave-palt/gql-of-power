import { createGQLTypes, GQLQueryManager } from '@dav3/gql-of-power';
import DataLoader from 'dataloader';
import { SimpleMetadataProvider } from 'src/config/metadata-provider';
import {
	Army,
	Author,
	Battle,
	Book,
	Fellowship,
	Genre,
	Location,
	Person,
	Quest,
	Region,
	Ring,
	RingStatus,
} from 'src/schema/entities';
import {
	ArmyFields,
	AuthorFields,
	BattleFields,
	BookFields,
	FellowshipFields,
	GenreFields,
	LocationFields,
	PersonFields,
	QuestFields,
	RegionFields,
	RingFields,
} from 'src/schema/fields';
import { Ctx, Info, registerEnumType, Root } from 'type-graphql';

// ─── Enum registration ──────────────────────────────────────────────────────
// type-graphql needs every TS enum surfaced via registerEnumType so it can be
// used as a GraphQL enum type. Required for mapNumericEnum-backed fields and
// for any other enum-typed field exposed in the schema.
// The enum object (first arg) carries the numeric values; valuesConfig only
// takes per-value description/deprecationReason in this type-graphql version.
registerEnumType(RingStatus, {
	name: 'RingStatus',
	description:
		'Lifecycle of a Ring of Power. DB stores the numeric code (100/200/300); GraphQL exposes the string key.',
});

const metadataProvider = new SimpleMetadataProvider();
const queryManager = new GQLQueryManager();

// DataLoader backing the `firstMember` custom field on Fellowship.
// Demonstrates the resolve-strategy custom-field pattern with requires + batching.
const firstMemberDL = new DataLoader(async (keys: readonly number[]) => {
	const result = await queryManager.getQueryResultsForFields(
		metadataProvider,
		Person,
		{
			id: {},
			name: {},
			age: {},
			home: {},
			race: {},
		},
		// `fellowship` is a relation field with generateFilter: true — it produces a
		// nested filter at runtime, but GQLEntityFilterInputFieldType<Person> doesn't
		// statically surface relation-field filters (they're only generated when the
		// entity has relatedEntityName). Cast to satisfy the type, same pattern used
		// throughout the library's own test suite for relationship filters.
		{ fellowship: { id_in: keys as number[] } } as any,
		{
			orderBy: [
				{
					id: 'asc',
				},
			],
		}
	);
	return keys.map((key) => result.find((r: any) => r.id === key));
});

// Create GQL types for each entity. Order matters for cross-references: types
// referenced via `relatedEntityName` (a runtime string) only need their ORM
// class name to match the metadata provider, but GQL entity refs use the
// `XxxGQL.GQLEntity` thunk, so referenced entities must be declared first.
export const PersonGQL = createGQLTypes(Person, PersonFields, {
	customFields: {
		// mapping-strategy custom field: Person → Region JOIN via the home_region_id
		// FK column on persons. The library generates the SQL JOIN automatically —
		// no resolver function needed. Demonstrates `mapping` + `generateFilter`,
		// which exposes a `HomeRegion: { name_eq: 'Gondor' }` filter on Person.
		homeRegion: {
			type: () => RegionGQL.GQLEntity,
			options: { nullable: true },
			generateFilter: true,
			mapping: {
				refEntity: Region,
				refFields: 'id',
				fields: 'homeRegionId',
			},
		},
	},
});

export const RingGQL = createGQLTypes(Ring, RingFields);
export const FellowshipGQL = createGQLTypes(Fellowship, FellowshipFields, {
	customFields: {
		// resolve-strategy custom field: batches loads of the first member of each
		// fellowship via DataLoader. Demonstrates `requires` + `resolveDecorators`.
		firstMember: {
			// Not really needed — primary keys are always retrieved — shown for illustration.
			requires: ['id'],
			type: () => PersonGQL.GQLEntity,
			options: { nullable: true },
			resolveDecorators: [Root(), Ctx(), Info()],
			resolve: (root: Fellowship) => {
				return firstMemberDL.load(root.id);
			},
		},
	},
});
export const QuestGQL = createGQLTypes(Quest, QuestFields);
export const LocationGQL = createGQLTypes(Location, LocationFields);
export const RegionGQL = createGQLTypes(Region, RegionFields);
export const BattleGQL = createGQLTypes(Battle, BattleFields);
export const ArmyGQL = createGQLTypes(Army, ArmyFields);
export const BookGQL = createGQLTypes(Book, BookFields);
export const AuthorGQL = createGQLTypes(Author, AuthorFields);
export const GenreGQL = createGQLTypes(Genre, GenreFields);

export const AllEntitiesGQL = [
	PersonGQL,
	RingGQL,
	FellowshipGQL,
	QuestGQL,
	LocationGQL,
	RegionGQL,
	BattleGQL,
	ArmyGQL,
	BookGQL,
	AuthorGQL,
	GenreGQL,
] as const;

// Re-export the auto-generated FieldsResolver base classes for the resolvers.
export const PersonFieldsResolver = PersonGQL.FieldsResolver;
export const RingFieldsResolver = RingGQL.FieldsResolver;
export const FellowshipFieldsResolver = FellowshipGQL.FieldsResolver;
export const QuestFieldsResolver = QuestGQL.FieldsResolver;
export const LocationFieldsResolver = LocationGQL.FieldsResolver;
export const RegionFieldsResolver = RegionGQL.FieldsResolver;
export const BattleFieldsResolver = BattleGQL.FieldsResolver;
export const ArmyFieldsResolver = ArmyGQL.FieldsResolver;
export const BookFieldsResolver = BookGQL.FieldsResolver;
export const AuthorFieldsResolver = AuthorGQL.FieldsResolver;
export const GenreFieldsResolver = GenreGQL.FieldsResolver;
