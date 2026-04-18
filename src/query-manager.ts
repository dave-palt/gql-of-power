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
		if (!resolveInfo) throw 'Could not parse resolve info';
		if (
			!('name' in resolveInfo) ||
			!('alias' in resolveInfo) ||
			!('fieldsByTypeName' in resolveInfo)
		)
			throw 'Could not parse resolve info - no name, alias or fieldsByTypeName';

		const parsed = simplifyParsedResolveInfoFragmentWithType(resolveInfo as any, info.returnType);

		return parsed.fields as FieldSelection<any>;
		// return graphqlFields(info as any, {}, { processArguments: true }) as FieldSelection<any>;
	} catch (e) {
		logger.error('Error parsing GraphQL fields from info', e);
		throw 'Error parsing GraphQL fields from info';
	}
};

export class GQLQueryManager {
	constructor(private opts?: { namedParameterPrefix?: string }) {}
	async getQueryResultsForInfo<K extends { _____name: string }, T>(
		provider: MetadataProviderType,
		entity: new () => T,
		info: GraphQLResolveInfo,
		filter?: GQLEntityFilterInputFieldType<T>,
		pagination?: Partial<GQLEntityPaginationInputType<T>>
	): Promise<K[]> {
		if (!entity?.name) {
			throw new Error(`Entity not provided`);
		}
		// Support @GQLEntityClass-decorated classes: use relatedEntityName (ORM class name)
		// for metadata provider lookup, since provider knows 'CrmAccount' not 'CrmAccountGQL'.
		const entityName = (entity as any).relatedEntityName ?? entity.name;
		if (!provider.exists(entityName)) {
			throw new Error(`Entity ${entityName} not found in metadata`);
		}
		const fields = getGQLFields(info) as FieldSelection<T>;
		return this.getQueryResultsForFields<K, T>(provider, entity, fields, filter, pagination, entityName);
	}

	async getQueryResultsForFields<K extends { _____name: string }, T>(
		provider: MetadataProviderType,
		entity: new () => T,
		fields: FieldSelection<T>,
		filter?: GQLEntityFilterInputFieldType<T>,
		pagination?: Partial<GQLEntityPaginationInputType<T>>,
		entityNameOverride?: string
	): Promise<K[]> {
		if (!entity?.name) {
			throw new Error(`Entity not provided`);
		}
		// Support @GQLEntityClass-decorated classes: use relatedEntityName (ORM class name)
		const entityName = entityNameOverride ?? (entity as any).relatedEntityName ?? entity.name;
		const logName = 'getQueryResultsForFields - ' + entityName;
		logger.time(logName);
		try {
			const { exists, executeQuery } = provider;
			if (!exists(entityName)) {
				throw new Error(`Entity ${entityName} not found in metadata`);
			}
			const customFields = getCustomFieldsFor(getGQLEntityNameForClass(entity));
			const mapper = new GQLtoSQLMapper(provider, this.opts);

			// If entityName differs from entity.name (i.e. @GQLEntityClass decorated class),
			// create a named proxy so the mapper can look up the ORM entity metadata by name.
			let entityForMapper: new () => T = entity;
			if (entityName !== entity.name) {
				entityForMapper = class {} as any;
				Object.defineProperty(entityForMapper, 'name', { value: entityName });
				Object.setPrototypeOf(entityForMapper, entity);
			}

			const { bindings, querySQL } = mapper.buildQueryAndBindingsFor({
				fields,
				customFields,
				entity: entityForMapper,
				filter,
				pagination,
			});

			logger.timeLog(logName, 'query built', querySQL, bindings);
			const sql = this.bindSQLQuery(provider, querySQL, bindings);
			const res = (await executeQuery(sql)) as Array<K>;

			return res;
		} finally {
			logger.timeEnd(logName); // eslint-disable-line
		}
	}

	protected bindSQLQuery(driver: DatabaseDriver, sql: string, bindings: any) {
		if ('rawQuery' in driver) {
			logger.log('rawQuery');
			return driver.rawQuery(sql, bindings);
		} else if ('client' in driver) {
			logger.log('bind with knex', sql, bindings);
			const k = knex({ client: driver.client });
			// Knex supports named bindings, but for arrays (e.g., for IN/NOT IN) you need to use the special syntax :name: (with colons on both sides)
			// Example: where id in (:ids:) and bindings = { ids: [1,2,3] }
			// See: https://knexjs.org/guide/raw.html#raw-parameter-binding
			return k.raw(sql, bindings).toString();
		}
		throw new Error('Could not bind SQL query, no compatible driver found.');
	}
}
