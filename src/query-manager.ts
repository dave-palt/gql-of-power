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

export class GQLQueryManager {
	async getQueryResultsFor<K extends { _____name: string }, T>(
		{ exists, getMetadata, rawQuery, executeQuery }: MetadataProvider,
		entity: new () => T,
		info: GraphQLResolveInfo,
		filter?: GQLEntityFilterInputFieldType<T>,
		pagination?: Partial<GQLEntityPaginationInputType<T>>
	): Promise<K[]> {
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
		const fields = graphqlFields(info, {}, { processArguments: true }) as FieldSelection<T>;
		const customFields = getCustomFieldsFor(getGQLEntityNameForClass(entity));
		const mapper = new GQLtoSQLMapper({ exists, getMetadata, rawQuery, executeQuery });
		const { bindings, querySQL } = mapper.buildQueryAndBindingsFor({
			fields,
			customFields,
			entity,
			filter,
			pagination,
		});

		logger.timeLog(logName, 'input processed, query created', bindings);

		const res = (await executeQuery(rawQuery(querySQL, bindings))) as Array<{ val: K | string }>;

		logger.timeLog(logName, 'found', res.length, 'results');
		const mapped = res.map(({ val }) => {
			// for (const key of customFieldsKeys) {
			// 	const conf = (customFields as any)[key];
			// 	Object.defineProperty(val, key, {
			// 		get: () => conf.resolve(val),
			// 		enumerable: true,
			// 		configurable: true,
			// 	});
			// }

			return typeof val === 'string' ? (JSON.parse(val) as K) : val;
		});

		logger.timeLog(logName, res.length, 'results mapped');
		logger.timeEnd(logName);
		return mapped;
	}
}
