import { FieldsSettings } from '@dav3/gql-of-power';
import { BattleGQL, FellowshipGQL, PersonGQL, RingGQL } from 'src/graphql/entities';
import { Int } from 'type-graphql';
import { Battle, Book, Fellowship, Person, Ring } from './entities';

/**
 * Person field configurations
 * Defines all fields, their types, and filter generation settings
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
	},
};

/**
 * Ring field configurations
 * Defines the Rings of Power and their relationship to bearers
 */
export const RingFields: Partial<FieldsSettings<Ring>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	power: { type: () => String, options: { nullable: true }, generateFilter: true },
	forgedBy: { type: () => String, options: { nullable: true }, generateFilter: true },
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
 * Defines fellowship groups and their members
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
	},
};

/**
 * Battle field configurations
 * Defines battles and their participants
 */
export const BattleFields: Partial<FieldsSettings<Battle>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	outcome: { type: () => String, options: { nullable: true }, generateFilter: true },
	casualties: { type: () => Number, options: { nullable: true }, generateFilter: true },
	warriors: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Person.name,
		getFilterType: () => Int,
	},
};

/**
 * Book field configurations
 * Defines Books and their participants
 */
export const BookFields: Partial<FieldsSettings<Book>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	characters: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => Person.name,
	},
};
