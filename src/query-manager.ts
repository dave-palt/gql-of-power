import { GraphQLResolveInfo } from 'graphql';
import graphqlFields from 'graphql-fields';
import { getCustomFieldsFor, getGQLEntityNameForClass } from './entities/gql-entity';
import {
	Alias2,
	generateJsonObjectSelectStatement,
	GQLtoSQLMapper,
	mappingsReducer,
} from './queries/gql-to-sql-mapper';
import {
	EntityMetadata,
	Fields,
	GQLEntityFilterInputFieldType,
	GQLEntityPaginationInputType,
	MetadataProvider,
} from './types';
// import { logger } from './variables';

const stop = true;
export const getQueryResultsFor = async <K extends { _____name: string }, T>(
	{ exists, getMetadata, rawQuery, executeQuery }: MetadataProvider,
	entity: new () => T,
	info: GraphQLResolveInfo,
	filter?: GQLEntityFilterInputFieldType<T>,
	pagination?: Partial<GQLEntityPaginationInputType<T>>
): Promise<K[]> => {
	const logName = 'GetQueryResultsFor - ' + entity.name;
	console.time(logName);
	console.timeLog(logName);
	if (!entity || !entity.name) {
		console.timeEnd(logName);
		throw new Error(`Entity ${entity} not compatible`);
	}
	if (!exists(entity.name)) {
		console.timeEnd(logName);
		throw new Error(`Entity ${entity.name} not found in metadata`);
	}
	const mapper = new GQLtoSQLMapper({ exists, getMetadata, rawQuery, executeQuery });
	const fields = graphqlFields(info, {}, { processArguments: true }) as Fields<T>;

	const customFields = getCustomFieldsFor(getGQLEntityNameForClass(entity));

	const alias = Alias2.start('a');
	const metadata = getMetadata(entity.name) as EntityMetadata<T>;

	// const normalised = mapper.recursiveMapFilter({
	// 	entityName: entity.name,
	// 	gqlFilters: filter ? [filter] : [],
	// });

	// console.log('normalised', JSON.stringify(normalised));
	// if (stop) {
	// 	throw new Error('normalised');
	// }

	console.timeLog(logName, 'customFields', customFields);

	const recursiveMapResults = mapper.recursiveMap<T>({
		entityMetadata: metadata,
		parentAlias: alias,
		alias,
		fields,
		customFields,
		gqlFilters: filter ? [filter] : [],
	});

	// logger.info('recursiveMapResults', recursiveMapResults);
	const { select, json, filterJoin, join, where, values, _or, _and } =
		mappingsReducer(recursiveMapResults);

	// logger.info('2GQLtoSQLMapper', _and);

	const orderByFields = (pagination?.orderBy ?? [])
		.map((obs) =>
			Object.keys(obs)
				.map((ob) => `${alias.toString()}.${ob}`)
				.flat()
		)
		.flat();

	const buildOrderBySQL = (pagination?: Partial<GQLEntityPaginationInputType<T>>, alias?: Alias2) =>
		pagination?.orderBy
			? `order by ${pagination.orderBy
					.map((obs) =>
						Object.keys(obs)
							.map((ob) =>
								metadata.properties[ob as string & keyof T].fieldNames
									.map((fn) => `${alias?.toColumnName(fn) ?? fn} ${(obs as any)[ob]}`)
									.join(', ')
							)
							.filter((o) => o.length > 0)
							.join(', ')
					)
					.filter((o) => o.length > 0)
					.join(', ')}`
			: ``;

	// console.error('orderByFields', orderByFields, 'select', select);
	const selectFields = [...new Set(orderByFields.concat(Array.from(select)))];

	const buildSubQuery = (
		globalFilterJoin: string[],
		globalFilterWhere: string[],
		alias: Alias2,
		value?: {
			filterJoin: string[];
			where: string[];
		}
	) => `select ${selectFields.join(', ')} 
            from ${metadata.tableName} as ${alias.toString()}
            ${globalFilterJoin.join(' \n')}
			${value?.filterJoin ? value.filterJoin.join('\n') : ''}
		where true 
		${globalFilterWhere.length > 0 ? ` and ( ${globalFilterWhere.join(' and ')} )` : ''}
		${value?.where ? `and ${value.where.join(' and ')}` : ''}`;

	const unionAll = _or
		.map(({ filterJoin: filterJoins, where: wheres, alias: mapAlias }) => [
			buildSubQuery(filterJoin, where, mapAlias ?? alias, {
				filterJoin: filterJoins,
				where: wheres,
			}),
		])
		.concat(
			_and.map(({ filterJoin: filterJoins, where: wheres, alias: mapAlias }) => [
				buildSubQuery(filterJoin, where, mapAlias ?? alias, {
					filterJoin: filterJoins,
					where: wheres,
				}),
			])
		)
		.flat();

	const selectFieldsSQL = Array.from(orderByFields);
	selectFieldsSQL.push(`${generateJsonObjectSelectStatement(json)} as val`);

	const sourceDataSQL = `${
		unionAll.length > 0
			? `select distinct * from (${unionAll.join(' union all ')}) as ${alias.toString()}`
			: buildSubQuery(filterJoin, where, alias)
	}
		${buildOrderBySQL(pagination, alias)}
		${pagination?.limit ? `limit :limit` : ``}
		${pagination?.offset ? `offset :offset` : ``}`.replaceAll(/[ \n\t]+/gi, ' ');

	console.log('sourceDataSQL', unionAll.length, sourceDataSQL);
	// throw new Error('sourceDataSQL');

	const orderBySQL = pagination?.orderBy
		? `order by ${pagination.orderBy
				.map((obs) =>
					Object.keys(obs)
						.map((ob) =>
							metadata.properties[ob as string & keyof T].fieldNames
								.map((fn) => `${alias.toColumnName(fn)} ${(obs as any)[ob]}`)
								.join(', ')
						)
						.filter((o) => o.length > 0)
						.join(', ')
				)
				.filter((o) => o.length > 0)
				.join(', ')}`
		: ``;

	const querySQL = `select ${selectFieldsSQL.join(', ')}
						from (${sourceDataSQL}) as ${alias.toString()}
						${join.join(' \n')}
						${orderBySQL}`.replaceAll(/[ \n\t]+/gi, ' ');
	const bindings = {
		...values,
		limit: 3000,
		...(pagination?.limit ? { limit: pagination.limit } : {}),
		...(pagination?.offset ? { offset: pagination.offset } : {}),
	};
	console.timeLog(logName, 'input processed, query created', bindings);

	const res = (await executeQuery(rawQuery(querySQL, bindings))) as Array<{ val: K | string }>;

	console.timeLog(logName, 'found', res.length, 'results');
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

	console.timeLog(logName, res.length, 'results mapped');
	console.timeEnd(logName);
	return mapped;
};
