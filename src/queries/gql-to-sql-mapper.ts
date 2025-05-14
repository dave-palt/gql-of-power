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
	private child?: Alias;
	private nextAlias: number;
	private valueAlias?: Alias;
	constructor(private alias: number, private prefix?: string, private parent?: Alias) {
		this.nextAlias = alias + 1;
	}
	private incrementNext() {
		this.nextAlias = this.alias + 1;
		this.parent?.incrementNext();
		// this.child?.incrementNext();
	}
	/**
	 *
	 * @param prefix
	 * @returns new alias with next value
	 */
	public next(prefix?: string) {
		this.parent?.incrementNext();
		const child = new Alias(this.nextAlias, prefix ?? this.prefix, this);
		this.child = child;
		return child;
	}
	public toString() {
		return `${this.prefix ?? ''}${this.alias}`;
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
		return this;
	}

	public nextValue() {
		// initialise value alias with new alias or next one
		this.valueAlias = this.valueAlias?.next() ?? new Alias(0, 'v');
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
		logger.log('');
		logger.log('');
		logger.log('');
		logger.log('==>>> recursiveMap startAlias', alias.toString());
		const { properties, primaryKeys } = entityMetadata;

		let res = [...new Set(Object.keys(fields ?? {}))].reduce(
			({ mappings, latestAlias }, gqlFieldNameKey, i) => {
				// const fieldPrefix = `${prefix ?? ''}_${i}`;
				if (gqlFieldNameKey.startsWith('__')) {
					if (gqlFieldNameKey === '__arguments') {
						const __arguments = fields[gqlFieldNameKey];

						// const nextAlias = latestAlias.next();
						const m = newMappings(latestAlias);

						const filter = __arguments.find((a: any) => a?.filter)?.filter?.value;
						const pagination = __arguments.find((a: any) => a?.pagination)?.pagination?.value;

						logger.log(
							'__arguments ====> ',
							__arguments,
							'filter',
							filter,
							'pagination',
							pagination
						);

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
							m.orderBy = pagination?.orderBy;
						} else {
							// m.__arguments = __arguments;
						}
						mappings.set(gqlFieldNameKey, m);
					}
					return { mappings, latestAlias };
				}
				if (!mappings.has(gqlFieldNameKey)) {
					// const nextAlias = latestAlias.next();
					mappings.set(gqlFieldNameKey, newMappings(latestAlias));
				}
				const mapping = mappings.get(gqlFieldNameKey) ?? newMappings(latestAlias.next());

				const customFieldProps = customFields?.[gqlFieldNameKey as keyof CustomFieldsSettings<T>];

				const fieldProps =
					properties[gqlFieldNameKey as keyof EntityMetadata<T>['properties']] ??
					properties[customFieldProps?.requires as keyof EntityMetadata<T>['properties']];

				const gqlFieldName = (customFieldProps?.requires as string) ?? gqlFieldNameKey;
				logger.log('=> recursiveMap fields, gqlFieldName', gqlFieldName);

				if (!fieldProps) {
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
				const referenceField =
					this.exists(fieldProps.type) &&
					this.getMetadata<any, EntityMetadata<any>>(fieldProps.type);

				// logger.log(gqlFieldName, 'fieldNames', fieldProps.fieldNames);

				const uniqueFieldNames = (fieldProps.fieldNames ?? []).map(
					(f) => `${mapping.latestAlias}.${f}`
				);

				if (referenceField) {
					console.log(
						'referenceField latest alias',
						mapping.latestAlias.toString(),
						latestAlias.toString()
					);
					mapping.latestAlias = mapping.latestAlias.next('f');
					console.log(
						'referenceField latest alias next',
						mapping.latestAlias.toString(),
						latestAlias.toString()
					);
					// const refAlias = `${fieldPrefix}_${alias}_${i}`;
					const alias = latestAlias.toString();
					const childAlias = mapping.latestAlias;
					const refAlias = childAlias.toString();
					// logger.log('referenceField', referenceField.name, fieldProps.reference);

					if (
						fieldProps.reference === ReferenceType.ONE_TO_MANY ||
						fieldProps.reference === ReferenceType.ONE_TO_ONE
					) {
						const referenceFieldProps = referenceField.properties[
							fieldProps.mappedBy as keyof typeof referenceField.properties
						] as EntityProperty;
						// logger.log('referenceFieldProps', referenceField.name, referenceFieldProps.mappedBy);

						const ons = referenceFieldProps.joinColumns;
						const entityOns = referenceFieldProps.referencedColumnNames;

						if (ons.length !== entityOns.length) {
							throw new Error(
								`joins with different number of columns ${ons.length} !== ${entityOns.length} on ${referenceFieldProps.name}. Entity: ${referenceField.name}, Table: ${referenceField.tableName}`
							);
						}

						const where = entityOns
							.map((o, i) => {
								return `${alias}.${o} = ${refAlias}.${ons[i]}`;
							})
							.join(', ');

						const {
							select,
							json,
							join,
							filterJoin,
							where: fieldWhere,
							values: fieldWhereValues,
							limit,
							offset,
							orderBy,
							// latestAlias: childAlias,
						} = mappingsReducer(
							this.recursiveMap({
								entityMetadata: referenceField,
								fields: fields[gqlFieldName],
								alias: childAlias,
							})
						);

						logger.log(
							'recursiveMap - referenceField',
							referenceField.name,
							'where',
							fieldWhere,
							'values',
							fieldWhereValues,
							'limit',
							limit,
							'offset',
							offset,
							'orderBy',
							orderBy
						);
						if (referenceField.tableName && where.length > 0) {
							mapping.json.push(`'${gqlFieldName}', ${refAlias}.value`);

							const jsonSelect =
								fieldProps.reference === ReferenceType.ONE_TO_ONE
									? `jsonb_build_object(${json.join(', ')})`
									: `coalesce(json_agg(jsonb_build_object(${json.join(', ')})), '[]'::json)`;

							const onFields = Array.from(
								new Set(ons.map((on) => `${refAlias}.${on}`).concat(Array.from(select)))
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
											].fieldNames.map((fn) => `${refAlias}.${fn} ${(ob as any)[k]}`)
										);
									}
								});
								return acc;
							}, [] as string[]);

							logger.log(
								'many to one',
								referenceField.name,
								'filterJoin',
								filterJoin,
								'fieldWhere',
								fieldWhere,
								'fieldWhereValues',
								fieldWhereValues,
								limit,
								offset
							);
							const orderBySQL =
								processedOrderBy.length > 0 ? ` order by ${processedOrderBy.join(', ')} ` : '';

							const fromSQL = `${orderBySQL ? '( select * from ' : ''}${referenceField.tableName}${
								orderBySQL ? ` as ${refAlias} ${orderBySQL} )` : ''
							}`;
							const leftOuterJoin = `left outer join lateral (
                                select ${jsonSelect} as value from (
                                    select ${onFields.join(', ')} 
                                        from ${fromSQL} as ${refAlias}
                                    ${filterJoin.join(' \n')}
                                    where ${where}
                                    ${fieldWhere.length > 0 ? ' and ' : ''} 
                                    ${fieldWhere.join(' and ')}
                                    ${limit && !isNaN(limit) ? `limit ${limit}` : ''}
                                    ${offset && !isNaN(offset) ? `offset ${offset}` : ''}
                            ) as ${refAlias} 
                            ${join.join(' \n')}
                            ) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, ' ');

							mapping.values = { ...mapping.values, ...fieldWhereValues };
							mapping.join.push(leftOuterJoin);
						}
					} else if (fieldProps.reference === ReferenceType.MANY_TO_ONE) {
						const alias = latestAlias.toString();
						const childAlias = mapping.latestAlias;
						const refAlias = childAlias.toString();

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
									return `${alias}.${o} = ${refAlias}.${ons[i]}`;
								})
								.join(', ');

							const {
								select,
								json,
								join,
								where: w,
								values,
								filterJoin,
								limit,
								offset,
							} = mappingsReducer(
								this.recursiveMap({
									entityMetadata: referenceField,
									fields: fields[gqlFieldName],
									alias: childAlias,
								})
							);

							logger.log(
								'many to one',
								referenceField.name,
								'where',
								w,
								'values',
								values,
								'filterJoin',
								filterJoin,
								limit,
								offset
							);

							mapping.select.add(
								`${fieldProps.fieldNames.map((fn) => `${alias}.${fn}`).join(', ')}`
							);
							mapping.json.push(`'${gqlFieldName}', ${refAlias}.value`);

							const selectFields = [
								...new Set(ons.map((on) => `${refAlias}.${on}`).concat(Array.from(select))),
							];
							const leftOuterJoin = `left outer join lateral (
                                select jsonb_build_object(${json.join(', ')}) as value from (
                                    select ${selectFields.join(', ')} from ${
								referenceField.tableName
							} as ${refAlias}
                                    where ${where}
									${w.length > 0 ? ` and ( ${w.join(' and ')} )` : ''}
                            ) as ${refAlias}
                            ${join.join(' \n')}
                            ) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, ' ');

							mapping.join.push(leftOuterJoin);
							mapping.values = { ...mapping.values, ...values };
						}
					} else if (fieldProps.reference === ReferenceType.MANY_TO_MANY) {
						const alias = latestAlias.toString();
						const childAlias = mapping.latestAlias;
						const refAlias = childAlias.toString();

						const ons = referenceField.primaryKeys;

						const {
							select,
							json,
							join,
							where: w,
							values,
						} = mappingsReducer(
							this.recursiveMap({
								entityMetadata: referenceField,
								fields: fields[gqlFieldName],
								alias: childAlias,
							})
						);

						const where = primaryKeys.map((o, i) => {
							return `${alias}.${o} = ${fieldProps.joinColumns[i]}`;
						});

						mapping.json.push(`'${gqlFieldName}', ${refAlias}.value`);

						const selectFields = [
							...new Set(ons.map((on) => `${refAlias}.${on}`).concat(Array.from(select))),
						];
						const leftOuterJoin = `left outer join lateral (
                            select coalesce(json_agg(jsonb_build_object(${json.join(
															', '
														)})), '[]'::json) as value from (
                                select ${selectFields.join(', ')} 
                                    from ${referenceField.tableName} 
                                where (${referenceField.primaryKeys.join(', ')}) in (
                                    select ${fieldProps.inverseJoinColumns.join(', ')} 
                                        from ${fieldProps.pivotTable}
										${w.length > 0 ? ` and ( ${w.join(' and ')} )` : ''}
                                    where ${where}
                                )
                        ) as ${refAlias}
                        ${join.join(' \n')}
                        ) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, ' ');

						mapping.join.push(leftOuterJoin);
						mapping.values = { ...mapping.values, ...values };
					} else {
						logger.log(
							'reference type',
							fieldProps.reference,
							'not handled for field',
							gqlFieldName,
							'with referenceField'
						);
					}

					return { mappings, latestAlias: latestAlias.update(mapping.latestAlias) };
				} else if (uniqueFieldNames.length > 0) {
					uniqueFieldNames.forEach((f) => mapping.select.add(f));
					mapping.json.push(`'${gqlFieldName}', ${uniqueFieldNames.join(', ')}`);
				} else {
					logger.log('reference type', fieldProps.reference, 'not handled for field', gqlFieldName);
				}
				return { mappings, latestAlias };
			},
			{ mappings: new Map<string, MappingsType>(), latestAlias: alias }
		);

		logger.log(
			'==>>> recursiveMap fields processed!! processing gql filters',
			res.latestAlias.toString(),
			typeof gqlFilters,
			typeof gqlFilters?.reduce
		);
		res = (gqlFilters ?? []).reduce(
			({ mappings, latestAlias }, gqlFilter) => {
				// logger.log('recursiveMap - gqlFilter PARENT', gqlFilter);
				Object.keys(gqlFilter).forEach((gqlFieldNameKey) => {
					if (
						gqlFieldNameKey === '_and' ||
						gqlFieldNameKey === '_or' ||
						gqlFieldNameKey === '_not'
					) {
						const filters = gqlFilter[gqlFieldNameKey];
						if (typeof filters !== 'object') {
							return;
						}
						if (!mappings.has(gqlFieldNameKey)) {
							mappings.set(gqlFieldNameKey, newMappings(latestAlias));
						}
						const mapping = mappings.get(gqlFieldNameKey) ?? newMappings(latestAlias);
						const mapped = this.recursiveMap({
							entityMetadata,
							gqlFilters: filters,
							alias: latestAlias,
						});
						mapped.forEach((m) => console.log('mapped', m.values, 'for filters', filters));
						const { join, filterJoin, where: w, values } = mappingsReducer(mapped);
						mapping.filterJoin.push(...filterJoin);
						mapping.join.push(...join);
						mapping.where.push(`( ${w.join(` ${gqlFieldNameKey.slice(1)} `)} )`);
						mapping.values = { ...mapping.values, ...values };
						return;
					}
					// const fieldPrefix = `${prefix ?? ''}_${filterIndex}_${fieldIndex}`;
					// logger.log('recursiveMap - gqlFilter', gqlFilter, gqlFieldNameKey, fieldPrefix);

					// id_in, id_eq, id_ne, id_gt, id_gte, id_lt, id_lte, etc...
					const fieldOperation = Object.keys(FieldOperations).find((k) =>
						gqlFieldNameKey.endsWith(k)
					);
					logger.log('=>>>>>>field', gqlFieldNameKey);
					if (fieldOperation) {
						const exists = mappings.has(gqlFieldNameKey);
						if (!exists) {
							// const childAlias = latestAlias.next();
							mappings.set(gqlFieldNameKey, newMappings(latestAlias));
						}
						const mapping = mappings.get(gqlFieldNameKey) ?? newMappings();

						const fieldNameBeforeOperation = gqlFieldNameKey.slice(0, -fieldOperation.length);
						const fieldValue = gqlFilter[
							gqlFieldNameKey as keyof GQLEntityFilterInputFieldType<T>
						] as any;

						const sqlParam = `op${mapping.latestAlias}`;
						if (fieldValue instanceof Array && fieldNameBeforeOperation in properties) {
							mapping.where.push(
								...properties[fieldNameBeforeOperation as keyof typeof properties].fieldNames.map(
									(fieldName) =>
										FieldOperations[fieldOperation as keyof typeof FieldOperations](
											[fieldName, ...fieldValue.map((_, i) => `:${sqlParam}_${i}`)],
											['', ...fieldValue.map((_, i) => `:${sqlParam}_${i}`)]
										)
								)
							);
							mapping.values = {
								...mapping.values,
								...fieldValue.reduce((acc, v, i) => {
									acc[`${sqlParam}_${i}`] = v;
									return acc;
								}, {} as Record<string, any>),
							};
						} else {
							logger.log(
								'fieldValue',
								fieldValue,
								'fieldNameBeforeOperation',
								fieldNameBeforeOperation,
								'property',
								(properties as any)?.[fieldNameBeforeOperation as keyof typeof properties]
							);
							const fieldNames =
								properties[fieldNameBeforeOperation as keyof typeof properties]?.fieldNames;
							if (!fieldNames) {
								throw new Error(
									'fieldNames not found in properties for field ' + fieldNameBeforeOperation
								);
							}
							mapping.where.push(
								...fieldNames.map((fieldName) =>
									FieldOperations[fieldOperation as keyof typeof FieldOperations](
										[fieldName, `:${sqlParam}`],
										['', fieldValue]
									)
								)
							);
							mapping.values = {
								...mapping.values,
								[sqlParam]: fieldValue,
							};
						}
						return;
					}

					const filterValue = gqlFilter[
						gqlFieldNameKey as keyof GQLEntityFilterInputFieldType<T>
					] as GQLEntityFilterInputFieldType<T> | string | number | boolean;

					if (gqlFieldNameKey in ClassOperations || fieldOperation) {
						const childAlias = latestAlias.next();

						const whereOperationFilterValue = gqlFilter[
							gqlFieldNameKey as keyof GQLEntityFilterInputFieldType<T>
						] as GQLEntityFilterInputFieldType<T>[];
						const {
							join,
							where: w,
							values,
						} = mappingsReducer(
							this.recursiveMap<T>({
								entityMetadata,
								fields: [],
								alias: childAlias,
								gqlFilters: whereOperationFilterValue,
								customFields,
							})
						);

						if (!mappings.has(gqlFieldNameKey)) {
							mappings.set(gqlFieldNameKey, newMappings(latestAlias));
						}
						const mapping = mappings.get(gqlFieldNameKey) ?? newMappings(latestAlias);

						mapping.filterJoin.push(...join);
						mapping.where.push(
							`( ${ClassOperations[gqlFieldNameKey as keyof typeof ClassOperations](w, [
								'',
								...w,
							])} )`
						);
						mapping.values = { ...mapping.values, ...values };

						return;
					}

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

					logger.log('this ==>', gqlFieldNameKey, 'fieldNameKey', fieldNameKey);

					if (!fieldNameKey) {
						logger.log(
							latestAlias.toString(),
							gqlFieldName,
							'not found in properties nor in customFields'
						);
						throw new Error(
							`${latestAlias.toString()} ${gqlFieldName} not found in properties nor in customFields`
						);
						return;
					}

					if (!mappings.has(fieldNameKey)) {
						const childAlias = latestAlias.next();
						mappings.set(fieldNameKey, newMappings(childAlias));
					}
					const mapping = mappings.get(fieldNameKey) ?? newMappings();
					const referenceField = this.exists(fieldProps.type) && this.getMetadata(fieldProps.type);

					if (referenceField) {
						const alias = latestAlias.toString();
						const childAlias = mapping.latestAlias;
						const refAlias = childAlias.toString();

						// const refAlias = `${fieldPrefix ?? ''}_${alias}_${fieldPrefix}`;
						logger.log('referenceField', referenceField.name, fieldProps.reference);

						if (
							fieldProps.reference === ReferenceType.ONE_TO_MANY ||
							fieldProps.reference === ReferenceType.ONE_TO_ONE
						) {
							const referenceFieldProps = referenceField.properties[
								fieldProps.mappedBy as keyof typeof referenceField.properties
							] as EntityProperty;
							// logger.log('referenceFieldProps', referenceField.name, referenceFieldProps.mappedBy);

							const ons = referenceFieldProps.joinColumns;
							const entityOns = referenceFieldProps.referencedColumnNames;

							if (ons.length !== entityOns.length) {
								throw new Error(
									`joins with different number of columns ${ons.length} !== ${entityOns.length} on ${referenceFieldProps.name}`
								);
							}

							const onSQL = entityOns
								.map((o, i) => {
									return `${alias}.${o} = ${refAlias}.${ons[i]}`;
								})
								.join(', ');

							const { join, where, values } = mappingsReducer(
								this.recursiveMap({
									entityMetadata: referenceField,
									alias: childAlias,
									gqlFilters: [filterValue],
								})
							);

							logger.log('======>referenceField', gqlFieldName, join, where, values, filterValue);

							if (
								referenceField.tableName &&
								onSQL.length > 0 &&
								(where.length > 0 || join.length > 0)
							) {
								// apply a filter join only if either we filter for or we have a join
								const innerJoin = `inner join lateral (
                                select ${refAlias}.* 
                                    from ${referenceField.tableName} as ${refAlias}
                                    ${join.join(' \n')}
                                where ${onSQL} 
                                ${where.length > 0 ? ' and ' : ''}
                                ${where.join(' and ')}
		                    ) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, ' ');

								mapping.filterJoin.push(innerJoin);
								mapping.values = { ...mapping.values, ...values };
							}
						} else if (fieldProps.reference === ReferenceType.MANY_TO_ONE) {
							if (fieldProps.fieldNames.length && referenceField.tableName) {
								const ons = referenceField.primaryKeys;
								const entityOns = fieldProps.fieldNames;

								const onSQL = entityOns
									.map((o, i) => {
										return `${alias}.${o} = ${refAlias}.${ons[i]}`;
									})
									.join(', ');

								const { join, where, values, filterJoin } = mappingsReducer(
									this.recursiveMap({
										entityMetadata: referenceField,
										alias: childAlias,
										gqlFilters: [filterValue],
									})
								);
								logger.log('========filterJoin', filterJoin);

								if (onSQL.length > 0 && (where.length > 0 || join.length > 0)) {
									const innerJoin = `inner join lateral (
                                select ${refAlias}.* from ${referenceField.tableName} as ${refAlias}
                                    ${join.join(' \n')}
                                where ${onSQL} and ${where.join(' and ')}
		                    ) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, ' ');
									mapping.join.push(innerJoin);
									mapping.values = { ...mapping.values, ...values };
								}
							}
						} else if (fieldProps.reference === ReferenceType.MANY_TO_MANY) {
							const { where, join, values } = mappingsReducer(
								this.recursiveMap({
									entityMetadata: referenceField,
									alias: childAlias,
									gqlFilters: [filterValue],
								})
							);

							const onSQL = primaryKeys.map((o, i) => {
								return `${alias}.${o} = ${fieldProps.joinColumns[i]}`;
							});
							if (onSQL.length > 0 && (where.length > 0 || join.length > 0)) {
								const innerJoin = `left outer join lateral (
		                        select ${refAlias}.*
		                            from ${referenceField.tableName}
                                    where (${referenceField.primaryKeys.join(', ')}) in (
                                        select ${fieldProps.inverseJoinColumns.join(', ')}
		                                from ${fieldProps.pivotTable}
                                        ${join.join(' \n')}
		                            where ${onSQL} and ${where.join(' and ')}
		                        )
		                ) as ${refAlias} on true`.replaceAll(/[ \n\t]+/gi, ' ');

								mapping.filterJoin.push(innerJoin);
								mapping.values = { ...mapping.values, ...values };
							}
						} else {
							logger.log(
								'reference type',
								fieldProps.reference,
								'not handled, field',
								gqlFieldName
							);
						}
					} else if (filterValue !== undefined) {
						this.applyFilterValue<T>({
							filterValue,
							fieldOperation,
							gqlFieldName,
							latestAlias,
							mapping,
						});
					}
				});
				return { mappings, latestAlias: alias.update(latestAlias) };
			},
			{ mappings: res.mappings, latestAlias: alias.update(res.latestAlias) }
		);
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
		return res.mappings;
	};

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
	 * @param options.gqlFieldName - The GraphQL field name being filtered
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
		gqlFieldName,
		latestAlias,
		mapping,
	}: {
		filterValue: string | number | boolean | GQLEntityFilterInputFieldType<T>;
		fieldOperation: string | undefined;
		gqlFieldName: string;
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
				fieldName: gqlFieldName,
				latestAlias: latestAlias,
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
						fieldName: gqlFieldName,
						latestAlias: latestAlias,
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
