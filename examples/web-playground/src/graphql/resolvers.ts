import { GQLEntityFilterInputFieldType, GQLQueryManager } from '@dav3/gql-of-power';
import { GraphQLResolveInfo } from 'graphql';
import { Arg, Info, Query, Resolver } from 'type-graphql';
import { SimpleMetadataProvider } from '../config/metadata-provider';
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
} from '../schema/entities';
import {
	ArmyFieldsResolver,
	ArmyGQL,
	AuthorFieldsResolver,
	AuthorGQL,
	BattleFieldsResolver,
	BattleGQL,
	BookFieldsResolver,
	BookGQL,
	FellowshipFieldsResolver,
	FellowshipGQL,
	GenreFieldsResolver,
	GenreGQL,
	LocationFieldsResolver,
	LocationGQL,
	PersonFieldsResolver,
	PersonGQL,
	QuestFieldsResolver,
	QuestGQL,
	RegionFieldsResolver,
	RegionGQL,
	RingFieldsResolver,
	RingGQL,
} from './entities';

// Dependency injection setup
const metadataProvider = new SimpleMetadataProvider();
const queryManager = new GQLQueryManager();

/**
 * Person Resolver
 * Handles queries for Middle-earth inhabitants.
 *
 * `filter` is typed `any` because relationship-field filters (e.g.
 * `{ fellowship: { id_in: [...] } }`) and the _exists/_not_exists shapes are
 * generated at runtime but not statically surfaced on GQLEntityFilterInputFieldType.
 * The library's own test suite applies the same `as any` cast.
 */
@Resolver(() => PersonGQL.GQLEntity || Object)
export class PersonResolver extends PersonFieldsResolver {
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
 * Handles queries for the Rings of Power.
 */
@Resolver(() => RingGQL.GQLEntity || Object)
export class RingResolver extends RingFieldsResolver {
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
 * Handles queries for fellowships and groups.
 */
@Resolver(() => FellowshipGQL.GQLEntity || Object)
export class FellowshipResolver extends FellowshipFieldsResolver {
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
 * Quest Resolver
 * Handles queries for quests undertaken across Middle-earth.
 */
@Resolver(() => QuestGQL.GQLEntity || Object)
export class QuestResolver extends QuestFieldsResolver {
	@Query(() => [QuestGQL.GQLEntity], { description: 'Get all quests from Middle-earth lore' })
	async quests(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => QuestGQL.GQLEntityFilterInput || Object, {
			nullable: true,
		})
		filter?: GQLEntityFilterInputFieldType<Quest>
	) {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Quest, info, filter);
	}
}

/**
 * Location Resolver
 * Handles queries for notable places across Middle-earth.
 */
@Resolver(() => LocationGQL.GQLEntity || Object)
export class LocationResolver extends LocationFieldsResolver {
	@Query(() => [LocationGQL.GQLEntity], { description: 'Get all locations in Middle-earth' })
	async locations(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => LocationGQL.GQLEntityFilterInput || Object, {
			nullable: true,
		})
		filter?: GQLEntityFilterInputFieldType<Location>
	) {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Location, info, filter);
	}
}

/**
 * Region Resolver
 * Handles queries for the regions of Middle-earth (Gondor, Rohan, the Shire...).
 */
@Resolver(() => RegionGQL.GQLEntity || Object)
export class RegionResolver extends RegionFieldsResolver {
	@Query(() => [RegionGQL.GQLEntity], { description: 'Get all regions of Middle-earth' })
	async regions(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => RegionGQL.GQLEntityFilterInput || Object, {
			nullable: true,
		})
		filter?: GQLEntityFilterInputFieldType<Region>
	) {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Region, info, filter);
	}
}

/**
 * Battle Resolver
 * Handles queries for Middle-earth battles and conflicts.
 */
@Resolver(() => BattleGQL.GQLEntity || Object)
export class BattleResolver extends BattleFieldsResolver {
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

/**
 * Army Resolver
 * Handles queries for the armies that fought in Middle-earth's wars.
 */
@Resolver(() => ArmyGQL.GQLEntity || Object)
export class ArmyResolver extends ArmyFieldsResolver {
	@Query(() => [ArmyGQL.GQLEntity], { description: 'Get all armies from Middle-earth' })
	async armies(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => ArmyGQL.GQLEntityFilterInput || Object, {
			nullable: true,
		})
		filter?: GQLEntityFilterInputFieldType<Army>
	) {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Army, info, filter);
	}
}

/**
 * Author Resolver
 * Handles queries for the in-universe authors of Middle-earth books.
 */
@Resolver(() => AuthorGQL.GQLEntity || Object)
export class AuthorResolver extends AuthorFieldsResolver {
	@Query(() => [AuthorGQL.GQLEntity], { description: 'Get all authors from Middle-earth lore' })
	async authors(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => AuthorGQL.GQLEntityFilterInput || Object, {
			nullable: true,
		})
		filter?: GQLEntityFilterInputFieldType<Author>
	) {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Author, info, filter);
	}
}

/**
 * Book Resolver
 * Handles queries for books written about Middle-earth.
 */
@Resolver(() => BookGQL.GQLEntity || Object)
export class BookResolver extends BookFieldsResolver {
	@Query(() => [BookGQL.GQLEntity], { description: 'Get all books from Middle-earth lore' })
	async books(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => BookGQL.GQLEntityFilterInput || Object, {
			nullable: true,
		})
		filter?: GQLEntityFilterInputFieldType<Book>
	) {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Book, info, filter);
	}
}

/**
 * Genre Resolver
 * Handles queries for literary genres applied to Middle-earth books.
 */
@Resolver(() => GenreGQL.GQLEntity || Object)
export class GenreResolver extends GenreFieldsResolver {
	@Query(() => [GenreGQL.GQLEntity], { description: 'Get all book genres' })
	async genres(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => GenreGQL.GQLEntityFilterInput || Object, {
			nullable: true,
		})
		filter?: GQLEntityFilterInputFieldType<Genre>
	) {
		return await queryManager.getQueryResultsForInfo(metadataProvider, Genre, info, filter);
	}
}

export const AllResolvers = [
	PersonResolver,
	RingResolver,
	FellowshipResolver,
	QuestResolver,
	LocationResolver,
	RegionResolver,
	BattleResolver,
	ArmyResolver,
	AuthorResolver,
	BookResolver,
	GenreResolver,
] as const;
