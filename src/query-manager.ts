import { GraphQLResolveInfo } from 'graphql';
import graphqlFields from 'graphql-fields';
import { getCustomFieldsFor, getGQLEntityNameForClass } from './entities/gql-entity';
import { Alias, GQLtoSQLMapper, mappingsReducer } from './queries/gql-to-sql-mapper';
import {
	EntityMetadata,
	Fields,
	GQLEntityFilterInputFieldType,
	GQLEntityPaginationInputType,
	MetadataProvider,
} from './types';
import { logger } from './variables';

export const getQueryResultsFor = async <K extends { _____name: string }, T>(
	{ exists, getMetadata, rawQuery, executeQuery }: MetadataProvider,
	entity: new () => T,
	info: GraphQLResolveInfo,
	filter?: GQLEntityFilterInputFieldType<T>,
	pagination?: Partial<GQLEntityPaginationInputType<T>>
): Promise<K[]> => {
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
	const mapper = new GQLtoSQLMapper({ exists, getMetadata, rawQuery, executeQuery });
	const fields = graphqlFields(info, {}, { processArguments: true }) as Fields<T>;

	const customFields = getCustomFieldsFor(getGQLEntityNameForClass(entity));

	const alias = new Alias(0, 'a');
	const metadata = getMetadata(entity.name) as EntityMetadata<T>;

	logger.timeLog(logName, 'customFields', customFields);

	const { select, json, filterJoin, join, where, values } = mappingsReducer(
		mapper.recursiveMap<T>({
			entityMetadata: metadata,
			alias,
			fields,
			customFields,
			gqlFilters: filter ? [filter] : [],
		})
	);

	const orderByFields = (pagination?.orderBy ?? [])
		.map((obs) =>
			Object.keys(obs)
				.map((ob) => `${alias.toString()}.${ob}`)
				.flat()
		)
		.flat();

	const orderBySQL = pagination?.orderBy
		? `order by ${pagination.orderBy
				.map((obs) =>
					Object.keys(obs)
						.map((ob) =>
							metadata.properties[ob as string & keyof T].fieldNames
								.map((fn) => `${alias.toString()}.${fn} ${(obs as any)[ob]}`)
								.join(', ')
						)
						.filter((o) => o.length > 0)
						.join(', ')
				)
				.filter((o) => o.length > 0)
				.join(', ')}`
		: ``;
	logger.error('orderByFields', orderByFields, 'select', select);
	const selectFields = [...new Set(orderByFields.concat(Array.from(select)))];
	const subQuery2 = `select ${selectFields.join(', ')} 
            from ${metadata.tableName} as ${alias.toString()}
            ${filterJoin.join(' \n')}
                where true 
                ${where.length > 0 ? ` and ( ${where.join(' and ')} )` : ''}
            ${orderBySQL}
                ${pagination?.limit ? `limit :limit` : ``}
                ${pagination?.offset ? `offset :offset` : ``}
    `;

	const selectFieldsSQL = Array.from(orderByFields);
	selectFieldsSQL.push(`jsonb_build_object(${json.join('\n, ')}) as val`);

	const querySQL = `select ${selectFieldsSQL.join(', ')}
	from (${subQuery2}) as ${alias.toString()}
	${join.join(' \n')}
	${orderBySQL}
    `;
	const bindings = {
		...values,
		limit: 3000,
		...(pagination?.limit ? { limit: pagination.limit } : {}),
		...(pagination?.offset ? { offset: pagination.offset } : {}),
	};
	logger.timeLog(logName, 'input processed, query created');
	const res = (await executeQuery(rawQuery(querySQL, bindings))) as Array<{ val: T }>;

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

		return val as any as K;
	});

	logger.timeLog(logName, res.length, 'results mapped');
	logger.timeEnd(logName);
	return mapped;
};
