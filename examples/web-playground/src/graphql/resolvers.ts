import { GQLEntityFilterInputFieldType, GQLQueryManager } from '@dav3/gql-of-power';
import { GraphQLResolveInfo } from 'graphql';
import { Arg, Info, Query, Resolver } from 'type-graphql';
import { SimpleMetadataProvider } from '../config/metadata-provider';
import { Battle, Fellowship, Person, Ring } from '../schema/entities';
import { BattleGQL, FellowshipGQL, PersonGQL, RingGQL } from './entities';

// Dependency injection setup
const metadataProvider = new SimpleMetadataProvider();
const queryManager = new GQLQueryManager();

/**
 * Person Resolver
 * Handles queries for Middle-earth inhabitants
 */
@Resolver(() => PersonGQL.GQLEntity || Object)
export class PersonResolver {
	@Query(() => [PersonGQL.GQLEntity], { description: 'Get all persons from Middle-earth' })
	async persons(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => PersonGQL.GQLEntityFilterInput || Object, {
			nullable: true,
		})
		filter?: GQLEntityFilterInputFieldType<true>,
		@Arg('pagination', () => PersonGQL.GQLEntityPaginationInputField || Object, {
			nullable: true,
		})
		pagination?: any
	) {
		const results = await queryManager.getQueryResultsForInfo<any, Person>(
			metadataProvider,
			Person,
			info,
			filter,
			pagination
		);
		return results;
	}

	@Query(() => PersonGQL.GQLEntity, { nullable: true, description: 'Get a person by ID' })
	async person(@Arg('id', () => Number) id: number, @Info() info: GraphQLResolveInfo) {
		const results = await queryManager.getQueryResultsForInfo<any, Person>(
			metadataProvider,
			Person,
			info,
			{
				id,
			} as GQLEntityFilterInputFieldType<Person>
		);
		return results[0] || null;
	}
}

/**
 * Ring Resolver
 * Handles queries for the Rings of Power
 */
@Resolver(() => RingGQL.GQLEntity || Object)
export class RingResolver {
	@Query(() => [RingGQL.GQLEntity], { description: 'Get all rings of power' })
	async rings(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => RingGQL.GQLEntityFilterInput || Object, {
			nullable: true,
		})
		filter?: GQLEntityFilterInputFieldType<Ring>
	) {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Ring, info, filter);
	}
}

/**
 * Fellowship Resolver
 * Handles queries for fellowships and groups
 */
@Resolver(() => FellowshipGQL.GQLEntity || Object)
export class FellowshipResolver {
	@Query(() => [FellowshipGQL.GQLEntity], { description: 'Get all fellowships' })
	async fellowships(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => FellowshipGQL.GQLEntityFilterInput || Object, {
			nullable: true,
		})
		filter?: GQLEntityFilterInputFieldType<Fellowship>
	) {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Fellowship, info, filter);
	}
}

/**
 * Battle Resolver
 * Handles queries for Middle-earth battles and conflicts
 */
@Resolver(() => BattleGQL.GQLEntity || Object)
export class BattleResolver {
	@Query(() => [BattleGQL.GQLEntity], { description: 'Get all battles from Middle-earth history' })
	async battles(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => BattleGQL.GQLEntityFilterInput || Object, {
			nullable: true,
		})
		filter?: GQLEntityFilterInputFieldType<Battle>
	) {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Battle, info, filter);
	}
}

export const AllResolvers = [
	PersonResolver,
	RingResolver,
	FellowshipResolver,
	BattleResolver,
] as const;
