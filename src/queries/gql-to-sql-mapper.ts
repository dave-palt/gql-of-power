import { ClassOperations, FieldOperations, Operations } from '../operations';
import {
	CustomFieldsSettings,
	EntityMetadata,
	EntityProperty,
	Fields,
	GQLEntityFilterInputFieldType,
	GQLEntityOrderByInputType,
	MappingsType,
	MetadataProvider,
	ReferenceType,
} from '../types';
import { logger } from '../variables';

export const newMappings = (latestAlias = new Alias(0, 'a')) =>
	({
		select: new Set<string>(),
		json: [] as string[],
		filterJoin: [] as string[],
		join: [] as string[],
		where: [] as string[],
		values: {} as Record<string, any>,
		orderBy: [] as GQLEntityOrderByInputType<any>[],
		latestAlias,
	} as MappingsType);

const isPrimitive = (filterValue: any): filterValue is string | number | boolean | bigint =>
	typeof filterValue === 'bigint' ||
	typeof filterValue === 'boolean' ||
	typeof filterValue === 'number' ||
	typeof filterValue === 'string' ||
	typeof filterValue === 'symbol';

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

export const mappingsReducer = (m: Map<string, MappingsType>) =>
	Array.from(m.values()).reduce(
		(
			{ select, filterJoin, json, join, where, values, limit, offset, orderBy, latestAlias },
			mapping
		) => {
			mapping.select.forEach((s) => select.add(s));
			json.push(...mapping.json);
			filterJoin.push(...mapping.filterJoin);
			join.push(...mapping.join);
			where.push(...mapping.where);
			mapping.orderBy && orderBy.push(...mapping.orderBy);
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
				latestAlias: latestAlias.update(mapping.latestAlias),
			};
		},
		newMappings(new Alias(-1))
	);

export class Alias {
	private children: Alias[] = [];
	private nextAlias: number;
	private valueAlias?: Alias;
	constructor(private alias: number, private prefix?: string, private parent?: Alias) {
		this.nextAlias = alias + 1;
	}
	private incrementNext() {
		this.nextAlias = this.alias + 1;
		this.parent?.incrementNext();
		// this.children.forEach((child) => child.incrementNext());
	}
	/**
	 *
	 * @param prefix
	 * @returns new alias with next value
	 */
	public next(prefix?: string) {
		this.parent?.incrementNext();
		const child = new Alias(this.nextAlias, prefix ?? this.prefix, this);
		this.children.push(child);
		return child;
	}
	public concat(...str: string[]) {
		return `${this.prefix ?? ''}${this.alias} - ${str.join(' ')}`;
	}
	public toString() {
		return `${this.prefix ?? ''}${this.alias}`;
	}
	public toColumnName(value: string) {
		return `${this.prefix ?? ''}${this.alias}.${value}`;
	}

	public toParamName(childAlias: string | number) {
		return `${this.prefix ?? ''}${this.alias}_${childAlias}`;
	}

	public pick(other: Alias) {
		// picking the smaller one so that we find the parent's alias, not sure it's correct
		if (this.alias < other.alias) {
			return this;
		}
		return other;
	}
	public update(other: Alias) {
		if (this.nextAlias < other.nextAlias) {
			this.nextAlias = other.nextAlias;
		}
		if (this.valueAlias && other.valueAlias) {
			// this updates the alias of the values so in case of an _or: [ id: 1, id: 2 ] we have an alias for each value
			this.valueAlias.update(other.valueAlias);
		}
		this.parent?.update(other);
		// this.children.forEach((child) => child !== other && child.update(other));
		return this;
	}

	public nextValue(prefix: string = 'v') {
		// initialise value alias with new alias or next one
		this.valueAlias =
			this.valueAlias?.next(this.toParamName(prefix)) ?? new Alias(0, this.toParamName(prefix));
		this.parent?.update(this);
		// this.children.forEach((child) => child.update(this));
		return this.valueAlias;
	}
}

export class GQLtoSQLMapper {
	private exists: MetadataProvider['exists'];
	private getMetadata: MetadataProvider['getMetadata'];
	constructor({ exists, getMetadata }: MetadataProvider) {
		this.exists = exists;
		this.getMetadata = getMetadata;
	}
	public recursiveMap = <T>({
		entityMetadata,
		fields,
		alias,
		gqlFilters,
		prefix,
		customFields,
	}: {
		entityMetadata: EntityMetadata<T>;
		fields?: Fields<T> | any;
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
				({ mappings, latestAlias }, gqlFieldNameKey) => {
					if (gqlFieldNameKey.startsWith('__')) {
						this.handleFieldArguments<T>(
							gqlFieldNameKey,
							fields,
							latestAlias,
							entityMetadata,
							mappings
						);
					} else {
						const mapping = this.getFieldMapping(mappings, gqlFieldNameKey, latestAlias);

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
								latestAlias,
								gqlFieldName,
								mappings
							);
						} else {
							this.mapField<T>(fieldProps, mapping, latestAlias, fields, gqlFieldName, primaryKeys);
						}
					}
					return { mappings, latestAlias };
				},
				{ mappings: new Map<string, MappingsType>(), latestAlias: alias }
			);

		logger.log(logPrefix, 'fields processed');
		res = (gqlFilters ?? []).reduce(
			({ mappings, latestAlias }, gqlFilter) => {
				Object.keys(gqlFilter ?? {}).forEach((gqlFieldNameKey) => {
					this.processFilterKey(
						entityMetadata,
						mappings,
						latestAlias,
						gqlFieldNameKey,
						gqlFilter,
						customFields
					);
				});
				return { mappings, latestAlias: alias.update(latestAlias) };
			},
			{ mappings: res.mappings, latestAlias: alias.update(res.latestAlias) }
		);
		logger.log(logPrefix, 'filters processed');
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
		latestAlias: Alias,
		fields: any,
		gqlFieldName: string,
		primaryKeys: string[]
	) {
		const referenceField =
			this.exists(fieldProps.type) && this.getMetadata<any, EntityMetadata<any>>(fieldProps.type);

		if (referenceField) {
			logger.log(
				'GQLtoSQLMapper - recursiveMap - referenceField latest alias',
				mapping.latestAlias.toString(),
				latestAlias.toString()
			);
			const childAlias = mapping.latestAlias.next('f');

			logger.log(
				'GQLtoSQLMapper - recursiveMap - referenceField latest alias next',
				mapping.latestAlias.toString(),
				latestAlias.toString(),
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
				latestAlias: newAlias,
			} = mappingsReducer(
				this.recursiveMap({
					entityMetadata: referenceField,
					fields: fields[gqlFieldName],
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
					latestAlias,
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
					latestAlias,
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
			this.processFieldNames(fieldProps.fieldNames, mapping, gqlFieldName);
		} else {
			logger.log('reference type', fieldProps.reference, 'not handled for field', gqlFieldName);
		}
	}

	protected handleFieldArguments<T>(
		gqlFieldNameKey: string,
		fields: any,
		latestAlias: Alias,
		entityMetadata: EntityMetadata<T>,
		mappings: Map<string, MappingsType>
	) {
		if (gqlFieldNameKey === '__arguments') {
			const __arguments = fields[gqlFieldNameKey];

			// const nextAlias = latestAlias.next();
			const m = newMappings(latestAlias);

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
						alias: m.latestAlias,
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
		childAlias: Alias,
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
				return `${mapping.latestAlias.toColumnName(o)} = ${childAlias.toColumnName(ons[i])}`;
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
			mapping.json.push(`'${gqlFieldName}', ${childAlias.toColumnName('value')}`);

			const jsonSelect = generateJsonObjectSelectStatement(
				json,
				fieldProps.reference !== ReferenceType.ONE_TO_ONE
			);

			const onFields = Array.from(
				new Set(ons.map((on) => `${childAlias.toColumnName(on)}`).concat(Array.from(select)))
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
							].fieldNames.map((fn) => `${childAlias.toColumnName(fn)} ${(ob as any)[k]}`)
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

			const fromSQL = `${orderBySQL ? '( select * from ' : ''}"${referenceField.tableName}"${
				orderBySQL ? ` as ${childAlias.toString()} ${orderBySQL} )` : ''
			}`;
			const leftOuterJoin = `left outer join lateral (
                                select ${jsonSelect} as value from (
                                    select ${onFields.join(', ')} 
                                        from ${fromSQL} as ${childAlias.toString()}
                                    ${filterJoin.join(' \n')}
                                    where ${where} 
                                    ${whereWithValues.length > 0 ? ' and ' : ''} 
                                    ${whereWithValues.join(' and ')}
                                    ${limit && !isNaN(limit) ? `limit ${limit}` : ''}
                                    ${offset && !isNaN(offset) ? `offset ${offset}` : ''}
                            ) as ${childAlias.toString()} 
                            ${join.join(' \n')}
                            ) as ${childAlias.toString()} on true`.replaceAll(/[ \n\t]+/gi, ' ');

			mapping.values = { ...mapping.values, ...values };
			mapping.join.push(leftOuterJoin);
		}
	}

	protected mapFieldManyToOne<T>(
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		referenceField: EntityMetadata<any>,
		latestAlias: Alias,
		childAlias: Alias,
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
					return `${latestAlias.toColumnName(o)} = ${childAlias.toColumnName(ons[i])}`;
				})
				.join(' and ');

			logger.log(
				'GQLtoSQLMapper - mapFieldManyToOne: whereSQL',
				referenceField.name,
				childAlias.toString(),
				mapping.latestAlias.toString(),
				latestAlias.toString(),
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
				`${fieldProps.fieldNames.map((fn) => latestAlias.toColumnName(fn)).join(', ')}`
			);
			mapping.json.push(`'${gqlFieldName}', ${childAlias.toColumnName('value')}`);

			const selectFields = [
				...new Set(ons.map((on) => childAlias.toColumnName(on)).concat(Array.from(select))),
			];

			const jsonSQL = generateJsonObjectSelectStatement(json);

			const leftOuterJoin = `left outer join lateral (
                                select ${jsonSQL} as value from (
                                    select ${selectFields.join(', ')} from "${
				referenceField.tableName
			}" as ${childAlias.toString()}
                                    where ${where}
									${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
                            ) as ${childAlias.toString()}
                            ${join.join(' \n')}
                            ) as ${childAlias.toString()} on true`.replaceAll(/[ \n\t]+/gi, ' ');

			mapping.join.push(leftOuterJoin);
			mapping.values = { ...mapping.values, ...values };
		}
	}

	protected mapFieldManyToMany<T>(
		referenceField: EntityMetadata<any>,
		primaryKeys: string[],
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		latestAlias: Alias,
		childAlias: Alias,
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
			return `${latestAlias.toColumnName(o)} = ${fieldProps.pivotTable}.${ons[i]}`;
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

			const refAlias = childAlias.toString();
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
												.map((column) => `${childAlias.toColumnName(column)} ${o[column]}`)
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

			mapping.json.push(`'${gqlFieldName}', ${childAlias.toColumnName('value')}`);
			mapping.join.push(leftOuterJoin);
			mapping.values = { ...mapping.values, ...values };
		} else {
			mapping.json.push(`'${gqlFieldName}', null`);
		}
	}

	private getFieldMapping(
		mappings: Map<string, MappingsType>,
		gqlFieldNameKey: string,
		latestAlias: Alias
	) {
		const m = mappings.get(gqlFieldNameKey);
		if (m) {
			m.latestAlias.update(latestAlias);
			return m;
		}
		const newMapping = newMappings(latestAlias);
		mappings.set(gqlFieldNameKey, newMapping);
		return newMapping;
	}

	protected processFieldNames(fieldNames: string[], mapping: MappingsType, gqlFieldName: string) {
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

		const fieldNameWithAlias = mapping.latestAlias.toColumnName(fieldNames[0]);

		mapping.select.add(fieldNameWithAlias);
		mapping.json.push(`'${gqlFieldName}', ${fieldNameWithAlias}`);
	}

	protected processFilterKey<T>(
		entityMetadata: EntityMetadata<T>,
		mappings: Map<string, MappingsType>,
		latestAlias: Alias,
		gqlFieldNameKey: string,
		gqlFilter: GQLEntityFilterInputFieldType<T>,
		customFields?: CustomFieldsSettings<T>
	) {
		const { properties, primaryKeys } = entityMetadata;
		if (gqlFieldNameKey === '_and' || gqlFieldNameKey === '_or' || gqlFieldNameKey === '_not') {
			logger.log(
				'GQLtoSQLMapper - ClassOperations: processing initial if',
				gqlFieldNameKey,
				gqlFilter
			);
			this.processClassOperation(entityMetadata, gqlFilter, gqlFieldNameKey, mappings, latestAlias);
			return;
		}
		const filterValue = gqlFilter[gqlFieldNameKey as keyof GQLEntityFilterInputFieldType<T>] as
			| GQLEntityFilterInputFieldType<T>
			| string
			| number
			| boolean;
		logger.log('GQLtoSQLMapper - processing key', gqlFieldNameKey, 'value', filterValue);

		// id_in, id_eq, id_ne, id_gt, id_gte, id_lt, id_lte, etc...
		const fieldOperation = Object.keys(FieldOperations).find((k) => gqlFieldNameKey.endsWith(k));
		if (fieldOperation) {
			// { id_eq: 1 }
			this.mapFieldOperation<T>(
				mappings,
				gqlFieldNameKey,
				latestAlias,
				fieldOperation,
				filterValue as any,
				properties
			);
			logger.log(
				'GQLtoSQLMapper - FieldOperation: processed',
				gqlFieldNameKey,
				fieldOperation,
				'filterValue',
				filterValue,
				'latestAlias',
				latestAlias.toString(),
				'mapping',
				mappings.get(gqlFieldNameKey)
			);
		} else {
			// this one should be covered above
			// if (gqlFieldNameKey in ClassOperations) {
			// 	logger.log(
			// 		'GQLtoSQLMapper - ClassOperations: processing inside else',
			// 		gqlFieldNameKey,
			// 		gqlFilter
			// 	);
			// 	const childAlias = latestAlias.next();

			// 	const whereOperationFilterValue = gqlFilter[
			// 		gqlFieldNameKey as keyof GQLEntityFilterInputFieldType<T>
			// 	] as GQLEntityFilterInputFieldType<T>[];
			// 	const {
			// 		join,
			// 		where: w,
			// 		values,
			// 	} = mappingsReducer(
			// 		this.recursiveMap<T>({
			// 			entityMetadata,
			// 			fields: [],
			// 			alias: childAlias,
			// 			gqlFilters: whereOperationFilterValue,
			// 			customFields,
			// 		})
			// 	);

			// 	if (!mappings.has(gqlFieldNameKey)) {
			// 		mappings.set(gqlFieldNameKey, newMappings(latestAlias));
			// 	}
			// 	const mapping = mappings.get(gqlFieldNameKey) ?? newMappings(latestAlias);

			// 	mapping.filterJoin.push(...join);
			// 	mapping.where.push(
			// 		`( ${ClassOperations[gqlFieldNameKey as keyof typeof ClassOperations](w, [
			// 			'',
			// 			...w,
			// 		])} )`
			// 	);
			// 	mapping.values = { ...mapping.values, ...values };

			// 	return;
			// }

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

			logger.log(
				'GQLtoSQLMapper field ==>',
				gqlFieldNameKey,
				'fieldNameKey',
				fieldNameKey,
				'property',
				properties[gqlFieldNameKey as keyof EntityMetadata<T>['properties']],
				'property of lowercased',
				properties[lowercasedFirstFieldNameKey as keyof EntityMetadata<T>['properties']]
			);

			if (!fieldNameKey) {
				logger.log(
					latestAlias.toString(),
					gqlFieldName,
					'not found in properties nor in customFields'
				);
				throw new Error(
					`${latestAlias.toString()} ${gqlFieldName} not found in properties nor in customFields`
				);
			}

			const mapping = this.getChildAliasMapping(mappings, fieldNameKey, latestAlias);

			const referenceField = this.exists(fieldProps.type) && this.getMetadata(fieldProps.type);

			if (referenceField) {
				const childAlias = mapping.latestAlias.next('w');

				// const refAlias = `${fieldPrefix ?? ''}_${alias}_${fieldPrefix}`;
				logger.log('referenceField', referenceField.name, fieldProps.reference);

				const {
					join,
					where: whereWithValues,
					values,
					filterJoin,
				} = mappingsReducer(
					this.recursiveMap({
						entityMetadata: referenceField,
						alias: childAlias,
						gqlFilters: [filterValue],
					})
				);
				if (
					fieldProps.reference === ReferenceType.ONE_TO_MANY ||
					fieldProps.reference === ReferenceType.ONE_TO_ONE
				) {
					this.mapFilterOneToX<T>(
						referenceField,
						fieldProps,
						latestAlias,
						childAlias,
						gqlFieldName,
						whereWithValues,
						join,
						filterJoin,
						values,
						filterValue,
						mapping
					);
				} else if (fieldProps.reference === ReferenceType.MANY_TO_ONE) {
					this.mapFilterManyToOne<T>(
						fieldProps,
						referenceField,
						latestAlias,
						childAlias,
						whereWithValues,
						join,
						filterJoin,
						mapping,
						values
					);
				} else if (fieldProps.reference === ReferenceType.MANY_TO_MANY) {
					this.mapFilterManyToMany<T>(
						fieldProps,
						primaryKeys,
						referenceField,
						latestAlias,
						whereWithValues,
						join,
						filterJoin,
						childAlias,
						mapping,
						values
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
					this.applyFilterValue<T>({
						filterValue,
						fieldOperation: '_eq',
						fieldName,
						latestAlias,
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
					latestAlias.toString(),
					'mapping',
					mapping
				);
			}

			latestAlias.update(mapping.latestAlias);
		}
	}
	protected getChildAliasMapping(
		mappings: Map<string, MappingsType>,
		fieldNameKey: string,
		latestAlias: Alias
	) {
		const m = mappings.get(fieldNameKey);
		if (m) {
			m.latestAlias.update(latestAlias);
			return m;
		}

		const childAlias = latestAlias.next();
		const mapping = newMappings(childAlias);
		mappings.set(fieldNameKey, mapping);
		return mapping;
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
		gqlFieldNameKey: string & keyof typeof ClassOperations,
		mappings: Map<string, MappingsType>,
		latestAlias: Alias
	) {
		const filters = gqlFilter[gqlFieldNameKey];
		if (typeof filters !== 'object') {
			return;
		}
		if (!mappings.has(gqlFieldNameKey)) {
			mappings.set(gqlFieldNameKey, newMappings(latestAlias));
		}
		const mapping = mappings.get(gqlFieldNameKey) ?? newMappings(latestAlias);

		const { join, filterJoin, where, values } = mappingsReducer(
			this.recursiveMap({
				entityMetadata,
				gqlFilters: filters,
				alias: latestAlias,
			})
		);

		logger.log(
			'GQLtoSQLMapper - ClassOperations: processed',
			gqlFieldNameKey,
			'join',
			join,
			'filterJoin',
			filterJoin,
			'where',
			where,
			'values',
			values
		);
		mapping.filterJoin.push(...filterJoin);
		mapping.join.push(...join);
		where.length > 0 && mapping.where.push(`( ${where.join(` ${gqlFieldNameKey.slice(1)} `)} )`);
		mapping.values = { ...mapping.values, ...values };
	}

	protected mapFieldOperation<T>(
		mappings: Map<string, MappingsType>,
		gqlFieldNameKey: string,
		latestAlias: Alias,
		fieldOperation: string,
		fieldValue: any,
		properties: { [key in string & keyof T]: EntityProperty }
	) {
		const exists = mappings.has(gqlFieldNameKey);
		if (!exists) {
			// const childAlias = latestAlias.next();
			mappings.set(gqlFieldNameKey, newMappings(latestAlias));
		}
		const mapping = mappings.get(gqlFieldNameKey) ?? newMappings(latestAlias);

		const fieldNameBeforeOperation = gqlFieldNameKey.slice(0, -fieldOperation.length);
		// const fieldValue = gqlFilter[gqlFieldNameKey as keyof GQLEntityFilterInputFieldType<T>] as any;

		// const sqlParam = `op${mapping.latestAlias.toString()}`;
		const nextValue = mapping.latestAlias.nextValue('op');
		if (
			fieldValue instanceof Array &&
			fieldNameBeforeOperation in properties &&
			(fieldOperation as keyof typeof FieldOperations) !== '_in' &&
			(fieldOperation as keyof typeof FieldOperations) !== '_nin'
			// (fieldOperation as keyof typeof FieldOperations) !== '_between' &&
		) {
			mapping.where.push(
				...properties[fieldNameBeforeOperation as keyof typeof properties].fieldNames.map(
					(fieldName, i) => {
						const nextValueSQL = nextValue.next();
						const values = fieldValue.map(
							(fv, i) => {
								const nextValueAlias = nextValueSQL.nextValue();
								mapping.values[nextValueAlias.toParamName(i)] = fv;
								return ':' + nextValueAlias.toParamName(i);
							},
							{
								keys: [] as string[],
								values: [] as any[],
							}
						);

						return FieldOperations[fieldOperation as keyof typeof FieldOperations](
							[mapping.latestAlias.toColumnName(fieldName), ...values],
							['', ...fieldValue]
						);
					}
				)
			);
		} else {
			logger.log(
				'GQLtoSQLMapper - mapFieldOperation: fieldValue',
				fieldValue,
				'fieldNameBeforeOperation',
				fieldNameBeforeOperation,
				'property',
				(properties as any)?.[fieldNameBeforeOperation as keyof typeof properties]
			);
			const fieldNames =
				properties[fieldNameBeforeOperation as keyof typeof properties]?.fieldNames;
			if (!fieldNames) {
				throw new Error('fieldNames not found in properties for field ' + fieldNameBeforeOperation);
			}
			mapping.where.push(
				...fieldNames.map((fieldName) =>
					FieldOperations[fieldOperation as keyof typeof FieldOperations](
						[mapping.latestAlias.toColumnName(fieldName), `:${nextValue.toParamName(1)}`],
						['', fieldValue]
					)
				)
			);
			mapping.values[nextValue.toParamName(1)] = fieldValue;
		}
	}

	protected mapFilterManyToMany<T>(
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		primaryKeys: string[],
		referenceField: EntityMetadata<unknown>,
		parentAlias: Alias,
		whereWithValues: string[],
		join: string[],
		filterJoin: string[],
		alias: Alias,
		mapping: MappingsType,
		values: Record<string, any>
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
		if (
			pivotTableWhereSQL.length > 0 &&
			(filterJoin.length > 0 || whereWithValues.length > 0 || join.length > 0)
		) {
			const pivotTableSQL = `select ${fieldProps.inverseJoinColumns.join(', ')} 
									from ${fieldProps.pivotTable}
                                        ${join.join(' \n')}
									where ${pivotTableWhereSQL.join(' and ')} 
									${whereWithValues.length > 0 ? ` and ${whereWithValues.join(' and ')}` : ''}`.replaceAll(
				/[ \n\t]+/gi,
				' '
			);

			const innerJoin = `inner join lateral (
		                        select ${alias.toColumnName('*')}
		                            from "${referenceField.tableName}" as ${alias.toString()}
                                    where (${referenceField.primaryKeys.join(', ')}) 
										in (${pivotTableSQL})
									${filterJoin.join(' \n')}
		                ) as ${alias.toString()} on true`.replaceAll(/[ \n\t]+/gi, ' ');

			mapping.filterJoin.push(innerJoin);
			mapping.values = { ...mapping.values, ...values };
		}
	}

	protected mapFilterManyToOne<T>(
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		referenceField: EntityMetadata<unknown>,
		alias: Alias,
		refAlias: Alias,
		whereWithValues: string[],
		join: string[],
		filterJoin: string[],
		mapping: MappingsType,
		values: Record<string, any>
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
					return `${alias.toColumnName(o)} = ${refAlias.toColumnName(ons[i])}`;
				})
				.join(', ');

			logger.log('GQLtoSQLMapper - mapFilterManyToOne: whereSQL', alias.toString(), whereSQL);
			// logger.log('========filterJoin', filterJoin);

			if (
				whereSQL.length > 0 &&
				(filterJoin.length > 0 || whereWithValues.length > 0 || join.length > 0)
			) {
				const innerJoin = `inner join lateral (
                                select ${refAlias.toColumnName('*')} from "${
					referenceField.tableName
				}" as ${refAlias.toString()}
									${filterJoin.join(' \n')}
                                    ${join.join(' \n')}
                                where ${whereSQL} 
								${whereWithValues.length > 0 ? `and ${whereWithValues.join(' and ')}` : ''}
		                    ) as ${refAlias.toString()} on true`.replaceAll(/[ \n\t]+/gi, ' ');
				mapping.filterJoin.push(innerJoin);
				mapping.values = { ...mapping.values, ...values };
			}
		}
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
		filterValue: string | number | boolean | GQLEntityFilterInputFieldType<T>,
		mapping: MappingsType
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

		logger.log('GQLtoSQLMapper - mapFilterManyToX: whereSQL', parentAlias.toString(), whereSQL);
		logger.log('======>referenceField', gqlFieldName, join, whereWithValues, values, filterValue);

		if (
			referenceField.tableName &&
			whereSQL.length > 0 &&
			(filterJoin.length > 0 || whereWithValues.length > 0 || join.length > 0)
		) {
			// apply a filter join only if either we filter for or we have a join
			const innerJoin = `inner join lateral (
                                select ${alias.toColumnName('*')} 
                                    from "${referenceField.tableName}" as ${alias}
									${filterJoin.join(' \n')}
                                    ${join.join(' \n')}
                                where ${whereSQL} 
                                ${whereWithValues.length > 0 ? ' and ' : ''}
                                ${whereWithValues.join(' and ')}
		                    ) as ${alias.toString()} on true`.replaceAll(/[ \n\t]+/gi, ' ');

			mapping.filterJoin.push(innerJoin);
			mapping.values = { ...mapping.values, ...values };
		}
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
		latestAlias,
		mapping,
	}: {
		filterValue: string | number | boolean | GQLEntityFilterInputFieldType<T>;
		fieldOperation: string & keyof typeof FieldOperations;
		fieldName: string;
		latestAlias: Alias;
		mapping: MappingsType;
	}): void {
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
				latestAlias,
				mapping,
			});
		} else if (!filterValueIsPrimitive) {
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
						latestAlias,
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
		latestAlias,
		fieldName,
		mapping,
	}: {
		fieldOperation: (string & keyof typeof Operations) | (string & keyof typeof FieldOperations);
		fieldName: string;
		filterValue: string | number | boolean | bigint;
		latestAlias: Alias;
		mapping: MappingsType;
	}) {
		const filterFieldWithAlias = `${latestAlias.toString()}.${fieldName}`;
		const filterParameterName = `${latestAlias.nextValue()}_${fieldName}`;

		const where = Operations[fieldOperation](
			[filterFieldWithAlias, ':' + filterParameterName],
			['_', filterValue]
		);
		const value = { [filterParameterName]: filterValue };

		logger.log(fieldName, 'applyFilterOperation where', where, 'values', value);
		mapping.where.push(where);
		mapping.values = { ...mapping.values, ...value };
	}
}
