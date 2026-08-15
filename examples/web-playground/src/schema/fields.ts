import { FieldsSettings } from '@dav3/gql-of-power';
import { GraphQLJSON } from 'graphql-type-json';
import {
	ArmyGQL,
	AuthorGQL,
	BattleGQL,
	BookGQL,
	FellowshipGQL,
	GenreGQL,
	LocationGQL,
	PersonGQL,
	QuestGQL,
	RegionGQL,
	RingGQL,
} from 'src/graphql/entities';
import { Int } from 'type-graphql';
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
} from './entities';

/**
 * Person field configurations
 * Defines all fields, their types, and filter generation settings.
 */
export const PersonFields: Partial<FieldsSettings<Person>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	age: { type: () => Number, options: { nullable: true }, generateFilter: true },
	race: { type: () => String, options: { nullable: true }, generateFilter: true },
	home: { type: () => String, options: { nullable: true }, generateFilter: true },
	ring: {
		type: () => RingGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => Ring.name,
		getFilterType: () => Int,
	},
	fellowship: {
		type: () => FellowshipGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => Fellowship.name,
		getFilterType: () => Int,
	},
	battles: {
		type: () => BattleGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Battle.name,
		getFilterType: () => Int,
		// countFieldName demonstrates the auto-generated count-field feature:
		// adds an Int `battleCount` field + filter operators (_eq/_gt/...) on Person.
		countFieldName: 'battleCount',
	},
	books: {
		type: () => BookGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Book.name,
		getFilterType: () => Int,
	},
};

/**
 * Ring field configurations
 * Defines the Rings of Power and their relationship to bearers.
 *
 * Demonstrates:
 * - mapNumericEnum on `status` (DB stores numeric code, GQL exposes the enum string key)
 * - parseJson on `metadata` (Postgres jsonb column surfaced as a JSON object)
 * - excludeFromInput on `forgedDate` (server-managed field kept out of the Input type)
 */
export const RingFields: Partial<FieldsSettings<Ring>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	power: { type: () => String, options: { nullable: true }, generateFilter: true },
	forgedBy: { type: () => String, options: { nullable: true }, generateFilter: true },
	// Server-managed timestamp: clients cannot set it via the auto-generated Input type.
	forgedDate: {
		type: () => Date,
		options: { nullable: true },
		generateFilter: true,
		excludeFromInput: true,
	},
	// Numeric enum column: DB stores 100/200/300, GQL exposes Forged/Lost/Destroyed.
	status: {
		type: () => RingStatus,
		options: { nullable: true },
		generateFilter: true,
		mapNumericEnum: true,
	},
	// jsonb column wrapped with a JSON-parsing expression in SQL.
	// NOTE: parseJson fields MUST use GraphQLJSON, not `type: () => Object` —
	// type-graphql's scalar map has no entry for Object and schema build fails
	// with "Cannot determine GraphQL output type for 'metadata'".
	metadata: {
		type: () => GraphQLJSON,
		options: { nullable: true },
		generateFilter: false,
		parseJson: true,
	},
	bearer: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => Person.name,
		getFilterType: () => Int,
	},
};

/**
 * Fellowship field configurations
 * Defines fellowship groups and their members.
 */
export const FellowshipFields: Partial<FieldsSettings<Fellowship>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	purpose: { type: () => String, options: { nullable: true }, generateFilter: true },
	disbanded: { type: () => Boolean, options: { nullable: true }, generateFilter: true },
	members: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Person.name,
		getFilterType: () => Int,
		// Auto-generated Int field `memberCount` with its own filter argument.
		countFieldName: 'memberCount',
	},
	quest: {
		type: () => QuestGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => Quest.name,
		getFilterType: () => Int,
	},
};

/**
 * Quest field configurations
 * Demonstrates 1:m (fellowships) and m:m (locations) relationships.
 */
export const QuestFields: Partial<FieldsSettings<Quest>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	description: { type: () => String, options: { nullable: true }, generateFilter: true },
	success: { type: () => Boolean, options: { nullable: true }, generateFilter: true },
	fellowships: {
		type: () => FellowshipGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Fellowship.name,
		getFilterType: () => Int,
	},
	locations: {
		type: () => LocationGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Location.name,
		getFilterType: () => Int,
	},
};

/**
 * Location field configurations
 * Demonstrates m:1 (region) and m:m (quests, battles) relationships.
 */
export const LocationFields: Partial<FieldsSettings<Location>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	type: { type: () => String, options: { nullable: true }, generateFilter: true },
	description: { type: () => String, options: { nullable: true }, generateFilter: true },
	region: {
		type: () => RegionGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => Region.name,
		getFilterType: () => Int,
	},
	quests: {
		type: () => QuestGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Quest.name,
		getFilterType: () => Int,
	},
	battles: {
		type: () => BattleGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Battle.name,
		getFilterType: () => Int,
	},
};

/**
 * Region field configurations
 * Demonstrates 1:m (locations) relationship.
 */
export const RegionFields: Partial<FieldsSettings<Region>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	ruler: { type: () => String, options: { nullable: true }, generateFilter: true },
	locations: {
		type: () => LocationGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Location.name,
		getFilterType: () => Int,
		countFieldName: 'locationCount',
	},
};

/**
 * Battle field configurations
 * Defines battles and their participants.
 */
export const BattleFields: Partial<FieldsSettings<Battle>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	outcome: { type: () => String, options: { nullable: true }, generateFilter: true },
	casualties: { type: () => Number, options: { nullable: true }, generateFilter: true },
	location: {
		type: () => LocationGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => Location.name,
		getFilterType: () => Int,
	},
	warriors: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Person.name,
		getFilterType: () => Int,
	},
	armies: {
		type: () => ArmyGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Army.name,
		getFilterType: () => Int,
	},
};

/**
 * Army field configurations
 * Demonstrates m:m (battles) relationship from the army side.
 */
export const ArmyFields: Partial<FieldsSettings<Army>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	size: { type: () => Number, options: { nullable: true }, generateFilter: true },
	allegiance: { type: () => String, options: { nullable: true }, generateFilter: true },
	leader: { type: () => String, options: { nullable: true }, generateFilter: true },
	battles: {
		type: () => BattleGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Battle.name,
		getFilterType: () => Int,
	},
};

/**
 * Author field configurations
 * Demonstrates 1:m (books) relationship with a count field and aggregate fields.
 */
export const AuthorFields: Partial<FieldsSettings<Author>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	birthYear: { type: () => Number, options: { nullable: true }, generateFilter: true },
	nationality: { type: () => String, options: { nullable: true }, generateFilter: true },
	books: {
		type: () => BookGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Book.name,
		getFilterType: () => Int,
		countFieldName: 'bookCount',
		aggregateFields: [
			{ fn: 'sum', column: 'pages', fieldName: 'totalPages' }, // total pages across all books
			{ fn: 'avg', column: 'pages', fieldName: 'avgPages' }, // average book length
			{ fn: 'min', column: 'publishedYear', fieldName: 'oldestBookYear' }, // first publication
			{ fn: 'max', column: 'publishedYear', fieldName: 'newestBookYear' }, // latest publication
		],
	},
};

/**
 * Book field configurations
 * Demonstrates m:1 (author), m:m (characters via Person, genres) relationships.
 */
export const BookFields: Partial<FieldsSettings<Book>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	title: { type: () => String, options: { nullable: true }, generateFilter: true },
	publishedYear: { type: () => Number, options: { nullable: true }, generateFilter: true },
	pages: { type: () => Number, options: { nullable: true }, generateFilter: true },
	author: {
		type: () => AuthorGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => Author.name,
		getFilterType: () => Int,
	},
	characters: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Person.name,
		getFilterType: () => Int,
	},
	genres: {
		type: () => GenreGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Genre.name,
		getFilterType: () => Int,
	},
};

/**
 * Genre field configurations
 * Demonstrates m:m (books) relationship from the genre side.
 */
export const GenreFields: Partial<FieldsSettings<Genre>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	description: { type: () => String, options: { nullable: true }, generateFilter: true },
	books: {
		type: () => BookGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Book.name,
		getFilterType: () => Int,
	},
};
