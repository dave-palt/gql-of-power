import { createGQLTypes, GQLQueryManager } from '@dav3/gql-of-power';
import DataLoader from 'dataloader';
import GraphQLJSON from 'graphql-type-json';
import { SimpleMetadataProvider } from 'src/config/metadata-provider';
import { Battle, Fellowship, Person, Ring } from 'src/schema/entities';
import { BattleFields, FellowshipFields, PersonFields, RingFields } from 'src/schema/fields';
import { Ctx, Info, Root } from 'type-graphql';

const metadataProvider = new SimpleMetadataProvider();
const queryManager = new GQLQueryManager();

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
		{ fellowship: { id_in: keys as number[] } },
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
// Create GQL types for each entity
export const PersonGQL = createGQLTypes(Person, PersonFields);
export const RingGQL = createGQLTypes(Ring, RingFields);
export const FellowshipGQL = createGQLTypes(Fellowship, FellowshipFields, {
	acl: {},
	customFields: {
		firstMember: {
			requires: ['id'], // not really needed in this case as primary keys are always retrieved for every entity, this is just an example
			type: () => GraphQLJSON,
			options: { nullable: true },
			resolveDecorators: [Root(), Ctx(), Info()],
			resolve: (root: Fellowship) => {
				return firstMemberDL.load(root.id);
			},
		},
	},
});
export const BattleGQL = createGQLTypes(Battle, BattleFields);

export const AllEntitiesGQL = [PersonGQL, RingGQL, FellowshipGQL, BattleGQL] as const;

export const PersonFieldsResolver = PersonGQL.FieldsResolver;
export const RingFieldsResolver = RingGQL.FieldsResolver;
export const FellowshipFieldsResolver = FellowshipGQL.FieldsResolver;
export const BattleFieldsResolver = BattleGQL.FieldsResolver;
