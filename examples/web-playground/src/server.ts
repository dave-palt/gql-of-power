import { createYoga } from 'graphql-yoga';
import 'reflect-metadata';
import { buildSchema } from 'type-graphql';

// Local imports
import { GRAPHQL_PLAYGROUND_CONFIG } from './config/graphql';
import { sql } from './config/sql';
import { AllEntitiesGQL } from './graphql/entities';
import { AllResolvers } from './graphql/resolvers';

console.log('AllEntitiesGQL', AllEntitiesGQL);
// Verify database connection
const res = await sql`SELECT 1`;
console.log('Database connection verified.', res);

// Build GraphQL schema with all resolvers
const schema = await buildSchema({
	resolvers: AllResolvers,
});

// Create GraphQL server with playground
const yoga = createYoga({
	schema,
	graphiql: GRAPHQL_PLAYGROUND_CONFIG,
});

// Start server
const server = Bun.serve({
	port: 4000,
	fetch: yoga.fetch,
});

console.log(`🚀 GQL-of-Power Playground ready at http://localhost:4000/graphql`);
