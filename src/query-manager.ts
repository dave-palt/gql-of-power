import { GraphQLResolveInfo } from 'graphql';
import graphqlFields from 'graphql-fields';
import { getCustomFieldsFor, getGQLEntityNameForClass } from './entities/gql-entity';
import { GQLtoSQLMapper } from './queries/gql-to-sql-mapper';
import {
	FieldSelection,
	GQLEntityFilterInputFieldType,
	GQLEntityPaginationInputType,
	MetadataProvider,
} from './types';
import { logger } from './variables';

export const getGQLFields = (...args: Parameters<typeof graphqlFields>) => {
	try {
		return graphqlFields(...args) as FieldSelection<any>;
	} catch (e) {
		logger.error('Error parsing GraphQL fields from info', e);
		throw 'Error parsing GraphQL fields from info';
	}
};

export class GQLQueryManager {
	constructor(private opts?: { namedParameterPrefix?: string }) {}
	async getQueryResultsFor<K extends { _____name: string }, T>(
		{ exists, getMetadata, rawQuery, executeQuery }: MetadataProvider,
		entity: new () => T,
		info: GraphQLResolveInfo,
		filter?: GQLEntityFilterInputFieldType<T>,
		pagination?: Partial<GQLEntityPaginationInputType<T>>
	): Promise<K[]> {
		if (!entity) {
			throw new Error(`Entity not provided`);
		}
		const logName = 'GetQueryResultsFor - ' + entity.name;
		logger.time(logName);
		logger.timeLog(logName);
		if (!entity || !entity.name) {
			logger.timeEnd(logName);
			throw new Error(`Entity ${entity} not compatible`);
		}
		if (!exists(entity.name)) {
			logger.timeEnd(logName);
			throw new Error(`Entity ${entity.name} not found in metadata`);
		}
		const fields = getGQLFields(info, {}, { processArguments: true }) as FieldSelection<T>;
		const customFields = getCustomFieldsFor(getGQLEntityNameForClass(entity));
		const mapper = new GQLtoSQLMapper({ exists, getMetadata, rawQuery, executeQuery }, this.opts);

		const { bindings, querySQL } = mapper.buildQueryAndBindingsFor({
			fields,
			customFields,
			entity,
			filter,
			pagination,
		});

		logger.timeLog(logName, 'input processed, query created', bindings);

		const res = (await executeQuery(rawQuery(querySQL, bindings))) as Array<K>;

		return res;
	}
}
