import { ClassOperationInputType, ClassOperations, FieldOperations } from '../operations';
import {
	CustomFieldsSettings,
	EntityMetadata,
	EntityProperty,
	Fields,
	FieldSelection,
	GQLEntityFilterInputFieldType,
	GQLEntityOrderByInputType,
	GQLEntityPaginationInputType,
	MappingsType,
	MetadataProvider,
	ReferenceType,
	RelatedFieldSettings,
} from '../types';
import { keys } from '../utils';
import { logger } from '../variables';
import { Alias, AliasManager, AliasType } from './alias';
import { FilterProcessor } from './filter-processor';
import { RelationshipHandler } from './relationship-handler';
import { SQLBuilder } from './sql-builder';

const mappingsToString = (m: MappingsType) => `MappingsType:
select: ${m.select.size}
json: ${m.json.length}
filterJoin: ${m.filterJoin.length}
join: ${m.join.length}
where: ${m.where.length}
values: ${keys(m.values ?? {}).length}
orderBy: ${m.orderBy.length}
_or: ${m._or.length}
_and: ${m._and.length}
_not: ${m._not.length}
`;

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
	private filterProcessor: FilterProcessor;
	private relationshipHandler: RelationshipHandler;
	private sqlBuilder = new SQLBuilder();

	private exists: MetadataProvider['exists'];
	private getMetadata: MetadataProvider['getMetadata'];
	private namedParameterPrefix: string;
	constructor(
		metadataProvider: MetadataProvider,
		opts: { namedParameterPrefix?: string } = { namedParameterPrefix: ':' }
	) {
		super();
		this.exists = metadataProvider.exists;
		this.getMetadata = metadataProvider.getMetadata;
		this.namedParameterPrefix = opts?.namedParameterPrefix ?? ':';

		this.filterProcessor = new FilterProcessor(
			this.Alias2,
			metadataProvider,
			this.recursiveMap.bind(this),
			this.namedParameterPrefix
		);
		this.relationshipHandler = new RelationshipHandler();
	}

	public buildQueryAndBindingsFor<T>({
		fields,
		filter,
		customFields,
		entity,
		pagination,
	}: {
		fields: FieldSelection<T>;
		customFields: CustomFieldsSettings<T>;
		entity: new () => T;
		filter?: GQLEntityFilterInputFieldType<T>;
		pagination?: Partial<GQLEntityPaginationInputType<T>>;
	}): QueryAndBindings {
		const logName = 'GQLtoSQLMapper - ' + entity.name;
		logger.time(logName);
		logger.timeLog(logName);

		this.Alias2 = new AliasManager();
		const alias = this.Alias2.start('a');
		const metadata = this.getMetadata(entity.name) as EntityMetadata<T>;

		logger.log(
			logName,
			'customFields',
			customFields,
			'fields',
			fields,
			'orderBy',
			pagination?.orderBy
		);

		const recursiveMapResults = this.recursiveMap<T>({
			entityMetadata: metadata,
			parentAlias: alias,
			alias,
			fields,
			customFields,
			gqlFilters: filter ? [filter] : [],
		});
		logger.log('recursiveMapResults', recursiveMapResults);
		const { select, json, filterJoin, join, where, values, _or, _and } =
			mappingsReducer(recursiveMapResults);

		const orderByFields = (pagination?.orderBy ?? [])
			.map((obs) =>
				keys(obs)
					.map(
						(ob) =>
							metadata.properties[ob]?.fieldNames
								?.map((fieldName) => `${alias.toString()}.${fieldName}`)
								?.join(', ') ?? `${alias.toString()}.${ob}`
					)
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
							keys(obs)
								.map((ob) => {
									const fieldMeta = metadata.properties[ob];
									if (!fieldMeta) {
										throw new Error(
											'Unknown pagination field ' + ob + ' for entity ' + entity.name
										);
									}
									return fieldMeta.fieldNames
										.map((fn) => `${alias?.toColumnName(fn) ?? fn} ${obs[ob]}`)
										.join(', ');
								})
								.filter((o) => o.length > 0)
								.join(', ')
						)
						.filter((o) => o.length > 0)
						.join(', ')}`
				: ``;

		// logger.log('orderByFields', orderByFields, 'select', select, 'orderBy', orderBy);
		const selectFields = [...new Set(orderByFields.concat(Array.from(select)))];

		// Build subquery using SQLBuilder
		const buildSubQueryWrapper = (
			globalFilterJoin: string[],
			globalFilterWhere: string[],
			alias: Alias,
			value?: { filterJoin: string[] } | { where: string[] }
		) => {
			const allFilterJoins = [...globalFilterJoin];
			if (value && 'filterJoin' in value) {
				allFilterJoins.push(...value.filterJoin);
			}
			const allWhere = [...globalFilterWhere];
			if (value && 'where' in value) {
				allWhere.push(...value.where);
			}

			// Convert arrays to single values for SQLBuilder compatibility
			let valueForBuilder: { filterJoin: string } | { where: string } | undefined;
			if (value && 'filterJoin' in value) {
				valueForBuilder = { filterJoin: value.filterJoin.join('\n') };
			} else if (value && 'where' in value) {
				valueForBuilder = { where: value.where.join(' and ') };
			}

			return SQLBuilder.buildSubQuery(
				selectFields,
				metadata.tableName,
				alias.toString(),
				allFilterJoins,
				allWhere,
				valueForBuilder
			);
		};

		// Use SQLBuilder.buildUnionAll for OR conditions
		const unionAll = [..._or, ..._and].map(
			({ filterJoin: filterJoins, where: wheres, alias: mapAlias }) =>
				buildSubQueryWrapper(filterJoin, where, mapAlias ?? alias, {
					filterJoin: filterJoins,
					where: wheres,
				})
		);

		const sourceDataSQL = `${
			unionAll.length > 0
				? `select distinct * from (${unionAll.join(' union all ')}) as ${alias.toString()}`
				: buildSubQueryWrapper(filterJoin, where, alias)
		}
		${buildOrderBySQL(pagination, alias)}
		${pagination?.limit ? `limit ${this.namedParameterPrefix}limit` : ``}
		${pagination?.offset ? `offset ${this.namedParameterPrefix}offset` : ``}`.replaceAll(
			/[ \n\t]+/gi,
			' '
		);

		logger.log(logName, 'sourceDataSQL', unionAll.length, sourceDataSQL);

		const orderBySQL = pagination?.orderBy
			? `order by ${pagination.orderBy
					.map((obs) =>
						keys(obs)
							.map((ob) =>
								metadata.properties[ob].fieldNames
									.map((fn) => `${alias.toColumnName(fn)} ${obs[ob]}`)
									.join(', ')
							)
							.filter((o) => o.length > 0)
							.join(', ')
					)
					.filter((o) => o.length > 0)
					.join(', ')}`
			: ``;

		// Use row_to_json on the final alias to get properly formatted JSON with correct casing
		const querySQL = `select ${alias.toString()}.*
								${json.length > 0 ? `, ${json.join(', ')}` : ''}
								from (${sourceDataSQL}) as ${alias.toString()}
							${join.join(' \n')}
					${orderBySQL}`.replaceAll(/[ \n\t]+/gi, ' ');

		const bindings = {
			...values,
			limit: 3000,
			...(pagination?.limit ? { limit: pagination.limit } : {}),
			...(pagination?.offset ? { offset: pagination.offset } : {}),
		};

		logger.timeEnd(logName);
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
		parentGqlFieldNameKey,
		isFieldFilter,
	}: {
		entityMetadata: EntityMetadata<T>;
		fields?: Fields<T> | any;
		parentAlias: Alias;
		alias: Alias;
		gqlFilters?: Array<GQLEntityFilterInputFieldType<T>>;
		prefix?: string;
		customFields?: CustomFieldsSettings<T>;
		parentGqlFieldNameKey?: string;
		isFieldFilter?: boolean;
	}) => {
		const prePrefix = isFieldFilter ? 'FF-' : '';
		const logPrefix = alias.concat(prePrefix + 'GQLtoSQLMapper - recursiveMap');
		logger.log(logPrefix, 'start');
		const { properties, primaryKeys } = entityMetadata;

		let res = [...new Set(keys(fields ?? {}))]
			.sort((f1, f2) => (f1.startsWith('__') ? -1 : f2.startsWith('__') ? 1 : 0))
			.reduce(
				({ mappings }, gqlFieldNameKey) => {
					logger.log(
						logPrefix,
						'- mapFilter ================================================>',
						gqlFieldNameKey,
						parentGqlFieldNameKey,
						'keys:',
						...mappings.keys()
					);
					if (gqlFieldNameKey.startsWith('__')) {
						this.handleFieldArguments<T>(
							parentGqlFieldNameKey || gqlFieldNameKey,
							gqlFieldNameKey,
							fields,
							alias,
							entityMetadata,
							mappings
						);
					} else {
						const mapping = this.getFieldMapping(mappings, gqlFieldNameKey);

						logger.log(
							logPrefix,
							'- using mapping ================================================> for',
							gqlFieldNameKey,
							mappingsToString(mapping)
						);
						const customFieldProps =
							customFields && gqlFieldNameKey in customFields
								? customFields[gqlFieldNameKey as keyof typeof customFields]
								: undefined;

						const fieldProps =
							properties[gqlFieldNameKey as keyof EntityMetadata<T>['properties']] ??
							properties[customFieldProps?.requires as keyof EntityMetadata<T>['properties']];

						const gqlFieldName = (customFieldProps?.requires as string) ?? gqlFieldNameKey;
						logger.log(
							'recursiveMap fields | gqlFieldName',
							gqlFieldName,
							// mapping
							fields
							// gqlFieldNameKey
						);

						if (!fieldProps) {
							return this.mapCustomField<T>(
								customFieldProps,
								mapping,
								alias,
								gqlFieldName,
								mappings
							);
						} else {
							this.mapField<T>(
								gqlFieldNameKey,
								fieldProps,
								mapping,
								alias,
								fields,
								gqlFieldName,
								primaryKeys
							);
						}
					}
					return { mappings };
				},
				{ mappings: new Map<string, MappingsType>() }
			);

		logger.log(logPrefix, 'fields processed', fields, [...res.mappings.entries()]);

		res = (gqlFilters ?? []).reduce(
			({ mappings }, gqlFilter) => {
				keys(gqlFilter ?? {}).forEach((gqlFieldNameKey) => {
					this.filterProcessor.mapFilter(
						entityMetadata,
						mappings,
						parentAlias,
						alias,
						gqlFieldNameKey as any,
						gqlFilter,
						customFields,
						isFieldFilter
					);
				});
				return { mappings };
			},
			{ mappings: res.mappings }
		);
		(gqlFilters ?? []).length > 0 && logger.log('gqlFilters', gqlFilters);
		res.mappings.size > 0 && logger.log(logPrefix, 'filters processed', res.mappings.entries());

		logger.log(logPrefix, 'end');
		logger.log('');
		return res.mappings;
	};

	private mapCustomField<T>(
		customFieldProps: RelatedFieldSettings<T> | undefined,
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
				mapping.select.add(`${latestAlias.toString()}.${req} AS "${gqlFieldName}"`);
			});
		} else {
			// Add null field with proper alias
			mapping.select.add(`null AS "${gqlFieldName}"`);
		}
		return { mappings, latestAlias };
	}

	protected mapField<T>(
		parentGqlFieldNameKey: string,
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
				'recursiveMap || GQLtoSQLMapper - recursiveMap - referenceField latest alias next',
				alias.toString(),
				childAlias.toString(),
				mappingsToString(mapping)
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
					parentGqlFieldNameKey: parentGqlFieldNameKey,
				})
				// mapping
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
				mapping.orderBy,
				fields
			);
			if (
				fieldProps.reference === ReferenceType.ONE_TO_MANY ||
				fieldProps.reference === ReferenceType.ONE_TO_ONE
			) {
				this.relationshipHandler.mapOneToX(
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
				this.relationshipHandler.mapManyToOne(
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
				this.relationshipHandler.mapManyToMany(
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
		parentGqlFieldNameKey: string,
		gqlFieldNameKey: string,
		fields: any,
		alias: Alias,
		entityMetadata: EntityMetadata<T>,
		mappings: Map<string, MappingsType>
	) {
		if (gqlFieldNameKey === '__arguments') {
			const __arguments = fields[gqlFieldNameKey];

			const mapping = this.getFieldMapping(mappings, parentGqlFieldNameKey);

			const filter = __arguments.find((a: any) => a?.filter)?.filter?.value;
			const pagination = __arguments.find((a: any) => a?.pagination)?.pagination?.value;

			logger.log(
				'GQLtoSQLMapper - handleFieldArguments for -----',
				parentGqlFieldNameKey,
				'pagination',
				pagination,
				'__arguments',
				__arguments
			);
			if (filter || pagination) {
				const mapped = this.recursiveMap({
					entityMetadata,
					parentAlias: alias,
					alias,
					gqlFilters: [filter],
					isFieldFilter: true,
				});

				const { filterJoin, where: w, values, _or, _and, _not } = mappingsReducer(mapped);

				mapping.filterJoin.push(...filterJoin);
				mapping.where.push(...w);
				mapping.values = { ...mapping.values, ...values };
				mapping.limit = pagination?.limit;
				mapping.offset = pagination?.offset;
				mapping._or.push(..._or);
				mapping._and.push(..._and);
				mapping._not.push(..._not);
				mapping.orderBy.push(...(pagination?.orderBy ?? []));
				logger.log(
					'GQLtoSQLMapper - handleFieldArguments - processed',
					filter,
					'mapping',
					mappingsToString(mapping)
				);
			} else {
				// m.__arguments = __arguments;
			}
			// mappings.set(parentGqlFieldNameKey, m);
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
			const isArray = fieldProps.reference !== ReferenceType.ONE_TO_ONE;
			const jsonSelect = SQLBuilder.generateJsonSelectStatement(alias.toString(), isArray);

			const onFields = Array.from(select);

			const processedOrderBy = orderBy.reduce((acc, ob) => {
				keys(ob).forEach((k) => {
					logger.log(
						'recursiveMap - processedOrderBy',
						k,
						ob[k],
						(referenceField as any).properties[k]
					);
					if (k in referenceField.properties) {
						acc.push(
							...referenceField.properties[k].fieldNames.map(
								(fn) => `${alias.toColumnName(fn)} ${ob[k]}`
							)
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

			const selectFields = Array.from(select);

			const jsonSQL = SQLBuilder.generateJsonSelectStatement(alias.toString());

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
			throw `m:m joins with different number of columns ${primaryKeys.length} !== ${ons.length} on table ${referenceField.tableName}`;
		}
		if (referenceField.primaryKeys.length !== fieldProps.inverseJoinColumns.length) {
			throw `m:m joins with different number of columns ${referenceField.primaryKeys.length} !== ${fieldProps.inverseJoinColumns.length} on reference ${referenceField.tableName}.${fieldProps.pivotTable}`;
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

			const jsonSQL = SQLBuilder.generateJsonSelectStatement(alias.toString(), true);

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
											keys(o ?? {})
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

			mapping.join.push(leftOuterJoin);
			mapping.values = { ...mapping.values, ...values };
		} else {
			mapping.json.push(`null as "${gqlFieldName}"`);
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
		// Use double-quoted alias to preserve casing for row_to_json
		const aliasedField =
			gqlFieldName !== fieldNames[0]
				? `${fieldNameWithAlias} AS "${gqlFieldName}"`
				: fieldNameWithAlias;

		mapping.select.add(aliasedField);
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
	/**
	 * @deprecated use this.filterProcessor
	 */
	protected mapFilter<T>(
		entityMetadata: EntityMetadata<T>,
		mappings: Map<string, MappingsType>,
		parentAlias: Alias,
		alias: Alias,
		gqlFieldNameKey: string & keyof GQLEntityFilterInputFieldType<T>,
		gqlFilter: GQLEntityFilterInputFieldType<T>,
		customFields?: CustomFieldsSettings<T>,
		isFieldFilter?: boolean
	) {
		// Delegate to FilterProcessor
		return this.filterProcessor.mapFilter(
			entityMetadata,
			mappings,
			parentAlias,
			alias,
			gqlFieldNameKey,
			gqlFilter,
			customFields,
			isFieldFilter
		);
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
		properties: { [key in (string & keyof T) | string]: EntityProperty }
	) {
		const mapping = this.getFieldMapping(mappings, gqlFieldNameKey);

		const fieldNameBeforeOperation =
			gqlFieldNameKey.indexOf(fieldOperation) > 0
				? // id_eq
				  gqlFieldNameKey.slice(0, -fieldOperation.length)
				: // id: { _eq }
				  gqlFieldNameKey;

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
								return this.namedParameterPrefix + nextValueAlias.toParamName(i);
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
						[
							alias.toColumnName(fieldName),
							`${this.namedParameterPrefix}${nextValueAlias.toParamName(1)}`,
						],
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
			for (const op of keys(FieldOperations)) {
				if (op in filterValue) {
					const filterActualValue = filterValue[op as keyof typeof filterValue];
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
			[filterFieldWithAlias, this.namedParameterPrefix + filterParameterName],
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

		const mapping = this.getFieldMapping(mappings, gqlFieldNameKey);
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
			keys(filter).forEach((fieldName) => {
				if (filter[fieldName] === undefined) {
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
				this.filterProcessor.mapFilter(
					entityMetadata,
					newMappings,
					parentAlias,
					alias,
					fieldName,
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
