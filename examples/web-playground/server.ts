import { GraphQLResolveInfo } from 'graphql';
import { createYoga } from 'graphql-yoga';
import 'reflect-metadata';
import { Arg, buildSchema, Field, Info, InputType, Int, Query, Resolver } from 'type-graphql';

import {
	createGQLTypes,
	FieldsSettings,
	GQLEntityFilterInputFieldType,
	GQLQueryManager,
} from '@dav3/gql-of-power';
import { Battle, Fellowship, Person, Ring } from './entities';
import { SimpleMetadataProvider } from './metadata-provider';
import { knexInstance, sql } from './sql';

// await initializeDatabase();
// console.log('Database initialised');
// await insertSampleData();
// console.log('Sample data inserted');

const res = await sql`SELECT 1`;
console.log('Database connection verified.', res);
// Setup GQL-of-Power components
const metadataProvider = new SimpleMetadataProvider(sql, knexInstance);
const queryManager = new GQLQueryManager();

// Define GraphQL field configurations
const PersonFields: Partial<FieldsSettings<Person>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	age: { type: () => Number, options: { nullable: true }, generateFilter: true },
	race: { type: () => String, options: { nullable: true }, generateFilter: true },
	home: { type: () => String, options: { nullable: true }, generateFilter: true },
	ring: {
		type: () => RingGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => 'Ring',
		getFilterType: () => Int,
	},
	fellowship: {
		type: () => FellowshipGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => 'Fellowship',
		getFilterType: () => Int,
	},
	battles: {
		type: () => BattleGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => 'Battle',
		getFilterType: () => Int,
	},
};

const RingFields: Partial<FieldsSettings<Ring>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	power: { type: () => String, options: { nullable: true }, generateFilter: true },
	forgedBy: { type: () => String, options: { nullable: true }, generateFilter: true },
	bearer: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		relatedEntityName: () => 'Person',
		getFilterType: () => Int,
	},
};

const FellowshipFields: Partial<FieldsSettings<Fellowship>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	purpose: { type: () => String, options: { nullable: true }, generateFilter: true },
	disbanded: { type: () => Boolean, options: { nullable: true }, generateFilter: true },
	members: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => 'Person',
		getFilterType: () => Int,
	},
};

const BattleFields: Partial<FieldsSettings<Battle>> = {
	id: { type: () => Number, options: { nullable: false }, generateFilter: true },
	name: { type: () => String, options: { nullable: true }, generateFilter: true },
	outcome: { type: () => String, options: { nullable: true }, generateFilter: true },
	casualties: { type: () => Number, options: { nullable: true }, generateFilter: true },
	warriors: {
		type: () => PersonGQL.GQLEntity,
		options: { nullable: true },
		generateFilter: true,
		array: true,
		relatedEntityName: () => 'Person',
		getFilterType: () => Int,
	},
};

// Create GQL types
const PersonGQL = createGQLTypes(Person, PersonFields);
const RingGQL = createGQLTypes(Ring, RingFields);
const FellowshipGQL = createGQLTypes(Fellowship, FellowshipFields);
const BattleGQL = createGQLTypes(Battle, BattleFields);
@InputType('TestInput')
class TestInput {
	@Field(() => Int, {
		nullable: true,
	})
	limit?: number;
}
// GraphQL Resolvers
@Resolver(() => PersonGQL.GQLEntity)
class PersonResolver {
	@Query(() => [PersonGQL.GQLEntity], { description: 'Get all persons from Middle-earth' })
	async persons(
		@Info() info: GraphQLResolveInfo,
		@Arg('input', () => TestInput, { nullable: true }) input?: TestInput,
		@Arg('filter', () => PersonGQL.GQLEntityFilterInput, { nullable: true })
		filter?: GQLEntityFilterInputFieldType<true>,
		@Arg('pagination', () => PersonGQL.GQLEntityPaginationInputField, { nullable: true })
		pagination?: any
	) {
		console.log('Input received:', input);
		const results = await queryManager.getQueryResultsFor<PersonGQL.GQLEntity, Person>(
			metadataProvider,
			Person,
			info,
			filter,
			pagination
		);
		console.log('Persons query results:', results);
		return results;
	}

	@Query(() => PersonGQL.GQLEntity, { nullable: true, description: 'Get a person by ID' })
	async person(@Arg('id', () => Number) id: number, @Info() info: GraphQLResolveInfo) {
		const results = await queryManager.getQueryResultsFor<PersonGQL.GQLEntity, Person>(
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

@Resolver(() => RingGQL.GQLEntity)
class RingResolver {
	@Query(() => [RingGQL.GQLEntity], { description: 'Get all rings of power' })
	async rings(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => RingGQL.GQLEntityFilterInput, { nullable: true })
		filter?: GQLEntityFilterInputFieldType<Ring>
	) {
		return await queryManager.getQueryResultsFor(metadataProvider, Ring, info, filter);
	}
}

@Resolver(() => FellowshipGQL.GQLEntity)
class FellowshipResolver {
	@Query(() => [FellowshipGQL.GQLEntity], { description: 'Get all fellowships' })
	async fellowships(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => FellowshipGQL.GQLEntityFilterInput, { nullable: true })
		filter?: GQLEntityFilterInputFieldType<Fellowship>
	) {
		return await queryManager.getQueryResultsFor(metadataProvider, Fellowship, info, filter);
	}
}

@Resolver(() => BattleGQL.GQLEntity)
class BattleResolver {
	@Query(() => [BattleGQL.GQLEntity], { description: 'Get all battles from Middle-earth history' })
	async battles(
		@Info() info: GraphQLResolveInfo,
		@Arg('filter', () => BattleGQL.GQLEntityFilterInput, { nullable: true })
		filter?: GQLEntityFilterInputFieldType<Battle>
	) {
		return await queryManager.getQueryResultsFor(metadataProvider, Battle, info, filter);
	}
}

// Build GraphQL schema
const schema = await buildSchema({
	resolvers: [PersonResolver, RingResolver, FellowshipResolver, BattleResolver],
	// validate: false, // Skip validation for faster testing
});

// Create GraphQL server with playground
const yoga = createYoga({
	schema,
	graphiql: {
		title: 'GQL-of-Power Playground',
		defaultQuery: `# Welcome to GQL-of-Power Playground!
# Try these queries to explore Middle-earth data:

query GetAllPersons {
  persons {
    id
    name
    race
    home
    ring {
      name
      power
    }
    fellowship {
      name
      purpose
    }
  }
}

query GetPersonWithBattles {
  persons(filter: { name: { _like: "Aragorn" } }) {
    id
    name
    race
    battles {
      name
      outcome
      casualties
    }
  }
}

query GetRingsOfPower {
  rings {
    id
    name
    power
    forgedBy
    bearer {
      name
      race
    }
  }
}`,
	},
});

// Start server
const server = Bun.serve({
	port: 4000,
	fetch: yoga.fetch,
});

console.log(`🚀 GQL-of-Power Playground ready at http://localhost:4000/graphql`);
