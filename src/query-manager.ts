import { GraphQLResolveInfo } from 'graphql';
import graphqlFields from 'graphql-fields';
import {
	parseResolveInfo,
	simplifyParsedResolveInfoFragmentWithType,
} from 'graphql-parse-resolve-info';
import knex from 'knex';
import {
	getCustomFieldsFor,
	getGQLEntityNameFor,
	getMapEnumFieldsFor,
	getRelationFieldsFor,
} from './entities/gql-entity';
import { GQLtoSQLMapper } from './queries/gql-to-sql-mapper';
import { convertFilterEnumValues } from './queries/enum-filter-converter';
import { DatabaseDriver, FieldSelection, MetadataProviderType } from './types/sql-types';
import {
	GQLEntityFilterInputFieldType,
	GQLEntityOrderByInputType,
	GQLEntityPaginationInputType,
} from './types/gql-types';
import { logger } from './variables';

// Re-export for backwards compatibility — consumers and tests import
// convertFilterEnumValues from here.
export { convertFilterEnumValues };

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
	async getQueryResultsForInfo<T, FilterT = T, K = any>(
		provider: MetadataProviderType,
		entity: new () => T,
		info: GraphQLResolveInfo,
		filter?: GQLEntityFilterInputFieldType<FilterT>,
		pagination?: Partial<GQLEntityPaginationInputType<FilterT>>
	): Promise<K[]> {
		const { fields, entityName } = this.resolveInfoFields<T>(provider, entity, info);
		return this.getQueryResultsForFields<T, FilterT, K>(
			provider,
			entity,
			fields,
			filter,
			pagination,
			entityName
		);
	}

	/**
	 * Shared prelude for the two `*ForInfo` methods: validate the entity, resolve
	 * its metadata name (preferring relatedEntityName for @GQLEntityClass classes),
	 * and parse the GraphQL resolve info into a field selection.
	 */
	private resolveInfoFields<T>(
		provider: MetadataProviderType,
		entity: new () => T,
		info: GraphQLResolveInfo
	): { fields: FieldSelection<T>; entityName: string } {
		if (!entity?.name) {
			throw new Error(`Entity not provided`);
		}
		// Support @GQLEntityClass-decorated classes: use relatedEntityName (ORM class name)
		// for metadata provider lookup, since provider knows 'Author' not 'AuthorGQL'.
		const entityName = (entity as any).relatedEntityName ?? entity.name;
		if (!provider.exists(entityName)) {
			throw new Error(`Entity ${entityName} not found in metadata`);
		}
		const fields = getGQLFields(info) as FieldSelection<T>;
		return { fields, entityName };
	}

	async getQueryResultsForFields<T, FilterT = T, K = any>(
		provider: MetadataProviderType,
		entity: new () => T,
		fields: FieldSelection<T>,
		filter?: GQLEntityFilterInputFieldType<FilterT>,
		pagination?: Partial<GQLEntityPaginationInputType<FilterT>>,
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
			const customFields = getCustomFieldsFor(getGQLEntityNameFor(entityName));
			const enumFields = getMapEnumFieldsFor(getGQLEntityNameFor(entityName));
			const relationFields = getRelationFieldsFor(getGQLEntityNameFor(entityName));
			const mapper = new GQLtoSQLMapper(provider, this.opts);

			let entityForMapper: new () => T = entity;
			if (entityName !== entity.name) {
				entityForMapper = class {} as any;
				Object.defineProperty(entityForMapper, 'name', { value: entityName });
				Object.setPrototypeOf(entityForMapper, entity);
			}

			const convertedFilter = convertFilterEnumValues(
				filter,
				enumFields,
				customFields,
				relationFields
			);

			const { bindings, querySQL } = mapper.buildQueryAndBindingsFor({
				fields,
				customFields,
				entity: entityForMapper,
				filter: convertedFilter,
				pagination: pagination as Partial<GQLEntityPaginationInputType<T>>,
			});

			logger.timeLog(logName, 'query built', querySQL, bindings);
			const sql = this.bindSQLQuery(provider, querySQL, bindings);
			const res = (await executeQuery(sql)) as Array<K>;

			return res;
		} finally {
			logger.timeEnd(logName); // eslint-disable-line
		}
	}

	async getQueryResultForInfo<T, FilterT = T, K = any>(
		provider: MetadataProviderType,
		entity: new () => T,
		info: GraphQLResolveInfo,
		filter?: GQLEntityFilterInputFieldType<FilterT>,
		orderBy?: GQLEntityOrderByInputType<T>[]
	): Promise<K | null> {
		const { fields, entityName } = this.resolveInfoFields<T>(provider, entity, info);
		return this.getQueryResultForFields<T, FilterT, K>(
			provider,
			entity,
			fields,
			filter,
			orderBy,
			entityName
		);
	}

	async getQueryResultForFields<T, FilterT = T, K = any>(
		provider: MetadataProviderType,
		entity: new () => T,
		fields: FieldSelection<T>,
		filter?: GQLEntityFilterInputFieldType<FilterT>,
		orderBy?: GQLEntityOrderByInputType<T>[],
		entityNameOverride?: string
	): Promise<K | null> {
		const pagination: Partial<GQLEntityPaginationInputType<FilterT>> = {
			limit: 1,
			orderBy: orderBy as any,
		};
		const results = await this.getQueryResultsForFields<T, FilterT, K>(
			provider,
			entity,
			fields,
			filter,
			pagination,
			entityNameOverride
		);
		return results[0] ?? null;
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
