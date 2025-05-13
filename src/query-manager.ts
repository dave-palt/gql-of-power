import { GraphQLResolveInfo } from 'graphql';
import graphqlFields from 'graphql-fields';
import { getCustomFieldsFor } from './entities/gql-entity';
import { GQLtoSQLMapper, mappingsReducer } from './queries/gql-to-sql-mapper';
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
	logger.error('getQueryResultsFor', entity.name);
	if (!entity || !entity.name) {
		throw new Error(`Entity ${entity} not compatible`);
	}
	if (!exists(entity.name)) {
		throw new Error(`Entity ${entity.name} not found in metadata`);
	}
	const mapper = new GQLtoSQLMapper({ exists, getMetadata, rawQuery, executeQuery });
	const fields = graphqlFields(info, {}, { processArguments: true }) as Fields<T>;

	const customFields = getCustomFieldsFor(entity.name);

	const alias = 'a0';
	const metadata = getMetadata(entity.name) as EntityMetadata<T>;
	logger.error('recursiveMap start');
	const { select, json, filterJoin, join, where, values } = mappingsReducer(
		mapper.recursiveMap<T>(
			metadata,
			fields,
			0,
			alias,
			filter ? [filter] : [],
			undefined,
			customFields
		)
	);
	logger.error('recursiveMap done');
	const orderByFields = (pagination?.orderBy ?? [])
		.map((obs) =>
			Object.keys(obs)
				.map((ob) => `${alias}.${ob}`)
				.flat()
		)
		.flat();

	const orderBySQL = pagination?.orderBy
		? `order by ${pagination.orderBy
				.map((obs) =>
					Object.keys(obs)
						.map((ob) =>
							metadata.properties[ob as string & keyof T].fieldNames
								.map((fn) => `${alias}.${fn} ${(obs as any)[ob]}`)
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
            from ${metadata.tableName} as ${alias}
            ${filterJoin.join(' \n')}
                where true 
                ${where.length > 0 ? ' and ' : ''}
                ${where.join(' and ')}
            ${orderBySQL}
                ${pagination?.limit ? `limit :limit` : ``}
                ${pagination?.offset ? `offset :offset` : ``}
    `;

	const selectFieldsSQL = Array.from(orderByFields);
	selectFieldsSQL.push(`jsonb_build_object(${json.join('\n, ')}) as val`);

	const res = (await executeQuery(
		rawQuery(
			`select ${selectFieldsSQL.join(', ')}
            from (${subQuery2}) as ${alias}
            ${join.join(' \n')}
            ${orderBySQL}
    `,
			{
				...values,
				limit: 3000,
				...(pagination?.limit ? { limit: pagination.limit } : {}),
				...(pagination?.offset ? { offset: pagination.offset } : {}),
			}
		)
	)) as Array<{ val: T }>;
	logger.error('res', res.length);
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
	logger.error('mapped finished');
	return mapped;
};
