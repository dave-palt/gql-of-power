import { ClassOperationInputType, ClassOperations, FieldOperations } from '../operations';
import {
	CustomFieldsSettings,
	EntityMetadata,
	EntityProperty,
	GQLEntityFilterInputFieldType,
	MappingsType,
	MetadataProvider,
	ReferenceType,
} from '../types';
import { keys } from '../utils';
import { logger } from '../variables';
import { Alias, AliasManager, AliasType } from './alias';
import { SQLBuilder } from './sql-builder';
import { QueriesUtils } from './utils';

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
		}) => Map<string, MappingsType>,
		private namedParameterPrefix: string = ':'
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
		gqlFieldNameKey: string | (string & keyof GQLEntityFilterInputFieldType<T>),
		gqlFilter: GQLEntityFilterInputFieldType<T>,
		customFields?: CustomFieldsSettings<T>,
		isFieldFilter?: boolean
	): void {
		const prePrefix = isFieldFilter ? 'FF-' : '';
		logger.log(prePrefix + 'FilterProcessor - mapFilter', gqlFieldNameKey, gqlFilter);
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
				prePrefix + 'FilterProcessor - mapFilter - ClassOperations: processing initial if',
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

		const filterValue = gqlFilter[gqlFieldNameKey as keyof typeof gqlFilter];

		// Handle field operations (id_in, id_eq, etc.)
		const fieldOperation = keys(FieldOperations).find((k) => gqlFieldNameKey.endsWith(k));

		// Handle nested field operations like { id: { _in }, id: { _eq }, ... }
		const fieldOperations =
			typeof filterValue === 'object'
				? keys(filterValue ?? ({} as Partial<typeof filterValue>)).reduce((acc, key) => {
						const k = keys(FieldOperations).find((k) => k.toString() === key.toString());
						if (k) {
							acc.push({
								fieldOperation: k,
								value: (filterValue as any)[key],
							});
						}
						return acc;
				  }, [] as Array<{ fieldOperation: keyof typeof FieldOperations; value: any }>)
				: ([] as Array<{ fieldOperation: keyof typeof FieldOperations; value: any }>);

		if (fieldOperation) {
			fieldOperations.push({
				fieldOperation,
				value: filterValue,
			});
		}

		logger.log(
			prePrefix + 'FilterProcessor - mapFilter - processing key',
			gqlFieldNameKey,
			'value',
			filterValue,
			'fieldOperation',
			fieldOperation,
			'fieldOperations',
			fieldOperations
		);

		if (fieldOperations.length > 0) {
			// Handle { id_eq: 1 } OR { id: { _eq: 1 } }
			fieldOperations.forEach(({ fieldOperation, value }) => {
				this.mapFieldOperation(mappings, gqlFieldNameKey, alias, fieldOperation, value, properties);
				logger.log(
					prePrefix + 'FilterProcessor - mapFilter - FieldOperation: processed',
					gqlFieldNameKey,
					fieldOperation,
					'value',
					value,
					'latestAlias',
					alias.toString(),
					'mapping',
					mappings.get(gqlFieldNameKey)
				);
			});
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
	 *
	 * @deprecated
	 */
	public applyFilterValue<T>({
		filterValue,
		fieldOperation,
		fieldName,
		parentAlias,
		alias,
		mapping,
	}: {
		filterValue: GQLEntityFilterInputFieldType<T> | any;
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
			for (const op of keys(FieldOperations)) {
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

		const mapping = QueriesUtils.getMapping(mappings, gqlFieldNameKey);
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

			keys(filter).forEach((fieldName) => {
				if (filter[fieldName] === undefined) {
					return; // skip undefined values
				}

				logger.log(
					'FilterProcessor - _or - filter',
					fieldName,
					parentAlias.toString(),
					alias.toString()
				);

				this.mapFilter(entityMetadata, newMappings, parentAlias, alias, fieldName, filter);
			});

			const reduced = QueriesUtils.mappingsReducer(newMappings);
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
				const newAnds = !or ? QueriesUtils.mappingsReducer(mapped, acc.ands) : acc.ands;

				logger.log('FilterProcessor - _and - mapped', i, 'or', or, 'and', newAnds);

				return {
					ors: newOrs,
					ands: newAnds,
				};
			},
			{
				ors: [],
				ands: QueriesUtils.newMappings(),
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
		properties: { [key in (string & keyof T) | string]: EntityProperty },
		customFields: CustomFieldsSettings<T> | undefined,
		gqlFieldNameKey: string,
		filterValue: any,
		mappings: Map<string, MappingsType>,
		alias: Alias,
		parentAlias: Alias,
		primaryKeys: string[]
	): void {
		const lowercasedFirstFieldNameKey = gqlFieldNameKey[0].toLowerCase() + gqlFieldNameKey.slice(1);

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

		const mapping = QueriesUtils.getMapping(mappings, fieldNameKey);
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

	protected handleReferenceFieldFilter<T>(
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
		} = QueriesUtils.mappingsReducer(recursiveMapResults);

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

	protected handleDirectFieldFilter<T>(
		properties: { [key in string & keyof T]: EntityProperty },
		fieldNameKey: string,
		filterValue: any,
		parentAlias: Alias,
		alias: Alias,
		mapping: MappingsType
	): void {
		// Direct field filtering with _eq operation
		const fieldNames = properties[fieldNameKey as keyof typeof properties].fieldNames;

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

	protected mapFieldOperation<T>(
		mappings: Map<string, MappingsType>,
		gqlFieldNameKey: string,
		alias: Alias,
		fieldOperation: string,
		fieldValue: any,
		properties: { [key in (string & keyof T) | string]: EntityProperty }
	): void {
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
						const values = fieldValue.map(
							(fv, i) => {
								const nextValueAlias = this.aliasManager.next(AliasType.value, fieldName);
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

	protected getFieldMapping(mappings: Map<string, MappingsType>, gqlFieldNameKey: string) {
		const m = mappings.get(gqlFieldNameKey);
		if (m) {
			return m;
		}
		const newMapping = QueriesUtils.newMappings();
		mappings.set(gqlFieldNameKey, newMapping);
		return newMapping;
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
	}): void {
		const filterFieldWithAlias = `${alias.toColumnName(fieldName)}`;
		const filterParameterName = `${this.aliasManager
			.next(AliasType.entity, fieldName)
			.toParamName(fieldName)}`;

		const where = FieldOperations[fieldOperation](
			[filterFieldWithAlias, this.namedParameterPrefix + filterParameterName],
			['_', filterValue]
		);
		const value = { [filterParameterName]: filterValue };

		mapping.where.push(where);
		mapping.values = { ...mapping.values, ...value };
	}

	protected getCombinations(startMappings: MappingsType, matrix: MappingsType[][]): MappingsType[] {
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

			logger.log('FilterProcessor - mapFilterOneToX', gqlFieldName, 'unionAll', unionAll);

			mapping.filterJoin.push(jsonSQL);
			mapping.values = { ...mapping.values, ...values };
		}
	}

	/**
	 * Maps filter for Many-to-One relationships
	 */
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
					alias,
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

			logger.log('FilterProcessor - mapFilterManyToMany: whereSQL', alias.toString(), unionAll);

			mapping.filterJoin.push(innerJoin);
			mapping.values = { ...mapping.values, ...values };
		}
	}

	/**
	 * Builds a join query for One-to-X relationships
	 */
	protected buildOneToXJoin(
		_fields: string[],
		alias: Alias,
		tableName: string,
		filterJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?: { filterJoin: string } | { where: string }
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
	protected buildManyToOneJoin(
		_fields: string[],
		alias: Alias,
		tableName: string,
		filterJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?: { filterJoin: string } | { where: string }
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
	protected buildManyToManyPivotTable(
		fieldNames: string[],
		alias: Alias,
		tableName: string,
		filterJoin: string[],
		join: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?: { filterJoin: string } | { where: string }
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
