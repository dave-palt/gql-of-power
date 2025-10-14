import { ClassOperationInputType, ClassOperations, FieldOperations } from '../operations';
import { Alias, AliasManager, AliasType } from './alias';
import { SQLBuilder } from './sql-builder';
import {
	CustomFieldsSettings,
	EntityMetadata,
	EntityProperty,
	GQLEntityFilterInputFieldType,
	MappingsType,
	MetadataProvider,
	ReferenceType,
} from '../types';
import { logger } from '../variables';
import { mappingsReducer, newMappings } from './gql-to-sql-mapper';

const isPrimitive = (filterValue: any): filterValue is string | number | boolean | bigint | null =>
	typeof filterValue === 'bigint' ||
	typeof filterValue === 'boolean' ||
	typeof filterValue === 'number' ||
	typeof filterValue === 'string' ||
	typeof filterValue === 'symbol' ||
	filterValue === null;

export class FilterProcessor extends ClassOperations {
	constructor(
		private aliasManager: AliasManager,
		private metadataProvider: MetadataProvider,
		private recursiveMapFunction: <T>(params: {
			entityMetadata: EntityMetadata<T>;
			parentAlias: Alias;
			alias: Alias;
			gqlFilters?: Array<GQLEntityFilterInputFieldType<T>>;
		}) => Map<string, MappingsType>
	) {
		super();
	}

	/**
	 * Maps a filter to SQL conditions
	 */
	public mapFilter<T>(
		entityMetadata: EntityMetadata<T>,
		mappings: Map<string, MappingsType>,
		parentAlias: Alias,
		alias: Alias,
		gqlFieldNameKey: string & keyof GQLEntityFilterInputFieldType<T>,
		gqlFilter: GQLEntityFilterInputFieldType<T>,
		customFields?: CustomFieldsSettings<T>
	): void {
		if (gqlFilter == undefined) {
			return;
		}

		const { properties, primaryKeys } = entityMetadata;

		// Handle class operations (_and, _or, _not)
		if (
			typeof gqlFilter === 'object' &&
			(gqlFieldNameKey === '_and' || gqlFieldNameKey === '_or' || gqlFieldNameKey === '_not')
		) {
			if (!(gqlFieldNameKey in gqlFilter) || gqlFilter[gqlFieldNameKey] === undefined) {
				return;
			}

			logger.log(
				'FilterProcessor - ClassOperations: processing',
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

		// Handle field operations (id_in, id_eq, etc.)
		const fieldOperation = Object.keys(FieldOperations).find((k) => gqlFieldNameKey.endsWith(k));
		logger.log(
			'FilterProcessor - processing key',
			gqlFieldNameKey,
			'value',
			filterValue,
			'fieldOperation',
			fieldOperation
		);

		if (fieldOperation) {
			this.mapFieldOperation(
				mappings,
				gqlFieldNameKey,
				alias,
				fieldOperation,
				filterValue,
				properties
			);

			logger.log(
				'FilterProcessor - FieldOperation: processed',
				gqlFieldNameKey,
				fieldOperation,
				'filterValue',
				filterValue,
				'alias',
				alias.toString(),
				'mapping',
				mappings.get(gqlFieldNameKey)
			);
		} else {
			// Handle regular field filtering
			this.processRegularFieldFilter<T>(
				properties,
				customFields,
				gqlFieldNameKey,
				filterValue,
				mappings,
				alias,
				parentAlias,
				primaryKeys
			);
		}
	}

	/**
	 * Applies a filter value with the given operation
	 */
	public applyFilterValue<T>({
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
			logger.warn('FilterProcessor - applyFilterValue: filterValue is undefined', fieldName);
			return;
		}

		const filterValueIsPrimitive = isPrimitive(filterValue);

		if (filterValueIsPrimitive) {
			// Example: { id_eq: 1 } or { id: 1 }
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
			// Example: { Id: { _eq: 1 } }
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
	 * Processes class operations (_and, _or, _not)
	 */
	protected processClassOperation<T>(
		entityMetadata: EntityMetadata<T>,
		gqlFilter: GQLEntityFilterInputFieldType<T>,
		gqlFieldNameKey: string & keyof ClassOperations,
		mappings: Map<string, MappingsType>,
		parentAlias: Alias,
		alias: Alias
	): void {
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

	/**
	 * Handles _or operations
	 */
	public _or<T>({
		entityMetadata,
		gqlFilters,
		parentAlias,
		alias,
		fieldName,
		mapping,
		mappings,
	}: ClassOperationInputType<T>): void {
		gqlFilters.forEach((filter, i) => {
			const newMappings = new Map<string, MappingsType>();

			Object.keys(filter).forEach((fieldName: string) => {
				if (filter[fieldName as keyof typeof filter] === undefined) {
					return; // skip undefined values
				}

				logger.log(
					'FilterProcessor - _or - filter',
					fieldName,
					parentAlias.toString(),
					alias.toString()
				);

				this.mapFilter(
					entityMetadata,
					newMappings,
					parentAlias,
					alias,
					fieldName as keyof GQLEntityFilterInputFieldType<T>,
					filter
				);
			});

			const reduced = mappingsReducer(newMappings);
			const { filterJoin, where, values } = reduced;

			logger.log(
				'FilterProcessor - new mappings',
				newMappings,
				'for',
				i,
				fieldName,
				'reduced to',
				filterJoin,
				where,
				values
			);

			mapping._or.push(reduced);
			mapping.values = { ...mapping.values, ...values };
		});

		logger.log('FilterProcessor - mapping', mapping._or);
	}

	/**
	 * Handles _and operations
	 */
	public _and<T>({
		entityMetadata,
		gqlFilters,
		parentAlias,
		alias,
		fieldName,
		mapping,
		mappings,
	}: ClassOperationInputType<T>): void {
		logger.log('FilterProcessor - _and - gqlFilters', gqlFilters);

		const { ands, ors } = (Array.isArray(gqlFilters) ? gqlFilters : [gqlFilters]).reduce(
			(acc, f, i) => {
				const mapped = this.recursiveMapFunction({
					entityMetadata,
					gqlFilters: [f],
					parentAlias,
					alias: this.aliasManager.reset(AliasType.entity, alias.pref),
				});

				const or = mapped.get('_or');
				const newOrs = or ? [...acc.ors, or._or] : acc.ors;

				mapped.delete('_or');
				const newAnds = !or ? mappingsReducer(mapped, acc.ands) : acc.ands;

				logger.log('FilterProcessor - _and - mapped', i, 'or', or, 'and', newAnds);

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

		const combinations = this.getCombinations(ands, ors);

		logger.log('FilterProcessor - _and - combinations', combinations);
		mapping._and.push(...combinations);
		combinations.forEach((comb) => {
			mapping.values = { ...mapping.values, ...comb.values };
		});
	}

	/**
	 * Handles _not operations (placeholder implementation)
	 */
	public _not<T>({
		entityMetadata,
		gqlFilters,
		alias,
		fieldName,
		mapping,
		mappings,
	}: ClassOperationInputType<T>): void {
		// TODO: Implement _not operation
		logger.warn('FilterProcessor - _not operation not yet implemented');
	}

	private processRegularFieldFilter<T>(
		properties: { [key in string & keyof T]: EntityProperty },
		customFields: CustomFieldsSettings<T> | undefined,
		gqlFieldNameKey: string,
		filterValue: any,
		mappings: Map<string, MappingsType>,
		alias: Alias,
		parentAlias: Alias,
		primaryKeys: string[]
	): void {
		const lowercasedFirstFieldNameKey =
			gqlFieldNameKey[0].toLowerCase() + gqlFieldNameKey.slice(1);

		// Look for field props
		const customFieldProps =
			customFields?.[gqlFieldNameKey as keyof CustomFieldsSettings<T>] ??
			customFields?.[lowercasedFirstFieldNameKey as keyof CustomFieldsSettings<T>];

		const fieldProps =
			properties[gqlFieldNameKey as keyof EntityMetadata<T>['properties']] ??
			properties[lowercasedFirstFieldNameKey as keyof EntityMetadata<T>['properties']] ??
			properties[customFieldProps?.requires as keyof EntityMetadata<T>['properties']];

		const fieldNameKey = fieldProps
			? properties[gqlFieldNameKey as keyof EntityMetadata<T>['properties']]
				? gqlFieldNameKey
				: properties[lowercasedFirstFieldNameKey as keyof EntityMetadata<T>['properties']]
				? lowercasedFirstFieldNameKey
				: null
			: null;

		const gqlFieldName = (customFieldProps?.requires as string) ?? fieldNameKey;

		logger.log('FilterProcessor field ==>', gqlFieldNameKey, 'fieldNameKey', fieldNameKey);

		if (!fieldNameKey) {
			logger.log(
				alias.toString(),
				gqlFieldName,
				'not found in properties nor in customFields, properties',
				properties
			);
			throw new Error(
				`${alias.toString()} ${gqlFieldNameKey} => ${gqlFieldName} not found in properties nor in customFields`
			);
		}

		const mapping = this.getMapping(mappings, fieldNameKey);
		mapping.alias = alias;

		const referenceField =
			this.metadataProvider.exists(fieldProps.type) && 
			this.metadataProvider.getMetadata<any, any>(fieldProps.type);

		if (referenceField) {
			this.handleReferenceFieldFilter<T>(
				fieldProps,
				referenceField,
				alias,
				parentAlias,
				filterValue,
				mapping,
				primaryKeys,
				gqlFieldName
			);
		} else if (filterValue !== undefined) {
			this.handleDirectFieldFilter<T>(
				properties,
				fieldNameKey,
				filterValue,
				parentAlias,
				alias,
				mapping
			);
		}
	}

	private handleReferenceFieldFilter<T>(
		fieldProps: EntityProperty,
		referenceField: EntityMetadata<any>,
		alias: Alias,
		parentAlias: Alias,
		filterValue: any,
		mapping: MappingsType,
		primaryKeys: string[],
		gqlFieldName: string
	): void {
		const childAlias = this.aliasManager.next(AliasType.entity, 'w');

		const recursiveMapResults = this.recursiveMapFunction({
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
			'FilterProcessor - handleReferenceFieldFilter: referenceField',
			referenceField.name,
			fieldProps.reference,
			'recursiveMapResults',
			recursiveMapResults,
			'_or',
			_or,
			alias.toString(),
			childAlias.toString()
		);

		// Handle different relationship types
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
	}

	private handleDirectFieldFilter<T>(
		properties: { [key in string & keyof T]: EntityProperty },
		fieldNameKey: string,
		filterValue: any,
		parentAlias: Alias,
		alias: Alias,
		mapping: MappingsType
	): void {
		// Direct field filtering with _eq operation
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
			'FilterProcessor - direct field filter _eq',
			fieldNameKey,
			'field names',
			fieldNames,
			'filterValue',
			filterValue,
			'alias',
			alias.toString(),
			'mapping',
			mapping
		);
	}

	private mapFieldOperation<T>(
		mappings: Map<string, MappingsType>,
		gqlFieldNameKey: string,
		alias: Alias,
		fieldOperation: string,
		fieldValue: GQLEntityFilterInputFieldType<T>[any],
		properties: { [key in string & keyof T]: EntityProperty }
	): void {
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
						const values = fieldValue.map((fv, i) => {
							const nextValueAlias = this.aliasManager.next(AliasType.value, fieldName);
							mapping.values[nextValueAlias.toParamName(i)] = fv;
							return ':' + nextValueAlias.toParamName(i);
						});

						return FieldOperations[fieldOperation as keyof typeof FieldOperations](
							[alias.toColumnName(fieldName), ...values],
							['', ...fieldValue]
						);
					}
				)
			);
		} else {
			const nextValueAlias = this.aliasManager.next(AliasType.value, gqlFieldNameKey);
			logger.log(
				'FilterProcessor - mapFieldOperation: field',
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

	private applyFilterOperation({
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
	}): void {
		const filterFieldWithAlias = `${alias.toColumnName(fieldName)}`;
		const filterParameterName = `${this.aliasManager.next(AliasType.entity, fieldName).toParamName(
			fieldName
		)}`;

		const where = FieldOperations[fieldOperation](
			[filterFieldWithAlias, ':' + filterParameterName],
			['_', filterValue]
		);
		const value = { [filterParameterName]: filterValue };

		mapping.where.push(where);
		mapping.values = { ...mapping.values, ...value };
	}

	private getMapping(mappings: Map<string, MappingsType>, fieldNameKey: string): MappingsType {
		const m = mappings.get(fieldNameKey);
		if (m) {
			return m;
		}

		const mapping = newMappings();
		mappings.set(fieldNameKey, mapping);
		return mapping;
	}

	private getCombinations(startMappings: MappingsType, matrix: MappingsType[][]): MappingsType[] {
		const result: MappingsType[] = [];

		function combine(current: MappingsType, depth: number) {
			if (depth === matrix.length) {
				result.push(current);
				return;
			}

			for (const obj of matrix[depth]) {
				const newOrs = {
					...obj,
					join: current.join.concat(obj.join),
					filterJoin: current.filterJoin.concat(obj.filterJoin),
					where: current.where.concat(obj.where),
					values: { ...current.values, ...obj.values },
				};

				combine(newOrs, depth + 1);
			}
		}

		combine(startMappings, 0);
		return result;
	}

	/**
	 * Maps filter for One-to-Many and One-to-One relationships
	 */
	private mapFilterOneToX<T>(
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
	): void {
		const referenceFieldProps = referenceField.properties[
			fieldProps.mappedBy as keyof typeof referenceField.properties
		] as EntityProperty;
		
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
			'FilterProcessor - mapFilterOneToX',
			gqlFieldName,
			'whereSQL',
			parentAlias.toString(),
			whereSQL
		);

		if (
			referenceField.tableName &&
			whereSQL.length > 0 &&
			(filterJoin.length > 0 || whereWithValues.length > 0 || join.length > 0 || _or.length > 0)
		) {
			const unionAll = SQLBuilder.buildUnionAll(
				[],
				referenceField.tableName,
				alias.toString(),
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

			logger.log('FilterProcessor - mapFilterOneToX', gqlFieldName, 'unionAll', unionAll);

			mapping.filterJoin.push(jsonSQL);
			mapping.values = { ...mapping.values, ...values };
		}
	}

	/**
	 * Maps filter for Many-to-One relationships
	 */
	private mapFilterManyToOne<T>(
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
	): void {
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

			logger.log('FilterProcessor - mapFilterManyToOne: whereSQL', alias.toString(), whereSQL);

			if (
				whereSQL.length > 0 &&
				(filterJoin.length > 0 || whereWithValues.length > 0 || join.length > 0 || _or.length > 0)
			) {
				const unionAll = SQLBuilder.buildUnionAll(
					[],
					referenceField.tableName,
					alias.toString(),
					filterJoin,
					join,
					whereSQL,
					whereWithValues,
					_or,
					this.buildManyToOneJoin
				);
				
				logger.log('FilterProcessor - mapFilterManyToOne: whereSQL', alias.toString(), unionAll);

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

	/**
	 * Maps filter for Many-to-Many relationships
	 */
	private mapFilterManyToMany<T>(
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
	): void {
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
			'FilterProcessor - mapFilterManyToMany: alias',
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
			const ptAlias = this.aliasManager.next(AliasType.entity, 'pt');
			const ptSQL = `select ${fieldProps.inverseJoinColumns.join(', ')} 
					from ${fieldProps.pivotTable}
						${join.join(' \n')}
				where ${pivotTableWhereSQLs.join(' and ')}`.replaceAll(/[ \n\t]+/gi, ' ');

			const onSQL = `(${fieldProps.inverseJoinColumns
				.map((c) => ptAlias.toColumnName(c))
				.join(', ')}) in (${referenceField.primaryKeys
				.map((c) => alias.toColumnName(c))
				.join(', ')})`.replaceAll(/[ \n\t]+/gi, ' ');

			const unionAll = SQLBuilder.buildUnionAll(
				[alias.toColumnName('*')],
				referenceField.tableName,
				alias.toString(),
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

			logger.log('FilterProcessor - mapFilterManyToMany: whereSQL', alias.toString(), unionAll);

			mapping.filterJoin.push(innerJoin);
			mapping.values = { ...mapping.values, ...values };
		}
	}

	/**
	 * Builds a join query for One-to-X relationships
	 */
	private buildOneToXJoin(
		_fields: string[],
		alias: Alias,
		tableName: string,
		filterJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?:
			| { filterJoin: string }
			| { where: string }
	): string {
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
	 * Builds a join query for Many-to-One relationships
	 */
	private buildManyToOneJoin(
		_fields: string[],
		alias: Alias,
		tableName: string,
		filterJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?:
			| { filterJoin: string }
			| { where: string }
	): string {
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

	/**
	 * Builds a pivot table query for Many-to-Many relationships
	 */
	private buildManyToManyPivotTable(
		fieldNames: string[],
		alias: Alias,
		tableName: string,
		filterJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?:
			| { filterJoin: string }
			| { where: string }
	): string {
		return `select ${fieldNames.join(', ')} 
					from ${tableName} as ${alias.toString()}
						${join.join(' \n')}
						${value && 'filterJoin' in value ? value.filterJoin : ''}
						${filterJoin.join(' \n')}
				${whereSQL.length > 0 ? ` where ${whereSQL}` : ''}
				${whereWithValues.length > 0 ? ` and ${whereWithValues.join(' and ')}` : ''}
				${value && 'where' in value ? `and ${value.where}` : ''}`.replaceAll(/[ \n\t]+/gi, ' ');
	}
}