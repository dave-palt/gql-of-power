import { GraphQLResolveInfo } from 'graphql';
import graphqlFields from 'graphql-fields';
import {
	parseResolveInfo,
	simplifyParsedResolveInfoFragmentWithType,
} from 'graphql-parse-resolve-info';
import knex from 'knex';
import { getCustomFieldsFor, getGQLEntityNameForClass } from './entities/gql-entity';
import { GQLtoSQLMapper } from './queries/gql-to-sql-mapper';
import {
	DatabaseDriver,
	FieldSelection,
	GQLEntityFilterInputFieldType,
	GQLEntityPaginationInputType,
	MetadataProviderType,
} from './types';
import { logger } from './variables';

export const getGQLFields = (info: GraphQLResolveInfo) => {
	graphqlFields;
	try {
		const resolveInfo = parseResolveInfo(info, {
			// keepRoot: true,
			deep: true,
		});
		// console.log('resolveInfo', info.returnType, JSON.stringify(resolveInfo, null, 2));
		if (!resolveInfo) throw 'Could not parse resolve info';
		if (
			!('name' in resolveInfo) ||
			!('alias' in resolveInfo) ||
			!('fieldsByTypeName' in resolveInfo)
		)
			throw 'Could not parse resolve info - no name, alias or fieldsByTypeName';

		const parsed = simplifyParsedResolveInfoFragmentWithType(resolveInfo as any, info.returnType);

		console.log('Parsed GQL fields', JSON.stringify(parsed.fields, null, 2));
		return parsed.fields as FieldSelection<any>;
		// return graphqlFields(info as any, {}, { processArguments: true }) as FieldSelection<any>;
	} catch (e) {
		logger.error('Error parsing GraphQL fields from info', e);
		throw 'Error parsing GraphQL fields from info';
	}
};

export class GQLQueryManager {
	constructor(private opts?: { namedParameterPrefix?: string }) {}
	async getQueryResultsFor<K extends { _____name: string }, T>(
		provider: MetadataProviderType,
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
		const { exists, executeQuery } = provider;
		if (!exists(entity.name)) {
			logger.timeEnd(logName);
			throw new Error(`Entity ${entity.name} not found in metadata`);
		}
		// console.log(logName, 'info', JSON.stringify(info));
		const fields = getGQLFields(info) as FieldSelection<T>;
		const customFields = getCustomFieldsFor(getGQLEntityNameForClass(entity));
		const mapper = new GQLtoSQLMapper(provider, this.opts);

		const { bindings, querySQL } = mapper.buildQueryAndBindingsFor({
			fields,
			customFields,
			entity,
			filter,
			pagination,
		});

		logger.timeLog(logName, 'input processed, query created', querySQL, bindings);
		const sql = this.bindSQLQuery(provider, querySQL, bindings);

		const res = (await executeQuery(sql)) as Array<K>;

		return res;
	}

	protected bindSQLQuery(driver: DatabaseDriver, sql: string, bindings: any) {
		if ('rawQuery' in driver) {
			console.log('rqwQuery');
			return driver.rawQuery(sql, bindings);
		} else if ('client' in driver) {
			console.log('bind with knex', sql, bindings);
			const k = knex({ client: driver.client });
			// Knex supports named bindings, but for arrays (e.g., for IN/NOT IN) you need to use the special syntax :name: (with colons on both sides)
			// Example: where id in (:ids:) and bindings = { ids: [1,2,3] }
			// See: https://knexjs.org/guide/raw.html#raw-parameter-binding
			return k.raw(sql, bindings).toString();
		}
		throw new Error('Could not bind SQL query, no compatible driver found.');
	}
}
