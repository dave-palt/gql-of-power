import { ClassOperationInputType, ClassOperations, FieldOperations } from '../operations';
import {
	CustomFieldsSettings,
	EntityMetadata,
	EntityProperty,
	Fields,
	GQLEntityFilterInputFieldType,
	GQLEntityOrderByInputType,
	GQLEntityPaginationInputType,
	MappingsType,
	MetadataProvider,
	ReferenceType,
} from '../types';
import { logger } from '../variables';
import { Alias, AliasManager, AliasType } from './alias';

export const newMappings = () =>
	({
		select: new Set<string>(),
		json: [] as string[],
		filterJoin: [] as string[],
		join: [] as string[],
		where: [] as string[],
		values: {} as Record<string, any>,
		orderBy: [] as GQLEntityOrderByInputType<any>[],
		_or: [] as MappingsType[],
		_and: [] as MappingsType[],
		_not: [] as MappingsType[],
	} as MappingsType);

const isPrimitive = (filterValue: any): filterValue is string | number | boolean | bigint | null =>
	typeof filterValue === 'bigint' ||
	typeof filterValue === 'boolean' ||
	typeof filterValue === 'number' ||
	typeof filterValue === 'string' ||
	typeof filterValue === 'symbol' ||
	filterValue === null;

const USE_STRING = process.env.D3GOP_USE_STRING_FOR_JSONB === 'true';
const jsonReducerForString = (
	/**
	 * `'id', `
	 */
	j: string,
	index: number
): string => {
	const [key, value] = j.split(',');
	return `'${index > 0 ? ',' : ''}${key.replaceAll(
		/[']/gi,
		'"'
	)}:' || coalesce(${value}::text, '""')`;
};
export const generateJsonObjectSelectStatement = (json: string[], isMulti = false) =>
	isMulti
		? !USE_STRING
			? `coalesce(json_agg(jsonb_build_object(${json.join(', ')})), '[]'::json)`
			: `'['||coalesce(string_agg('{"' || ${json
					.map(jsonReducerForString)
					.join('||')} || '"}', ','), '') || ']'`
		: !USE_STRING
		? `jsonb_build_object(${json.join(', ')})`
		: `'{' || ${json.map(jsonReducerForString).join(' || ')} || '}'`;

export const mappingsReducer = (m: Map<string, MappingsType>, startMapping = newMappings()) =>
	Array.from(m.values()).reduce(
		(
			{ select, filterJoin, json, join, where, values, limit, offset, orderBy, _or, _and, _not },
			mapping
		) => {
			mapping.select.forEach((s) => select.add(s));
			json.push(...mapping.json);
			filterJoin.push(...mapping.filterJoin);
			join.push(...mapping.join);
			where.push(...mapping.where);
			orderBy.push(...mapping.orderBy);
			_or.push(...mapping._or);
			_and.push(...mapping._and);
			_not.push(...mapping._not);
			values = { ...values, ...mapping.values };

			return {
				select,
				json,
				filterJoin,
				join,
				where,
				values,
				limit: mapping.limit ?? limit,
				offset: mapping.offset ?? offset,
				orderBy,
				_or,
				_and,
				_not,
			};
		},
		startMapping
	);
export type QueryAndBindings = { querySQL: string; bindings: any };

export class GQLtoSQLMapper extends ClassOperations {
	private Alias2 = new AliasManager();

	private exists: MetadataProvider['exists'];
	private getMetadata: MetadataProvider['getMetadata'];
	constructor({ exists, getMetadata }: MetadataProvider) {
		super();
		this.exists = exists;
		this.getMetadata = getMetadata;
	}

	public buildQueryAndBindingsFor<T>({
		fields,
		filter,
		customFields,
		entity,
		pagination,
	}: {
		fields: Fields<T>;
		customFields: CustomFieldsSettings<T>;
		entity: new () => T;
		filter?: GQLEntityFilterInputFieldType<T>;
		pagination?: Partial<GQLEntityPaginationInputType<T>>;
	}): QueryAndBindings {
		const logName = 'GQLtoSQLMapper - ' + entity.name;
		console.time(logName);
		console.timeLog(logName);

		this.Alias2 = new AliasManager();
		const alias = this.Alias2.start('a');
		const metadata = this.getMetadata(entity.name) as EntityMetadata<T>;

		console.timeLog(logName, 'customFields', customFields);

		const recursiveMapResults = this.recursiveMap<T>({
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

		const orderByFields = (pagination?.orderBy ?? [])
			.map((obs) =>
				Object.keys(obs)
					.map((ob) => `${alias.toString()}.${ob}`)
					.flat()
			)
			.flat();

		const buildOrderBySQL = (
			pagination?: Partial<GQLEntityPaginationInputType<T>>,
			alias?: Alias
		) =>
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
			alias: Alias,
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

		logger.log(logName, 'sourceDataSQL', unionAll.length, sourceDataSQL);
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

		console.timeEnd(logName);
		return { querySQL, bindings };
	}

	public recursiveMap = <T>({
		entityMetadata,
		fields,
		parentAlias,
		alias,
		gqlFilters,
		prefix,
		customFields,
	}: {
		entityMetadata: EntityMetadata<T>;
		fields?: Fields<T> | any;
		parentAlias: Alias;
		alias: Alias;
		gqlFilters?: Array<GQLEntityFilterInputFieldType<T>>;
		prefix?: string;
		customFields?: CustomFieldsSettings<T>;
	}) => {
		const logPrefix = alias.concat('GQLtoSQLMapper - recursiveMap');
		logger.log(logPrefix, 'start');
		const { properties, primaryKeys } = entityMetadata;

		let res = [...new Set(Object.keys(fields ?? {}))]
			.sort((f1, f2) => (f1.startsWith('__') ? -1 : f2.startsWith('__') ? 1 : 0))
			.reduce(
				({ mappings }, gqlFieldNameKey) => {
					if (gqlFieldNameKey.startsWith('__')) {
						this.handleFieldArguments<T>(gqlFieldNameKey, fields, alias, entityMetadata, mappings);
					} else {
						const mapping = this.getFieldMapping(mappings, gqlFieldNameKey);

						const customFieldProps =
							customFields?.[gqlFieldNameKey as keyof CustomFieldsSettings<T>];

						const fieldProps =
							properties[gqlFieldNameKey as keyof EntityMetadata<T>['properties']] ??
							properties[customFieldProps?.requires as keyof EntityMetadata<T>['properties']];

						const gqlFieldName = (customFieldProps?.requires as string) ?? gqlFieldNameKey;
						logger.log('=> recursiveMap fields, gqlFieldName', gqlFieldName, mapping);

						if (!fieldProps) {
							return this.mapCustomField<T>(
								customFieldProps,
								mapping,
								alias,
								gqlFieldName,
								mappings
							);
						} else {
							this.mapField<T>(fieldProps, mapping, alias, fields, gqlFieldName, primaryKeys);
						}
					}
					return { mappings };
				},
				{ mappings: new Map<string, MappingsType>() }
			);

		logger.log(logPrefix, 'fields processed');
		res = (gqlFilters ?? []).reduce(
			({ mappings }, gqlFilter) => {
				Object.keys(gqlFilter ?? {}).forEach((gqlFieldNameKey) => {
					this.mapFilter(
						entityMetadata,
						mappings,
						parentAlias,
						alias,
						gqlFieldNameKey as any,
						gqlFilter,
						customFields
					);
				});
				return { mappings };
			},
			{ mappings: res.mappings }
		);
		(gqlFilters ?? []).length > 0 && logger.log(logPrefix, 'filters processed');
		// (orderBy ?? []).map((ob) => {
		// 	Object.keys(ob).forEach((f) => {
		// 		const m = newMappings();
		// 		const orderBy = `${alias}.${f} ${ob[f as keyof GQLEntityOrderByInputType<T>]}`;
		// 		logger.log('recursiveMap -> orderBy', orderBy);
		// 		[...res.entries()].forEach(([k, m]) => {
		// 			if (!m.orderBy) {
		// 				m.orderBy = [];
		// 			}
		// 			logger.log('recursiveMap -> orderBy added to', k);
		// 			m.orderBy.push(orderBy);
		// 		});
		// 		res.set(f, m);
		// 	});
		// });
		logger.log(logPrefix, 'end');
		logger.log('');
		return res.mappings;
	};

	private mapCustomField<T>(
		customFieldProps:
			| import('/Users/davide.palchetti/Documents/bingoindustries/go-collect/gql-of-power/src/types').RelatedFieldSettings<T>
			| undefined,
		mapping: MappingsType,
		latestAlias: Alias,
		gqlFieldName: string,
		mappings: Map<string, MappingsType>
	) {
		if (customFieldProps?.requires) {
			const requires =
				customFieldProps.requires instanceof Array
					? customFieldProps.requires
					: [customFieldProps.requires];
			requires.forEach((req) => {
				mapping.select.add(latestAlias.toString() + '.' + req);
			});
		}
		mapping.json.push(`'${gqlFieldName}', null`);
		return { mappings, latestAlias };
	}

	protected mapField<T>(
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		mapping: MappingsType,
		alias: Alias,
		fields: any,
		gqlFieldName: string,
		primaryKeys: string[]
	) {
		const referenceField =
			this.exists(fieldProps.type) && this.getMetadata<any, EntityMetadata<any>>(fieldProps.type);

		if (referenceField) {
			logger.log('GQLtoSQLMapper - recursiveMap - referenceField latest alias', alias.toString());
			const childAlias = this.Alias2.next(AliasType.field, 'p');

			logger.log(
				'GQLtoSQLMapper - recursiveMap - referenceField latest alias next',
				alias.toString(),
				childAlias.toString()
			);

			const {
				select,
				json,
				join,
				where: whereWithValues,
				values,
				filterJoin,
				limit,
				offset,
				orderBy,
			} = mappingsReducer(
				this.recursiveMap({
					entityMetadata: referenceField,
					fields: fields[gqlFieldName],
					parentAlias: alias,
					alias: childAlias,
				})
			);
			logger.log(
				'GQLtoSQLMapper - recursiveMap - referenceField',
				referenceField.name,
				'filterJoin',
				filterJoin,
				'limit',
				limit,
				'offset',
				offset,
				'orderBy',
				mapping.orderBy
			);
			if (
				fieldProps.reference === ReferenceType.ONE_TO_MANY ||
				fieldProps.reference === ReferenceType.ONE_TO_ONE
			) {
				this.mapFieldOneToX<T>(
					referenceField,
					fieldProps,
					mapping,
					alias,
					childAlias,
					whereWithValues,
					values,
					limit,
					offset,
					orderBy,
					gqlFieldName,
					json,
					select,
					filterJoin,
					join
				);
			} else if (fieldProps.reference === ReferenceType.MANY_TO_ONE) {
				this.mapFieldManyToOne<T>(
					fieldProps,
					referenceField,
					alias,
					childAlias,
					mapping,
					whereWithValues,
					values,
					filterJoin,
					limit,
					offset,
					gqlFieldName,
					select,
					json,
					join
				);
			} else if (fieldProps.reference === ReferenceType.MANY_TO_MANY) {
				this.mapFieldManyToMany<T>(
					referenceField,
					primaryKeys,
					fieldProps,
					alias,
					childAlias,
					select,
					whereWithValues,
					join,
					json,
					mapping,
					gqlFieldName,
					values,
					limit,
					offset,
					orderBy
				);
			} else {
				logger.log(
					'GQLtoSQLMapper - recursiveMap - reference type',
					fieldProps.reference,
					'not handled for field',
					gqlFieldName,
					'with referenceField',
					limit,
					offset
				);
			}
		} else if (fieldProps.fieldNames.length > 0) {
			this.processFieldNames(alias, fieldProps.fieldNames, mapping, gqlFieldName);
		} else {
			logger.log('reference type', fieldProps.reference, 'not handled for field', gqlFieldName);
		}
	}

	protected handleFieldArguments<T>(
		gqlFieldNameKey: string,
		fields: any,
		alias: Alias,
		entityMetadata: EntityMetadata<T>,
		mappings: Map<string, MappingsType>
	) {
		if (gqlFieldNameKey === '__arguments') {
			const __arguments = fields[gqlFieldNameKey];

			// const nextAlias = latestAlias.next();
			const m = newMappings();

			const filter = __arguments.find((a: any) => a?.filter)?.filter?.value;
			const pagination = __arguments.find((a: any) => a?.pagination)?.pagination?.value;

			if (filter || pagination) {
				const {
					filterJoin,
					where: w,
					values,
				} = mappingsReducer(
					this.recursiveMap({
						entityMetadata,
						parentAlias: alias,
						alias,
						gqlFilters: [filter],
					})
				);
				m.filterJoin.push(...filterJoin);
				m.where.push(...w);
				m.values = { ...m.values, ...values };
				m.limit = pagination?.limit;
				m.offset = pagination?.offset;
				m.orderBy.push(...(pagination?.orderBy ?? []));
			} else {
				// m.__arguments = __arguments;
			}
			mappings.set(gqlFieldNameKey, m);
			logger.log('GQLtoSQLMapper - handleFieldArguments for', m);
		}
	}

	protected mapFieldOneToX<T>(
		referenceField: EntityMetadata<any>,
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		mapping: MappingsType,
		parentAlias: Alias,
		alias: Alias,
		whereWithValues: string[],
		values: Record<string, any>,
		limit: number | undefined,
		offset: number | undefined,
		orderBy: GQLEntityOrderByInputType<any>[],
		gqlFieldName: string,
		json: string[],
		select: Set<string>,
		filterJoin: string[],
		join: string[]
	) {
		const referenceFieldProps = referenceField.properties[
			fieldProps.mappedBy as keyof typeof referenceField.properties
		] as EntityProperty;

		const ons = referenceFieldProps.joinColumns;
		const entityOns = referenceFieldProps.referencedColumnNames;

		if (ons.length !== entityOns.length) {
			throw new Error(
				`joins with different number of columns ${ons.length} !== ${entityOns.length} on ${referenceFieldProps.name}. Entity: ${referenceField.name}, Table: ${referenceField.tableName}`
			);
		}
		const where = entityOns
			.map((o, i) => {
				return `${parentAlias.toColumnName(o)} = ${alias.toColumnName(ons[i])}`;
			})
			.join(' and ');

		logger.log(
			'GQLtoSQLMapper - mapFieldOneToX: field',
			referenceField.name,
			'whereSQL',
			whereWithValues,
			'values',
			values,
			'limit',
			limit,
			'offset',
			offset,
			'orderBy',
			orderBy
		);
		if (referenceField.tableName && where.length > 0) {
			mapping.json.push(`'${gqlFieldName}', ${alias.toColumnName('value')}`);

			const isArray = fieldProps.reference !== ReferenceType.ONE_TO_ONE;
			const jsonSelect = generateJsonObjectSelectStatement(json, isArray);

			const onFields = Array.from(
				new Set(ons.map((on) => `${alias.toColumnName(on)}`).concat(Array.from(select)))
			);

			const processedOrderBy = orderBy.reduce((acc, ob) => {
				Object.keys(ob).forEach((k: string) => {
					logger.log(
						'recursiveMap - processedOrderBy',
						k,
						ob[k],
						(referenceField as any).properties[k]
					);
					if (k in referenceField.properties) {
						acc.push(
							...referenceField.properties[
								k as keyof typeof referenceField.properties
							].fieldNames.map((fn) => `${alias.toColumnName(fn)} ${(ob as any)[k]}`)
						);
					}
				});
				return acc;
			}, [] as string[]);

			logger.log(
				'GQLtoSQLMapper - mapFieldOneToX: field',
				referenceField.name,
				'filterJoin',
				filterJoin,
				'fieldWhere',
				whereWithValues,
				'values',
				values,
				limit,
				offset
			);
			const orderBySQL =
				processedOrderBy.length > 0 ? ` order by ${processedOrderBy.join(', ')} ` : '';

			const isNestedNeeded = offset || limit || processedOrderBy.length > 0;

			const fromSQL = `"${referenceField.tableName}" as ${alias.toString()}`;

			const subFromSQL = `(
				select ${onFields.join(', ')}
					from "${referenceField.tableName}" as ${alias.toString()}
					${filterJoin.join(' \n')}
					where ${where}
					${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
					${orderBySQL}
					${limit && !isNaN(limit) ? `limit ${limit}` : ''}
					${offset && !isNaN(offset) ? `offset ${offset}` : ''}
			) as ${alias.toString()}`;

			const leftOuterJoin2 = `left outer join lateral (
                                select ${jsonSelect} as value 
									from ${isNestedNeeded ? subFromSQL : fromSQL}
                            		${join.join(' \n')}
									${
										isNestedNeeded
											? ''
											: `
									where ${where}
										${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
										${orderBySQL}
										${limit && !isNaN(limit) ? `limit ${limit}` : ''}
										${offset && !isNaN(offset) ? `offset ${offset}` : ''}`
									}
							) as ${alias.toString()} on true`.replaceAll(/[ \n\t]+/gi, ' ');

			const subFromSQL2 = `${orderBySQL ? '( select * from' : ''} "${referenceField.tableName}" 
			${
				orderBySQL
					? `as ${alias.toString()} 
			
			${orderBySQL} )`
					: ''
			}`;

			mapping.alias = alias;
			mapping.values = { ...mapping.values, ...values };
			mapping.join.push(leftOuterJoin2);
		}
	}

	protected mapFieldManyToOne<T>(
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		referenceField: EntityMetadata<any>,
		parentAlias: Alias,
		alias: Alias,
		mapping: MappingsType,
		whereWithValues: string[],
		values: Record<string, any>,
		filterJoin: string[],
		limit: number | undefined,
		offset: number | undefined,
		gqlFieldName: string,
		select: Set<string>,
		json: string[],
		join: string[]
	) {
		if (fieldProps.fieldNames.length !== referenceField.primaryKeys.length) {
			throw new Error(
				`Mismatch in lengths: fieldProps.fieldNames (${fieldProps.fieldNames.length}) and referenceField.primaryKeys (${referenceField.primaryKeys.length}) must have the same length.`
			);
		}
		if (fieldProps.fieldNames.length && referenceField.tableName) {
			const ons = referenceField.primaryKeys;
			const entityOns = fieldProps.fieldNames;

			const where = entityOns
				.map((o, i) => {
					return `${parentAlias.toColumnName(o)} = ${alias.toColumnName(ons[i])}`;
				})
				.join(' and ');

			logger.log(
				'GQLtoSQLMapper - mapFieldManyToOne: whereSQL',
				referenceField.name,
				alias.toString(),
				parentAlias.toString(),
				'where',
				whereWithValues,
				'values',
				values,
				'filterJoin',
				filterJoin,
				limit,
				offset
			);

			mapping.select.add(
				`${fieldProps.fieldNames.map((fn) => parentAlias.toColumnName(fn)).join(', ')}`
			);
			mapping.json.push(`'${gqlFieldName}', ${alias.toColumnName('value')}`);

			const selectFields = [
				...new Set(ons.map((on) => alias.toColumnName(on)).concat(Array.from(select))),
			];

			const jsonSQL = generateJsonObjectSelectStatement(json);

			const fromSQL = `"${referenceField.tableName}" as ${alias.toString()}`;

			// this would be used for limit/offset, but there's no limit/offset for many to one
			const subFromSQL = `( select ${selectFields.join(', ')} 
			from "${referenceField.tableName}" as ${alias.toString()}
				where ${where}
				${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
				${limit && !isNaN(limit) ? `limit ${limit}` : ''}
				${offset && !isNaN(offset) ? `offset ${offset}` : ''}
			) as ${alias.toString()}`;

			const leftOuterJoin = `left outer join lateral (
                                select ${jsonSQL} as value 
									from ${fromSQL}
									${join.join(' \n')}
									${
										// these should be removed if using `subFromSQL`
										`where ${where}
										${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
										${limit && !isNaN(limit) ? `limit ${limit}` : ''}
										${offset && !isNaN(offset) ? `offset ${offset}` : ''}`
									}
								) as ${alias.toString()} on true`.replaceAll(/[ \n\t]+/gi, ' ');

			mapping.join.push(leftOuterJoin);
			mapping.values = { ...mapping.values, ...values };
		}
	}

	protected mapFieldManyToMany<T>(
		referenceField: EntityMetadata<any>,
		primaryKeys: string[],
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		parentAlias: Alias,
		alias: Alias,
		select: Set<string>,
		whereWithValues: string[],
		join: string[],
		json: string[],
		mapping: MappingsType,
		gqlFieldName: string,
		values: Record<string, any>,
		limit?: number,
		offset?: number,
		orderBy?: GQLEntityOrderByInputType<any>[]
	) {
		const ons = fieldProps.joinColumns;
		if (primaryKeys.length !== ons.length) {
			throw new Error(
				`m:m joins with different number of columns ${primaryKeys.length} !== ${ons.length} on table ${referenceField.tableName}`
			);
		}
		if (referenceField.primaryKeys.length !== fieldProps.inverseJoinColumns.length) {
			throw new Error(
				`m:m joins with different number of columns ${referenceField.primaryKeys.length} !== ${fieldProps.inverseJoinColumns.length} on reference ${referenceField.tableName}.${fieldProps.pivotTable}`
			);
		}

		const pivotTableWhereSQL = primaryKeys.map((o, i) => {
			return `${parentAlias.toColumnName(o)} = ${fieldProps.pivotTable}.${ons[i]}`;
		});

		const selectFields = [
			...select,
			// ...new Set(ons.map((on) => `${childAlias.toValue(on)}`).concat(Array.from(select))),
		];
		logger.log(
			'GQLtoSQLMapper - mapFieldManyToMany selectFields',
			selectFields,
			limit,
			offset,
			orderBy
		);
		logger.log('GQLtoSQLMapper - mapFieldManyToMany', pivotTableWhereSQL, whereWithValues, join);
		if (pivotTableWhereSQL.length > 0) {
			const pivotTableSQL = `select ${fieldProps.inverseJoinColumns.join(', ')} 
													from ${fieldProps.pivotTable}
												where ${pivotTableWhereSQL.join(' and ')}`;

			const jsonSQL = generateJsonObjectSelectStatement(json, true);

			const refAlias = alias.toString();
			const leftOuterJoin = `left outer join lateral (
			select ${jsonSQL} as value 
				from (
					select ${selectFields.join(', ')} 
						from "${referenceField.tableName}" as ${refAlias}
					where (${referenceField.primaryKeys.join(', ')})
						in (${pivotTableSQL})
						${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
						${
							orderBy && orderBy.length > 0
								? ` order by ${orderBy
										.map((o) =>
											Object.keys(o ?? {})
												.map((column) => `${alias.toColumnName(column)} ${o[column]}`)
												.join(', ')
										)
										.join(', ')}`
								: ''
						}
					${limit && !isNaN(limit) ? `limit ${limit}` : ''}
					${offset && !isNaN(offset) ? `offset ${offset}` : ''}
				) as ${refAlias}
				${join.join(' \n')}
		) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, ' ');

			mapping.json.push(`'${gqlFieldName}', ${alias.toColumnName('value')}`);
			mapping.join.push(leftOuterJoin);
			mapping.values = { ...mapping.values, ...values };
		} else {
			mapping.json.push(`'${gqlFieldName}', null`);
		}
	}

	private getFieldMapping(mappings: Map<string, MappingsType>, gqlFieldNameKey: string) {
		const m = mappings.get(gqlFieldNameKey);
		if (m) {
			return m;
		}
		const newMapping = newMappings();
		mappings.set(gqlFieldNameKey, newMapping);
		return newMapping;
	}

	protected processFieldNames(
		alias: Alias,
		fieldNames: string[],
		mapping: MappingsType,
		gqlFieldName: string
	) {
		logger.info('GQLtoSQLMapper - processFieldNames', fieldNames, gqlFieldName);
		if (fieldNames.length <= 0) {
			logger.warn(
				'GQLtoSQLMapper - processFieldNames: fieldNames is empty',
				gqlFieldName,
				'skipping'
			);
			return;
		}

		fieldNames.length > 1 &&
			logger.warn(gqlFieldName, 'has multiple fieldNames:', fieldNames, 'taking first only');

		const fieldNameWithAlias = alias.toColumnName(fieldNames[0]);

		mapping.select.add(fieldNameWithAlias);
		mapping.json.push(`'${gqlFieldName}', ${fieldNameWithAlias}`);
	}

	protected buildSubQuery(
		selectFields: string[],
		tableName: string,
		alias: Alias,
		globalFilterJoin: string[],
		globalWhereJoin: string[],
		value?:
			| {
					filterJoin: string;
			  }
			| {
					where: string;
			  }
	) {
		return `select ${selectFields.join(', ')} 
            from ${tableName} as ${alias.toString()}
            ${globalFilterJoin.join(' \n')}
			${value && 'filterJoin' in value ? value.filterJoin : ''}
		where true 
		${globalWhereJoin.length > 0 ? ` and ( ${globalWhereJoin.join(' and ')} )` : ''}
		${value && 'where' in value ? `and ${value.where}` : ''}`;
	}

	protected buildUnionAll(
		fields: string[],
		tableName: string,
		alias: Alias,
		globalFilterJoin: string[],
		join: string[],
		whereSQL: string,
		globalFilterWhere: string[],
		_or: MappingsType[],
		queryBuilder: (
			fields: string[],
			alias: Alias,
			tableName: string,
			filterJoin: string[],
			join: string[],
			whereSQL: string,
			whereWithValues: string[],
			value?:
				| {
						filterJoin: string;
				  }
				| {
						where: string;
				  }
		) => string
	) {
		return _or
			.map(({ filterJoin: filterJoins, where: wheres }) => [
				...filterJoins.map((filterJ) =>
					queryBuilder(
						fields,
						alias,
						tableName,
						globalFilterJoin,
						join,
						whereSQL,
						globalFilterWhere,
						{
							filterJoin: filterJ,
						}
					)
				),
				...wheres.map((w) =>
					queryBuilder(
						fields,
						alias,
						tableName,
						globalFilterJoin,
						join,
						whereSQL,
						globalFilterWhere,
						{
							where: w,
						}
					)
				),
			])
			.flat();
	}
	protected mapFilter<T>(
		entityMetadata: EntityMetadata<T>,
		mappings: Map<string, MappingsType>,
		parentAlias: Alias,
		alias: Alias,
		gqlFieldNameKey: string & keyof GQLEntityFilterInputFieldType<T>,
		gqlFilter: GQLEntityFilterInputFieldType<T>,
		customFields?: CustomFieldsSettings<T>
	) {
		if (gqlFilter == undefined) {
			return;
		}
		const { properties, primaryKeys } = entityMetadata;
		if (
			typeof gqlFilter === 'object' &&
			(gqlFieldNameKey === '_and' || gqlFieldNameKey === '_or' || gqlFieldNameKey === '_not')
		) {
			if (!(gqlFieldNameKey in gqlFilter) || gqlFilter[gqlFieldNameKey] === undefined) {
				return;
			}
			logger.log(
				'GQLtoSQLMapper - info - ClassOperations: processing initial if',
				gqlFieldNameKey,
				gqlFilter
			);
			this.processClassOperation<T>(
				entityMetadata,
				gqlFilter,
				gqlFieldNameKey,
				mappings,
				parentAlias,
				alias
			);
			return;
		}
		const filterValue = gqlFilter[gqlFieldNameKey];

		// id_in, id_eq, id_ne, id_gt, id_gte, id_lt, id_lte, etc...
		const fieldOperation = Object.keys(FieldOperations).find((k) => gqlFieldNameKey.endsWith(k));
		logger.log(
			'GQLtoSQLMapper - info - processing key',
			gqlFieldNameKey,
			'value',
			filterValue,
			'fieldOperation',
			fieldOperation
		);
		if (fieldOperation) {
			// { id_eq: 1 }
			this.mapFieldOperation(
				mappings,
				gqlFieldNameKey,
				alias,
				fieldOperation,
				filterValue,
				properties
			);
			logger.log(
				'GQLtoSQLMapper - FieldOperation: processed',
				gqlFieldNameKey,
				fieldOperation,
				'filterValue',
				filterValue,
				'latestAlias',
				alias.toString(),
				'mapping',
				mappings.get(gqlFieldNameKey)
			);
		} else {
			const lowercasedFirstFieldNameKey =
				gqlFieldNameKey[0].toLowerCase() + gqlFieldNameKey.slice(1);

			// we look for the props of the field as is, if not found we look for the lowercased first letter
			const customFieldProps =
				customFields?.[gqlFieldNameKey as keyof CustomFieldsSettings<T>] ??
				customFields?.[lowercasedFirstFieldNameKey as keyof CustomFieldsSettings<T>];

			// find the first compatible field name
			const fieldProps =
				properties[gqlFieldNameKey as keyof EntityMetadata<T>['properties']] ??
				properties[lowercasedFirstFieldNameKey as keyof EntityMetadata<T>['properties']] ??
				properties[customFieldProps?.requires as keyof EntityMetadata<T>['properties']];

			// fieldNameToUse: id => id, Id => id, CustomField => CustomField (?) last one is not tested
			const fieldNameKey = fieldProps
				? properties[gqlFieldNameKey as keyof EntityMetadata<T>['properties']]
					? gqlFieldNameKey
					: properties[lowercasedFirstFieldNameKey as keyof EntityMetadata<T>['properties']]
					? lowercasedFirstFieldNameKey
					: null
				: null;

			const gqlFieldName = (customFieldProps?.requires as string) ?? fieldNameKey;

			logger.log('GQLtoSQLMapper field ==>', gqlFieldNameKey, 'fieldNameKey', fieldNameKey);

			if (!fieldNameKey) {
				logger.log(
					alias.toString(),
					gqlFieldName,
					'not found in properties nor in customFields, properties',
					properties
				);
				throw new Error(
					`${alias.toString()} ${gqlFieldNameKey} => ${gqlFieldName} ${fieldOperation} not found in properties nor in customFields ${JSON.stringify(
						gqlFilter
					)}`
				);
			}

			const mapping = this.getMapping(mappings, fieldNameKey);
			mapping.alias = alias;

			const referenceField =
				this.exists(fieldProps.type) && this.getMetadata<any, any>(fieldProps.type);

			if (referenceField) {
				const childAlias = this.Alias2.next(AliasType.entity, 'w');

				const recursiveMapResults = this.recursiveMap({
					entityMetadata: referenceField,
					parentAlias: alias,
					alias: childAlias,
					gqlFilters: [filterValue as any],
				});
				const {
					join,
					where: whereWithValues,
					values,
					filterJoin,
					_or,
				} = mappingsReducer(recursiveMapResults);

				logger.log(
					'GQLtoSQLMapper - mapFilter: referenceField',
					referenceField.name,
					fieldProps.reference,
					'recursiveMapResults',
					recursiveMapResults,
					'_or',
					_or,
					alias.toString(),
					childAlias.toString()
				);
				if (
					fieldProps.reference === ReferenceType.ONE_TO_MANY ||
					fieldProps.reference === ReferenceType.ONE_TO_ONE
				) {
					this.mapFilterOneToX<T>(
						referenceField,
						fieldProps,
						alias,
						childAlias,
						gqlFieldName,
						whereWithValues,
						join,
						filterJoin,
						values,
						mapping,
						_or
					);
				} else if (fieldProps.reference === ReferenceType.MANY_TO_ONE) {
					this.mapFilterManyToOne<T>(
						fieldProps,
						referenceField,
						alias,
						childAlias,
						whereWithValues,
						join,
						filterJoin,
						mapping,
						values,
						_or
					);
				} else if (fieldProps.reference === ReferenceType.MANY_TO_MANY) {
					this.mapFilterManyToMany<T>(
						fieldProps,
						primaryKeys,
						referenceField,
						alias,
						childAlias,
						whereWithValues,
						join,
						filterJoin,
						mapping,
						values,
						_or
					);
				} else {
					logger.warn('reference type', fieldProps.reference, 'not handled, field', gqlFieldName);
				}
			} else if (filterValue !== undefined) {
				// filterValue = { id: 1 } OR { otherField: 2 }

				/**
				 * `[id]` OR `[other_field]` or whatever the fields names are
				 */
				const fieldNames =
					properties[fieldNameKey as keyof EntityMetadata<T>['properties']].fieldNames;

				fieldNames.forEach((fieldName) => {
					this.applyFilterValue<typeof filterValue>({
						filterValue: filterValue as any,
						fieldOperation: '_eq',
						fieldName,
						parentAlias,
						alias,
						mapping,
					});
				});
				logger.log(
					'GQLtoSQLMapper - ClassOperations: value _eq',
					gqlFieldName,
					'field names',
					fieldNames,
					'filterValue',
					filterValue,
					'latestAlias',
					alias.toString(),
					'mapping',
					mapping
				);
			}
		}
	}
	protected getMapping(mappings: Map<string, MappingsType>, fieldNameKey: string) {
		const m = mappings.get(fieldNameKey);
		if (m) {
			return m;
		}

		const mapping = newMappings();
		mappings.set(fieldNameKey, mapping);
		return mapping;
	}

	protected mapFieldOperation<T>(
		mappings: Map<string, MappingsType>,
		gqlFieldNameKey: string,
		alias: Alias,
		fieldOperation: string,
		fieldValue: GQLEntityFilterInputFieldType<T>[any],
		properties: { [key in string & keyof T]: EntityProperty }
	) {
		const exists = mappings.has(gqlFieldNameKey);
		if (!exists) {
			mappings.set(gqlFieldNameKey, newMappings());
		}
		const mapping = mappings.get(gqlFieldNameKey) ?? newMappings();

		const fieldNameBeforeOperation = gqlFieldNameKey.slice(0, -fieldOperation.length);

		if (
			Array.isArray(fieldValue) &&
			fieldNameBeforeOperation in properties &&
			(fieldOperation as keyof typeof FieldOperations) !== '_in' &&
			(fieldOperation as keyof typeof FieldOperations) !== '_nin'
		) {
			mapping.where.push(
				...properties[fieldNameBeforeOperation as keyof typeof properties].fieldNames.map(
					(fieldName, i) => {
						// const nextValueSQL = nextValue.next();
						const values = fieldValue.map(
							(fv, i) => {
								// const nextValueAlias = nextValueSQL.nextValue();
								const nextValueAlias = this.Alias2.next(AliasType.value, fieldName);

								mapping.values[nextValueAlias.toParamName(i)] = fv;
								return ':' + nextValueAlias.toParamName(i);
							},
							{
								keys: [] as string[],
								values: [] as any[],
							}
						);

						return FieldOperations[fieldOperation as keyof typeof FieldOperations](
							[alias.toColumnName(fieldName), ...values],
							['', ...fieldValue]
						);
					}
				)
			);
		} else {
			const nextValueAlias = this.Alias2.next(AliasType.value, gqlFieldNameKey);
			logger.log(
				'2GQLtoSQLMapper - mapFieldOperation: field',
				fieldNameBeforeOperation,
				'fieldValue',
				fieldValue,
				'alias',
				nextValueAlias.toParamName(1)
			);
			const fieldNames =
				properties[fieldNameBeforeOperation as keyof typeof properties]?.fieldNames;
			if (!fieldNames) {
				throw new Error('fieldNames not found in properties for field ' + fieldNameBeforeOperation);
			}
			mapping.where.push(
				...fieldNames.map((fieldName) =>
					FieldOperations[fieldOperation as keyof typeof FieldOperations](
						[alias.toColumnName(fieldName), `:${nextValueAlias.toParamName(1)}`],
						['', ...(Array.isArray(fieldValue) ? fieldValue : [fieldValue])]
					)
				)
			);
			mapping.values[nextValueAlias.toParamName(1)] = fieldValue;
		}
	}

	protected mapFilterManyToMany<T>(
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		primaryKeys: string[],
		referenceField: EntityMetadata<unknown>,
		parentAlias: Alias,
		alias: Alias,
		whereWithValues: string[],
		join: string[],
		filterJoin: string[],
		mapping: MappingsType,
		values: Record<string, any>,
		_or: MappingsType[]
	) {
		const ons = fieldProps.joinColumns;
		if (primaryKeys.length !== ons.length) {
			throw new Error(
				`m:m joins with different number of columns ${primaryKeys.length} !== ${ons.length} on table ${referenceField.tableName}`
			);
		}
		if (referenceField.primaryKeys.length !== fieldProps.inverseJoinColumns.length) {
			throw new Error(
				`m:m joins with different number of columns ${referenceField.primaryKeys.length} !== ${fieldProps.inverseJoinColumns.length} on reference ${referenceField.tableName}.${fieldProps.pivotTable}`
			);
		}

		const pivotTableWhereSQLs = primaryKeys.map((o, i) => {
			return `${parentAlias.toColumnName(o)} = ${fieldProps.pivotTable}.${ons[i]}`;
		});
		logger.log(
			'GQLtoSQLMapper - mapFilterManyToOne: alias',
			alias.toString(),
			'pivotTableWhereSQLs',
			pivotTableWhereSQLs.length,
			filterJoin.length,
			whereWithValues.length,
			join.length,
			_or.length
		);
		if (
			pivotTableWhereSQLs.length > 0 &&
			(filterJoin.length > 0 || whereWithValues.length > 0 || join.length > 0 || _or.length > 0)
		) {
			const ptAlias = this.Alias2.next(AliasType.entity, 'pt');
			const ptSQL = `select ${fieldProps.inverseJoinColumns.join(', ')} 
					from ${fieldProps.pivotTable}
						${join.join(' \n')}
				where ${pivotTableWhereSQLs.join(' and ')}`.replaceAll(/[ \n\t]+/gi, ' ');

			const onSQL = `(${fieldProps.inverseJoinColumns
				.map((c) => ptAlias.toColumnName(c))
				.join(', ')}) in (${referenceField.primaryKeys
				.map((c) => alias.toColumnName(c))
				.join(', ')})`.replaceAll(/[ \n\t]+/gi, ' ');

			const unionAll = this.buildUnionAll(
				[alias.toColumnName('*')],
				referenceField.tableName,
				alias,
				filterJoin,
				join.concat(`inner join ${ptAlias} on ${onSQL}`),
				'',
				whereWithValues,
				_or,
				this.buildManyToManyPivotTable
			);
			const whereSQL = `(${referenceField.primaryKeys.join(', ')}) in (${ptSQL})`;
			const innerJoin = `inner join lateral (
			${
				unionAll.length > 0
					? `with ${ptAlias} as (${ptSQL}) 
						${unionAll.join(' union all ')}`
					: this.buildManyToManyPivotTable(
							[alias.toColumnName('*')],
							alias,
							referenceField.tableName,
							filterJoin,
							join,
							whereSQL,
							whereWithValues
					  )
			}
			) as ${alias} on true`.replaceAll(/[ \n\t]+/gi, ' ');

			logger.log('GQLtoSQLMapper - mapFilterManyToOne: whereSQL', alias.toString(), unionAll);

			mapping.filterJoin.push(innerJoin);
			mapping.values = { ...mapping.values, ...values };
		}
	}
	protected buildManyToManyPivotTable(
		fieldNames: string[],
		alias: Alias,
		tableName: string,
		filterJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?:
			| {
					filterJoin: string;
			  }
			| {
					where: string;
			  }
	) {
		return `select ${fieldNames.join(', ')} 
					from ${tableName} as ${alias.toString()}
						${join.join(' \n')}
						${value && 'filterJoin' in value ? value.filterJoin : ''}
						${filterJoin.join(' \n')}
				${whereSQL.length > 0 ? ` where ${whereSQL}` : ''}
				${whereWithValues.length > 0 ? ` and ${whereWithValues.join(' and ')}` : ''}
				${value && 'where' in value ? `and ${value.where}` : ''}`.replaceAll(/[ \n\t]+/gi, ' ');
	}

	protected mapFilterManyToOne<T>(
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		referenceField: EntityMetadata<unknown>,
		parentAlias: Alias,
		alias: Alias,
		whereWithValues: string[],
		join: string[],
		filterJoin: string[],
		mapping: MappingsType,
		values: Record<string, any>,
		_or: MappingsType[]
	) {
		if (fieldProps.fieldNames.length && referenceField.tableName) {
			const referenceFieldProps = referenceField.properties[
				fieldProps.mappedBy as keyof typeof referenceField.properties
			] as EntityProperty;

			const ons = referenceField.primaryKeys;
			const entityOns = fieldProps.fieldNames;

			if (ons.length !== entityOns.length) {
				throw new Error(
					`m:1 join with different number of columns ${ons.length} !== ${entityOns.length} on ${referenceFieldProps.name}`
				);
			}

			const whereSQL = entityOns
				.map((o, i) => {
					return `${parentAlias.toColumnName(o)} = ${alias.toColumnName(ons[i])}`;
				})
				.join(', ');

			logger.log('GQLtoSQLMapper - mapFilterManyToOne: whereSQL', alias.toString(), whereSQL);

			if (
				whereSQL.length > 0 &&
				(filterJoin.length > 0 || whereWithValues.length > 0 || join.length > 0 || _or.length > 0)
			) {
				const unionAll = this.buildUnionAll(
					[],
					referenceField.tableName,
					alias,
					filterJoin,
					join,
					whereSQL,
					whereWithValues,
					_or,
					this.buildManyToOneJoin
				);
				logger.log('GQLtoSQLMapper - mapFilterManyToOne: whereSQL', alias.toString(), unionAll);

				const jsonSQL = `inner join lateral (
								${
									unionAll.length > 0
										? unionAll.join(' union all ')
										: this.buildManyToOneJoin(
												[],
												alias,
												referenceField.tableName,
												filterJoin,
												join,
												whereSQL,
												whereWithValues
										  )
								}
							) as ${alias.toString()} on true`.replaceAll(/[ \n\t]+/gi, ' ');

				mapping.filterJoin.push(jsonSQL);
				mapping.values = { ...mapping.values, ...values };
			}
		}
	}
	protected buildManyToOneJoin(
		_fields: string[],
		alias: Alias,
		tableName: string,
		filterJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?:
			| {
					filterJoin: string;
			  }
			| {
					where: string;
			  }
	) {
		return `select ${alias.toColumnName('*')} 
					from "${tableName}" as ${alias}
					${filterJoin.join(' \n')}
					${join.join(' \n')}
					${value && 'filterJoin' in value ? value.filterJoin : ''}
				where ${whereSQL} 
				${whereWithValues.length > 0 ? ' and ' : ''}
				${whereWithValues.join(' and ')}
				${value && 'where' in value ? `and ${value.where}` : ''}`.replaceAll(/[ \n\t]+/gi, ' ');
	}

	protected mapFilterOneToX<T>(
		referenceField: EntityMetadata<unknown>,
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		parentAlias: Alias,
		alias: Alias,
		gqlFieldName: string,
		whereWithValues: string[],
		join: string[],
		filterJoin: string[],
		values: Record<string, any>,
		mapping: MappingsType,
		_or: MappingsType[]
	) {
		const referenceFieldProps = referenceField.properties[
			fieldProps.mappedBy as keyof typeof referenceField.properties
		] as EntityProperty;
		// logger.log('referenceFieldProps', referenceField.name, referenceFieldProps.mappedBy);
		const ons = referenceFieldProps.joinColumns;
		const entityOns = referenceFieldProps.referencedColumnNames;

		if (ons.length !== entityOns.length) {
			throw new Error(
				`1:* joins with different number of columns ${ons.length} !== ${entityOns.length} on ${referenceFieldProps.name}`
			);
		}

		const whereSQL = entityOns
			.map((o, i) => {
				return `${parentAlias.toColumnName(o)} = ${alias.toColumnName(ons[i])}`;
			})
			.join(', ');

		logger.log(
			'GQLtoSQLMapper - mapFilterOneToX',
			gqlFieldName,
			'whereSQL',
			parentAlias.toString(),
			whereSQL
		);
		// logger.log('GQLtoSQLMapper - mapFilterOneToX', gqlFieldName, join, whereWithValues, values, filterValue);

		if (
			referenceField.tableName &&
			whereSQL.length > 0 &&
			(filterJoin.length > 0 || whereWithValues.length > 0 || join.length > 0 || _or.length > 0)
		) {
			const unionAll = this.buildUnionAll(
				[],
				referenceField.tableName,
				alias,
				filterJoin,
				join,
				whereSQL,
				whereWithValues,
				_or,
				this.buildOneToXJoin
			);
			const jsonSQL = `inner join lateral (
								${
									unionAll.length > 0
										? unionAll.join(' union all ')
										: this.buildOneToXJoin(
												[],
												alias,
												referenceField.tableName,
												filterJoin,
												join,
												whereSQL,
												whereWithValues
										  )
								}
							) as ${alias.toString()} on true`.replaceAll(/[ \n\t]+/gi, ' ');

			logger.log('GQLtoSQLMapper - mapFilterOneToX', gqlFieldName, 'unionAll', unionAll);

			mapping.filterJoin.push(jsonSQL);
			mapping.values = { ...mapping.values, ...values };
		}
	}

	protected buildOneToXJoin(
		_fields: string[],
		alias: Alias,
		tableName: string,
		filterJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?:
			| {
					filterJoin: string;
			  }
			| {
					where: string;
			  }
	) {
		return `select ${alias.toColumnName('*')} 
					from "${tableName}" as ${alias}
					${filterJoin.join(' \n')}
					${join.join(' \n')}
					${value && 'filterJoin' in value ? value.filterJoin : ''}
				where ${whereSQL} 
				${whereWithValues.length > 0 ? ' and ' : ''}
				${whereWithValues.join(' and ')}
				${value && 'where' in value ? `and ${value.where}` : ''}
				`.replaceAll(/[ \n\t]+/gi, ' ');
	}

	/**
	 * Applies filter values to the query based on the provided parameters.
	 *
	 * This method handles both primitive values and filter objects, generating
	 * appropriate SQL query conditions based on the operation and value type.
	 *
	 * @template T - The type of entity being filtered
	 *
	 * @param options - Object containing filter parameters
	 * @param options.filterValue - The value to filter by, which can be a primitive or a filter object
	 * @param options.fieldOperation - The operation to apply (e.g., '_eq', '_gt', etc.). Optional for primitive values
	 * @param options.fieldName - The GraphQL field name being filtered
	 * @param options.latestAlias - The latest alias used in the SQL query
	 * @param options.mapping - The mapping configuration for the field
	 *
	 * @example
	 * // For primitive values:
	 * // { id_eq: 1 } or { id: 1 }
	 *
	 * // For filter objects:
	 * // { Id: { _eq: 1 } }
	 *
	 * @returns {void}
	 */
	protected applyFilterValue<T>({
		filterValue,
		fieldOperation,
		fieldName,
		parentAlias,
		alias,
		mapping,
	}: {
		filterValue: GQLEntityFilterInputFieldType<T>;
		fieldOperation: string & keyof typeof FieldOperations;
		fieldName: string;
		parentAlias: Alias;
		alias: Alias;
		mapping: MappingsType;
	}): void {
		if (filterValue === undefined) {
			logger.warn('GQLtoSQLMapper - applyFilterValue: filterValue is undefined', fieldName);
			return;
		}
		const filterValueIsPrimitive = isPrimitive(filterValue);

		if (filterValueIsPrimitive) {
			/**
			 * Example:
			 *
			 * `{ id_eq: 1 }`
			 *
			 * `{ id: 1 }`
			 */
			const op = fieldOperation ?? ('_eq' as keyof typeof FieldOperations);
			this.applyFilterOperation({
				fieldOperation: op as keyof typeof FieldOperations,
				filterValue,
				fieldName,
				parentAlias,
				alias,
				mapping,
			});
		} else if (!filterValueIsPrimitive && filterValue) {
			/**
			 * Example:
			 *
			 * `{ Id: { _eq: 1 } }`
			 */
			for (const op of Object.keys(FieldOperations)) {
				if (op in filterValue) {
					const filterActualValue = filterValue[op as keyof typeof filterValue] as any;
					if (filterActualValue === undefined || !isPrimitive(filterActualValue)) {
						continue;
					}
					this.applyFilterOperation({
						fieldOperation: op as string & keyof typeof FieldOperations,
						filterValue: filterActualValue,
						fieldName,
						parentAlias,
						alias,
						mapping,
					});
				}
			}
		}
	}

	/**
	 * Applies a filter operation to a field based on the provided parameters.
	 *
	 * @param options - The options for the filter operation
	 * @param options.fieldOperation - The operation to apply, must be a key of Operations or FieldOperations
	 * @param options.fieldName - The name of the field to filter on
	 * @param options.filterValue - The value to filter against, can be string, number, boolean, or bigint
	 * @param options.latestAlias - The current alias object for the table
	 * @param options.mapping - The mapping object that holds where clauses and values
	 *
	 * @protected
	 */
	protected applyFilterOperation({
		fieldOperation,
		filterValue,
		parentAlias,
		alias,
		fieldName,
		mapping,
	}: {
		fieldOperation: string & keyof typeof FieldOperations;
		fieldName: string;
		filterValue: string | number | boolean | bigint | null;
		parentAlias: Alias;
		alias: Alias;
		mapping: MappingsType;
	}) {
		const filterFieldWithAlias = `${alias.toColumnName(fieldName)}`;
		const filterParameterName = `${this.Alias2.next(AliasType.entity, fieldName).toParamName(
			fieldName
		)}`;

		const where = FieldOperations[fieldOperation](
			[filterFieldWithAlias, ':' + filterParameterName],
			['_', filterValue]
		);
		const value = { [filterParameterName]: filterValue };

		// logger.log(fieldName, 'applyFilterOperation where', where, 'values', value);
		// if (fieldOperation === '_or') {
		// 	const orMapping = newMappings(alias);
		// 	orMapping.where.push(where);
		// 	mapping._or.push(orMapping);
		// } else {
		mapping.where.push(where);
		// }
		mapping.values = { ...mapping.values, ...value };
	}
	/** 
	There is a big flaw right now regarding how we are handling these conditions.
	If we are doing an _or or a _not and we have join conditions,
	currently these conditions are probably working in _and instead.
	
	To solve this the join should be applied in `left outer`
	and the values in OR should be applied to the final `where` clause.
	*/
	protected processClassOperation<T>(
		entityMetadata: EntityMetadata<T>,
		gqlFilter: GQLEntityFilterInputFieldType<T>,
		gqlFieldNameKey: string & keyof ClassOperations,
		mappings: Map<string, MappingsType>,
		parentAlias: Alias,
		alias: Alias
	) {
		const filters = gqlFilter[gqlFieldNameKey as keyof typeof gqlFilter];
		if (typeof filters !== 'object') {
			return;
		}
		if (!mappings.has(gqlFieldNameKey)) {
			mappings.set(gqlFieldNameKey, newMappings());
		}
		const mapping = mappings.get(gqlFieldNameKey) ?? newMappings();
		mapping.alias = alias;
		this[gqlFieldNameKey]({
			entityMetadata,
			parentAlias,
			alias,
			fieldName: gqlFieldNameKey,
			gqlFilters: filters as any,
			mapping,
			mappings,
		});
	}
	_or<T>({
		entityMetadata,
		gqlFilters,
		parentAlias,
		alias,
		fieldName,
		mapping,
		mappings,
	}: ClassOperationInputType<T>) {
		// logger.info('GQLtoSQLMapper - ClassOperations: _or', fieldName, mappings);
		// this.recursiveMap({
		// 	entityMetadata,
		// 	alias,
		// gqlFilters,prefix: fieldName})

		// _or: [ { a: 1, c: 2 }, { b: 2 } ]
		// should be an array of 2 values, one for each object with each property in and with the rest of the properties of the object

		gqlFilters.forEach((filter, i) => {
			// filter = { a: 1, c: 2 }

			const newMappings = new Map<string, MappingsType>();
			Object.keys(filter).forEach((fieldName: string) => {
				if (filter[fieldName as keyof typeof filter] === undefined) {
					// skipping undefined values
					return;
				}

				logger.log(
					'2GQLtoSQLMapper - ClassOperations - _or - filter',
					fieldName,
					parentAlias.toString(),
					alias.toString()
				);
				// new mapping = [a] = 1, [c] = 2
				this.mapFilter(
					entityMetadata,
					newMappings,
					parentAlias,
					alias,
					fieldName as keyof GQLEntityFilterInputFieldType<T>,
					filter
				);

				// mapping._or.push(newMappings);
			});
			// this smells bad
			const reduced = mappingsReducer(newMappings);
			const { filterJoin, where, values } = reduced;
			logger.log(
				'GQLtoSQLMapper - new mappings',
				newMappings,
				'for',
				i,
				fieldName,
				'reduced to',
				filterJoin,
				where,
				values
			);
			// refactor this to return the values and then apply them to the mapping
			mapping._or.push(reduced);
			// mapping.alias = alias;
			mapping.values = { ...mapping.values, ...values };
		});
		logger.log('GQLtoSQLMapper - mapping', mapping._or);

		// throw new Error('sthap');
		// const recursiveFilters = this.recursiveMap({
		// 	entityMetadata,
		// 	gqlFilters,
		// 	alias,
		// });
		// const { join, filterJoin, where, values, _and, _not, _or } = mappingsReducer(recursiveFilters);
		// logger.log(
		// 	'GQLtoSQLMapper - info - ClassOperations - _or',
		// 	'join',
		// 	join,
		// 	'filterJoin',
		// 	filterJoin,
		// 	'where',
		// 	where,
		// 	'values',
		// 	values,
		// 	'_or',
		// 	_or,
		// 	'_and',
		// 	_and,
		// 	'_not',
		// 	_not
		// );
		// const newOrMappings = newMappings(alias);
		// // several options here: (not sure which is correct)
		// // LOOKS TO BE WORKING! append everything as distinct "or" in and <= applied this for now
		// // NOT TRIED YET: append all where as a single "or" in or
		// // TESTED, NOT WORKING! append all where as a single "or" in and <= IDEA IS: if there are multiple where it should be because the object have multiple values that are in AND inside an OR
		// where.length > 0 && newOrMappings.where.push(`( ${where.join(` and `)} )`);
		// newOrMappings.filterJoin.push(...filterJoin);
		// newOrMappings.join.push(...join);

		// mapping._or.push(newOrMappings);
		// // alias = alias.next();

		// logger.log(
		// 	'GQLtoSQLMapper - info - ClassOperations: processed',
		// 	fieldName,
		// 	'newOrMappings appended',
		// 	newOrMappings
		// );
		// mapping.values = { ...mapping.values, ...values };
	}
	_and<T>({
		entityMetadata,
		gqlFilters,
		parentAlias,
		alias,
		fieldName,
		mapping,
		mappings,
	}: ClassOperationInputType<T>) {
		logger.log('GQLtoSQLMapper - info - ClassOperations - gqlFilters', gqlFilters);
		const { ands, ors } = (Array.isArray(gqlFilters) ? gqlFilters : [gqlFilters]).reduce(
			(acc, f, i) => {
				const mapped = this.recursiveMap({
					entityMetadata,
					gqlFilters: [f],
					parentAlias,
					alias: this.Alias2.reset(AliasType.entity, alias.pref),
				});
				const or = mapped.get('_or');
				const newOrs = or ? [...acc.ors, or._or] : acc.ors;

				mapped.delete('_or');
				const newAnds = !or ? mappingsReducer(mapped, acc.ands) : acc.ands;
				logger.log('GQLtoSQLMapper - info - ClassOperations - mapped', i, 'or', or, 'and', newAnds);
				return {
					ors: newOrs,
					ands: newAnds,
				};
			},
			{
				ors: [],
				ands: newMappings(),
			} as {
				ors: MappingsType[][];
				ands: MappingsType;
			}
		);
		// need to convert the following
		// [['a', 'b'], ['c', 'd', 'e'], ['f','g']]
		// to this
		// [a,c,f], [a,d,f], [a,e,f],[a,c,g], [a,d,g], [a,e,g], [b,c,f], [b,d,f], [b,e,f], [b,c,g], [b,d,g], [b,e,g]
		function getCombinations(
			startMappings: MappingsType,
			matrix: MappingsType[][]
		): MappingsType[] {
			const result: MappingsType[] = [];

			function combine(current: MappingsType, depth: number) {
				// If we have reached the depth of the matrix, push the current combination to the result
				if (depth === matrix.length) {
					result.push(current);
					return;
				}

				// Iterate through each element in the current depth
				for (const obj of matrix[depth]) {
					const newOrs = {
						...obj,
						join: current.join.concat(obj.join),
						filterJoin: current.filterJoin.concat(obj.filterJoin),
						where: current.where.concat(obj.where),
						values: { ...current.values, ...obj.values },
					};

					combine(newOrs, depth + 1); // Recur to the next depth
				}
			}

			combine(startMappings, 0); // Start the recursion with an empty combination and depth 0
			return result;
		}

		const combinations = getCombinations(ands, ors);

		logger.log('GQLtoSQLMapper - info - ClassOperations - combinations', combinations);
		mapping._and.push(...combinations);
		combinations.forEach((comb) => {
			mapping.values = { ...mapping.values, ...comb.values };
		});
	}
	_not<T>({
		entityMetadata,
		gqlFilters,
		alias,
		fieldName,
		mapping,
		mappings,
	}: ClassOperationInputType<T>) {}
}
