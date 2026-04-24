import { getCountFieldsFor, getGQLEntityNameFor } from '../entities';
import {
	ClassOperationInputType,
	ClassOperations,
	FieldOperations,
	FieldOperationsType,
} from '../operations';
import {
	CountFieldMeta,
	CustomFieldsSettings,
	EntityMetadata,
	EntityProperty,
	GQLEntityFilterInputFieldType,
	MappingsType,
	MetadataProviderType,
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
		private metadataProvider: MetadataProviderType,
		private recursiveMapFunction: <T>(params: {
			entityMetadata: EntityMetadata<T>;
			parentAlias: Alias;
			alias: Alias;
			gqlFilters?: Array<GQLEntityFilterInputFieldType<T>>;
			customFields?: CustomFieldsSettings<T>;
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

		// Handle class operations (_and, _or, _not, _exists, _not_exists)
		if (
			typeof gqlFilter === 'object' &&
			(gqlFieldNameKey === '_and' ||
				gqlFieldNameKey === '_or' ||
				gqlFieldNameKey === '_not' ||
				gqlFieldNameKey === '_exists' ||
				gqlFieldNameKey === '_not_exists')
		) {
			if (
				!(gqlFieldNameKey in (gqlFilter as object)) ||
				(gqlFilter as any)[gqlFieldNameKey] === undefined
			) {
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
				alias,
				customFields
			);
			return;
		}

		const filterValue = gqlFilter[gqlFieldNameKey as keyof typeof gqlFilter];

		// Check if this filter key matches a count field (e.g. bookCount_eq: 4, bookCount: 4)
		const countFilterResult = this.tryMapCountFieldFilter<T>(
			gqlFieldNameKey,
			filterValue,
			entityMetadata,
			parentAlias,
			alias,
			mappings,
			customFields,
			isFieldFilter
		);
		if (countFilterResult) {
			return;
		}

		// Handle field operations (id_in, id_eq, etc.)
		const fieldOperation = keys(FieldOperations).find((k) => gqlFieldNameKey.endsWith(k));

		// Handle nested field operations like { id: { _in }, id: { _eq }, ... }
		const fieldOperations =
			typeof filterValue === 'object'
				? keys(filterValue ?? ({} as Partial<typeof filterValue>)).reduce(
						(acc, key) => {
							const k = keys(FieldOperations).find((k) => k.toString() === key.toString());
							if (k) {
								acc.push({
									fieldOperation: k,
									value: (filterValue as any)[key],
								});
							}
							return acc;
						},
						[] as Array<{ fieldOperation: keyof FieldOperationsType; value: any }>
					)
				: ([] as Array<{ fieldOperation: keyof FieldOperationsType; value: any }>);

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
				primaryKeys,
				entityMetadata
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
		fieldOperation: string & keyof FieldOperationsType;
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
			const op = fieldOperation ?? ('_eq' as keyof FieldOperationsType);
			this.applyFilterOperation({
				fieldOperation: op as keyof FieldOperationsType,
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
						fieldOperation: op as string & keyof FieldOperationsType,
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
		alias: Alias,
		customFields?: CustomFieldsSettings<T>
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
			customFields,
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
		customFields,
	}: ClassOperationInputType<T>): void {
		gqlFilters.forEach((filter, i) => {
			const newMappings = new Map<string, MappingsType>();

			keys(filter).forEach((fieldName) => {
				if (filter[fieldName] === undefined) {
					return;
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
					fieldName,
					filter,
					customFields
				);
			});

			const reduced = QueriesUtils.mappingsReducer(newMappings);

			logger.log(
				'FilterProcessor - new mappings',
				newMappings,
				'for',
				i,
				fieldName,
				'reduced to',
				reduced.innerJoin,
				reduced.where,
				reduced.values,
				'_and entries',
				reduced._and.length
			);

			if (reduced._and.length > 0) {
				for (const andMapping of reduced._and) {
					const expanded: MappingsType = {
						...QueriesUtils.newMappings(),
						where: [...reduced.where, ...andMapping.where],
						innerJoin: [...reduced.innerJoin, ...andMapping.innerJoin],
						outerJoin: [...reduced.outerJoin, ...andMapping.outerJoin],
						json: [...reduced.json, ...andMapping.json],
						select: new Set([...reduced.select, ...andMapping.select]),
						rawSelect: new Set([...reduced.rawSelect, ...andMapping.rawSelect]),
						values: { ...reduced.values, ...andMapping.values },
						orderBy: [...reduced.orderBy, ...andMapping.orderBy],
					};
					mapping._or.push(expanded);
					mapping.values = { ...mapping.values, ...expanded.values };
				}
			} else {
				mapping._or.push(reduced);
				mapping.values = { ...mapping.values, ...reduced.values };
			}
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
		customFields,
	}: ClassOperationInputType<T>): void {
		logger.log('FilterProcessor - _and - gqlFilters', gqlFilters);

		const { ands, ors } = (Array.isArray(gqlFilters) ? gqlFilters : [gqlFilters]).reduce(
			(acc, f, i) => {
				const mapped = this.recursiveMapFunction({
					entityMetadata,
					gqlFilters: [f],
					parentAlias,
					alias,
					customFields,
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

	/**
	 * Handles _exists operations.
	 *
	 * The filter value is an object where each key is a relationship field name
	 * and each value is a filter for the related entity. Multiple keys are
	 * AND-combined — each produces a separate `EXISTS (...)` clause.
	 *
	 * @example
	 * ```graphql
	 * filter: {
	 *   _exists: {
	 *     books: { name: 'The Hobbit' },
	 *     ring: { name: 'The One Ring' }
	 *   }
	 * }
	 * ```
	 * Generates:
	 * ```sql
	 * WHERE EXISTS (SELECT 1 FROM books WHERE ...) AND EXISTS (SELECT 1 FROM rings WHERE ...)
	 * ```
	 */
	public _exists<T>({
		entityMetadata,
		gqlFilters,
		parentAlias,
		alias,
		fieldName,
		mapping,
		mappings,
	}: ClassOperationInputType<T>): void {
		this.processExistsOperation<T>(
			entityMetadata,
			gqlFilters,
			parentAlias,
			alias,
			mapping,
			mappings,
			false
		);
	}

	/**
	 * Handles _not_exists operations.
	 *
	 * Same as _exists but generates `NOT EXISTS (...)` clauses.
	 * Multiple keys are AND-combined.
	 *
	 * @example
	 * ```graphql
	 * filter: {
	 *   _not_exists: {
	 *     books: { name: 'The Hobbit' }
	 *   }
	 * }
	 * ```
	 * Generates:
	 * ```sql
	 * WHERE NOT EXISTS (SELECT 1 FROM books WHERE ...)
	 * ```
	 */
	public _not_exists<T>({
		entityMetadata,
		gqlFilters,
		parentAlias,
		alias,
		fieldName,
		mapping,
		mappings,
	}: ClassOperationInputType<T>): void {
		this.processExistsOperation<T>(
			entityMetadata,
			gqlFilters,
			parentAlias,
			alias,
			mapping,
			mappings,
			true
		);
	}

	/**
	 * Shared implementation for _exists and _not_exists.
	 * Iterates over each relationship key in the filter value and generates
	 * an EXISTS (or NOT EXISTS) subquery per key, AND-combined.
	 */
	protected processExistsOperation<T>(
		entityMetadata: EntityMetadata<T>,
		gqlFilters: any,
		parentAlias: Alias,
		alias: Alias,
		mapping: MappingsType,
		mappings: Map<string, MappingsType>,
		negate: boolean
	): void {
		const { properties, primaryKeys } = entityMetadata;

		if (typeof gqlFilters !== 'object' || gqlFilters === null) {
			return;
		}

		for (const relFieldName of keys(gqlFilters)) {
			const filterValue = gqlFilters[relFieldName];
			if (filterValue === undefined || filterValue === null) {
				continue;
			}

			const fieldProps = properties[relFieldName as keyof typeof properties];
			if (!fieldProps) {
				logger.warn(
					'FilterProcessor - processExistsOperation: field',
					relFieldName,
					'not found in entity properties'
				);
				continue;
			}

			const referenceField =
				this.metadataProvider.exists(fieldProps.type) &&
				this.metadataProvider.getMetadata<any, any>(fieldProps.type);

			if (!referenceField) {
				logger.warn(
					'FilterProcessor - processExistsOperation: no metadata for field type',
					fieldProps.type
				);
				continue;
			}

			// Use a temporary mapping to capture the EXISTS subquery
			const tempMapping = QueriesUtils.newMappings();
			tempMapping.alias = alias;

			this.handleReferenceFieldFilter<T>(
				fieldProps,
				referenceField,
				alias,
				parentAlias,
				filterValue,
				tempMapping,
				primaryKeys,
				relFieldName
			);

			// tempMapping.where now contains the "exists (...)" string
			for (const whereClause of tempMapping.where) {
				if (negate) {
					const negated = whereClause.replace(/^exists\s*\(/i, 'not exists (');
					mapping.where.push(negated);
				} else {
					mapping.where.push(whereClause);
				}
			}
			mapping.values = { ...mapping.values, ...tempMapping.values };
		}
	}

	/**
	 * Attempts to detect and handle a count field filter.
	 * Returns true if the filter key matches a count field, false otherwise.
	 *
	 * Handles forms like:
	 * - bookCount: 4 (implicit _eq)
	 * - bookCount_eq: 4
	 * - bookCount_gt: 3
	 * - BookCount: { _gt: 3 } (nested object)
	 */
	protected tryMapCountFieldFilter<T>(
		gqlFieldNameKey: string,
		filterValue: any,
		entityMetadata: EntityMetadata<T>,
		parentAlias: Alias,
		alias: Alias,
		mappings: Map<string, MappingsType>,
		customFields: CustomFieldsSettings<T> | undefined,
		isFieldFilter?: boolean
	): boolean {
		const gqlEntityName = getGQLEntityNameFor(entityMetadata.name ?? '');
		const countFields = getCountFieldsFor(gqlEntityName);

		if (Object.keys(countFields).length === 0) {
			return false;
		}

		// Try to match the filter key against count field names with operators
		const numericOps = ['_eq', '_ne', '_gt', '_gte', '_lt', '_lte'] as const;
		for (const [countFieldName, countMeta] of Object.entries(countFields)) {
			// Check: bookCount_eq, bookCount_gt, etc.
			const opSuffix = numericOps.find((k) => gqlFieldNameKey === countFieldName + k);

			// Check: BookCount (capitalized, nested object form)
			const capitalizedCountFieldName = countFieldName[0].toUpperCase() + countFieldName.slice(1);

			if (opSuffix) {
				this.applyCountFilterOperation(
					countMeta,
					entityMetadata,
					parentAlias,
					alias,
					mappings,
					opSuffix,
					filterValue
				);
				return true;
			}

			if (gqlFieldNameKey === countFieldName && isPrimitive(filterValue)) {
				this.applyCountFilterOperation(
					countMeta,
					entityMetadata,
					parentAlias,
					alias,
					mappings,
					'_eq',
					filterValue
				);
				return true;
			}

			if (gqlFieldNameKey === capitalizedCountFieldName && typeof filterValue === 'object') {
				for (const opKey of keys(filterValue ?? {})) {
					const matchedOp = numericOps.find((k) => k === opKey);
					if (matchedOp) {
						this.applyCountFilterOperation(
							countMeta,
							entityMetadata,
							parentAlias,
							alias,
							mappings,
							matchedOp,
							(filterValue as any)[opKey]
						);
					}
				}
				return true;
			}
		}

		return false;
	}

	/**
	 * Generates a WHERE clause comparing a COUNT subquery against a value.
	 * SQL: `(SELECT COUNT(*) FROM ... WHERE <join>) <operator> :param`
	 */
	protected applyCountFilterOperation<T>(
		countMeta: CountFieldMeta,
		entityMetadata: EntityMetadata<T>,
		parentAlias: Alias,
		alias: Alias,
		mappings: Map<string, MappingsType>,
		operation: string,
		value: any
	): void {
		const mapping = QueriesUtils.getMapping(mappings, countMeta.countFieldName);
		mapping.alias = alias;

		const countSubquery = this.buildCountSubquerySQL(countMeta, entityMetadata, parentAlias, alias);

		if (!countSubquery) {
			logger.warn(
				'FilterProcessor - applyCountFilterOperation: could not build count subquery for',
				countMeta.countFieldName
			);
			return;
		}

		const valueAlias = this.aliasManager.next(AliasType.value, countMeta.countFieldName);
		const paramRef = `${this.namedParameterPrefix}${valueAlias.toParamName(1)}`;

		const opFunc = FieldOperations[operation as keyof FieldOperationsType];
		if (!opFunc) {
			logger.warn('FilterProcessor - unknown operation for count filter:', operation);
			return;
		}

		const { where, value: valOverride } = opFunc([countSubquery, paramRef], ['', value]);
		mapping.where.push(where);
		mapping.values = {
			...mapping.values,
			...(valOverride ?? { [valueAlias.toParamName(1)]: value }),
		};

		logger.log(
			'FilterProcessor - applyCountFilterOperation',
			countMeta.countFieldName,
			operation,
			value,
			'where',
			where
		);
	}

	/**
	 * Builds a COUNT(*) correlated subquery for use in WHERE clauses.
	 * Returns the SQL string (without alias), e.g.:
	 * `(select count(*) from "books" as e_w1 where e_w1.author_id = a_1.id)`
	 */
	protected buildCountSubquerySQL<T>(
		countMeta: CountFieldMeta,
		entityMetadata: EntityMetadata<T>,
		parentAlias: Alias,
		alias: Alias
	): string | null {
		const { relationshipFieldName, relatedEntityName } = countMeta;
		const relatedName = relatedEntityName();

		if (!this.metadataProvider.exists(relatedName)) {
			return null;
		}

		const relatedMetadata = this.metadataProvider.getMetadata<any, EntityMetadata<any>>(
			relatedName
		);
		const fieldProps =
			entityMetadata.properties[relationshipFieldName as keyof typeof entityMetadata.properties];

		if (!fieldProps) {
			return null;
		}

		const countAlias = this.aliasManager.next(AliasType.entity, 'w');

		let joinCondition = '';
		if (
			fieldProps.reference === ReferenceType.ONE_TO_MANY ||
			fieldProps.reference === ReferenceType.ONE_TO_ONE
		) {
			const refFieldProps = relatedMetadata.properties[
				fieldProps.mappedBy as keyof typeof relatedMetadata.properties
			] as EntityProperty;
			const ons = refFieldProps.joinColumns;
			const entityOns = refFieldProps.referencedColumnNames;
			joinCondition = entityOns
				.map((o, i) => `${parentAlias.toColumnName(o)} = ${countAlias.toColumnName(ons[i])}`)
				.join(' and ');
		} else if (fieldProps.reference === ReferenceType.MANY_TO_ONE) {
			const ons = relatedMetadata.primaryKeys;
			const entityOns = fieldProps.fieldNames;
			joinCondition = entityOns
				.map((o, i) => `${parentAlias.toColumnName(o)} = ${countAlias.toColumnName(ons[i])}`)
				.join(' and ');
		} else if (fieldProps.reference === ReferenceType.MANY_TO_MANY) {
			const pivotCols = fieldProps.joinColumns;
			const inverseCols = fieldProps.inverseJoinColumns;
			const pivotSubquery = `select ${inverseCols.join(', ')} from ${fieldProps.pivotTable} where ${pivotCols.map((c, i) => `${parentAlias.toColumnName(entityMetadata.primaryKeys[i])} = ${fieldProps.pivotTable}.${c}`).join(' and ')}`;
			joinCondition = `(${relatedMetadata.primaryKeys.map((c) => countAlias.toColumnName(c)).join(', ')}) in (${pivotSubquery})`;
		}

		if (!joinCondition) {
			return null;
		}

		return `(select count(*) from "${relatedMetadata.tableName}" as ${countAlias.toString()} where ${joinCondition})`.replaceAll(
			/[ \n\t]+/gi,
			' '
		);
	}

	private processRegularFieldFilter<T>(
		properties: { [key in (string & keyof T) | string]: EntityProperty },
		customFields: CustomFieldsSettings<T> | undefined,
		gqlFieldNameKey: string,
		filterValue: any,
		mappings: Map<string, MappingsType>,
		alias: Alias,
		parentAlias: Alias,
		primaryKeys: string[],
		entityMetadata?: EntityMetadata<T>
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

		if (
			!fieldNameKey &&
			customFieldProps &&
			'mapping' in customFieldProps &&
			customFieldProps.mapping &&
			entityMetadata
		) {
			this.handleMappedCustomFieldFilter<T>(
				customFieldProps as {
					mapping: {
						refEntity: new () => any;
						refFields: string | string[];
						fields: string | string[];
					};
				},
				entityMetadata,
				gqlFieldNameKey,
				filterValue,
				mappings,
				alias,
				parentAlias,
				primaryKeys
			);
			return;
		}

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

		logger.log(
			'FilterProcessor - processRegularFieldFilter - referenceField',
			{ fieldProps },
			referenceField,
			{
				filterValue,
			}
		);
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
		} else {
			logger.warn(
				'FilterProcessor - processRegularFieldFilter - filterValue is undefined for field',
				gqlFieldNameKey,
				{ filterValue }
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
			outerJoin,
			where: whereWithValues,
			values,
			innerJoin,
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
				outerJoin,
				innerJoin,
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
				outerJoin,
				innerJoin,
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
				outerJoin,
				innerJoin,
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

	protected handleMappedCustomFieldFilter<T>(
		customFieldProps: {
			mapping: {
				refEntity: new () => any;
				refFields: string | string[];
				fields: string | string[];
			};
		},
		entityMetadata: EntityMetadata<T>,
		gqlFieldNameKey: string,
		filterValue: any,
		mappings: Map<string, MappingsType>,
		parentAlias: Alias,
		alias: Alias,
		primaryKeys: string[]
	): void {
		const { refEntity, refFields: rawRefFields, fields: rawLocalFields } = customFieldProps.mapping;
		const refFields = Array.isArray(rawRefFields) ? rawRefFields : [rawRefFields];
		const localFields = Array.isArray(rawLocalFields) ? rawLocalFields : [rawLocalFields];
		const refEntityName = refEntity.name;

		if (!this.metadataProvider.exists(refEntityName)) {
			throw new Error(`Reference entity ${refEntityName} not found in metadata for mapped filter`);
		}

		const refMetadata = this.metadataProvider.getMetadata<any, EntityMetadata<any>>(refEntityName);
		const childAlias = this.aliasManager.next(AliasType.entity, 'w');

		const recursiveMapResults = this.recursiveMapFunction({
			entityMetadata: refMetadata,
			parentAlias: alias,
			alias: childAlias,
			gqlFilters: [filterValue],
		});

		const {
			outerJoin,
			where: whereWithValues,
			values,
			innerJoin,
			_or,
		} = QueriesUtils.mappingsReducer(recursiveMapResults);

		const localSqlCols = localFields.map(
			(localProp) =>
				entityMetadata.properties[localProp as keyof typeof entityMetadata.properties]
					?.fieldNames?.[0] ?? String(localProp)
		);
		const refSqlCols = refFields.map(
			(refProp) => refMetadata.properties[refProp]?.fieldNames?.[0] ?? String(refProp)
		);

		if (localSqlCols.length !== refSqlCols.length) {
			throw new Error(
				`Mapped filter column count mismatch: ${localSqlCols.length} local !== ${refSqlCols.length} ref`
			);
		}

		const joinCondition = localSqlCols
			.map(
				(localCol, i) =>
					`${parentAlias.toColumnName(localCol)} = ${childAlias.toColumnName(refSqlCols[i])}`
			)
			.join(' and ');

		logger.log(
			'FilterProcessor - handleMappedCustomFieldFilter',
			gqlFieldNameKey,
			'joinCondition',
			joinCondition,
			'childAlias',
			childAlias.toString()
		);

		if (
			joinCondition.length > 0 &&
			(innerJoin.length > 0 || whereWithValues.length > 0 || outerJoin.length > 0 || _or.length > 0)
		) {
			const unionAll = SQLBuilder.buildUnionAll(
				[],
				refMetadata.tableName,
				childAlias,
				innerJoin,
				outerJoin,
				joinCondition,
				whereWithValues,
				_or,
				this.buildManyToOneJoin.bind(this)
			);

			const subquery =
				unionAll.length > 0
					? unionAll.map((q: string) => `(${q})`).join(' union all ')
					: this.buildManyToOneJoin(
							[],
							childAlias,
							refMetadata.tableName,
							innerJoin,
							outerJoin,
							joinCondition,
							whereWithValues
						);

			const existsSQL = `exists (${subquery})`.replaceAll(/[ \n\t]+/gi, ' ');

			const mapping = QueriesUtils.getMapping(mappings, gqlFieldNameKey);
			mapping.alias = alias;
			mapping.where.push(existsSQL);
			mapping.values = { ...mapping.values, ...values };

			logger.log(
				'FilterProcessor - handleMappedCustomFieldFilter: existsSQL',
				existsSQL,
				'values',
				values
			);
		}
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
				: // Id: { _eq }
					gqlFieldNameKey.charAt(0).toLowerCase() + gqlFieldNameKey.slice(1);

		if (fieldNameBeforeOperation) {
			const fieldProps = properties[fieldNameBeforeOperation as keyof typeof properties];
			const fieldMetadata = this.metadataProvider.exists(fieldProps?.type)
				? this.metadataProvider.getMetadata(fieldProps!.type)
				: null;
			logger.log(
				'FilterProcessor - mapFieldOperation: fieldProps',
				fieldProps,
				'fieldMetadata',
				fieldMetadata,
				'fieldValue',
				fieldValue
			);
			if (fieldMetadata) {
				const processed = this.processRegularFieldFilter(
					properties,
					undefined,
					fieldNameBeforeOperation,
					{ [`${fieldProps.referencedColumnNames[0]}${fieldOperation}`]: fieldValue },
					mappings,
					alias,
					alias,
					fieldMetadata.primaryKeys
				);
				logger.log(
					'FilterProcessor - mapFieldOperation: field',
					fieldNameBeforeOperation,
					'operation',
					fieldOperation,
					'value',
					fieldValue,
					'alias',
					alias.toString(),
					'processed',
					{ processed }
				);
			}
		}
		if (
			Array.isArray(fieldValue) &&
			fieldNameBeforeOperation in properties &&
			(fieldOperation as keyof FieldOperationsType) !== '_in' &&
			(fieldOperation as keyof FieldOperationsType) !== '_nin'
		) {
			logger.log(
				'FilterProcessor - mapFieldOperation: array value processing for field',
				fieldNameBeforeOperation
			);
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

						const { where, value } = FieldOperations[fieldOperation as keyof FieldOperationsType](
							[alias.toColumnName(fieldName), ...values],
							['', ...fieldValue]
						);
						mapping.values = { ...mapping.values, ...value };
						return where;
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

			const calcs = fieldNames.map((fieldName) =>
				FieldOperations[fieldOperation as keyof FieldOperationsType](
					[
						alias.toColumnName(fieldName),
						`${this.namedParameterPrefix}${nextValueAlias.toParamName(1)}`,
					],
					['', ...(Array.isArray(fieldValue) ? fieldValue : [fieldValue])]
				)
			);
			mapping.where.push(...calcs.map((c) => c.where));
			const valuesOverride = calcs.reduce((acc, { value }) => ({ ...acc, ...value }), {});

			if (keys(valuesOverride).length > 0) {
				mapping.values = {
					...mapping.values,
					...valuesOverride,
				};
			} else {
				mapping.values[nextValueAlias.toParamName(1)] = fieldValue;
			}
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
		fieldOperation: string & keyof FieldOperationsType;
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

		const calc = FieldOperations[fieldOperation](
			[filterFieldWithAlias, this.namedParameterPrefix + filterParameterName],
			['_', filterValue]
		);
		const { value: valOverride, where } = calc;
		const value = valOverride ?? { [filterParameterName]: filterValue };

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
					join: current.outerJoin.concat(obj.outerJoin),
					innerJoin: current.innerJoin.concat(obj.innerJoin),
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
		outerJoin: string[],
		innerJoin: string[],
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
			(innerJoin.length > 0 || whereWithValues.length > 0 || outerJoin.length > 0 || _or.length > 0)
		) {
			const unionAll = SQLBuilder.buildUnionAll(
				[],
				referenceField.tableName,
				alias,
				innerJoin,
				outerJoin,
				whereSQL,
				whereWithValues,
				_or,
				this.buildOneToXJoin
			);

			const subquery =
				unionAll.length > 0
					? unionAll.map((q) => `(${q})`).join(' union all ')
					: this.buildOneToXJoin(
							[],
							alias,
							referenceField.tableName,
							innerJoin,
							outerJoin,
							whereSQL,
							whereWithValues
						);

			const existsSQL = `exists (${subquery})`.replaceAll(/[ \n\t]+/gi, ' ');

			logger.log('FilterProcessor - mapFilterOneToX', gqlFieldName, 'existsSQL', existsSQL);

			mapping.where.push(existsSQL);
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
		outerJoin: string[],
		innerJoin: string[],
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
				(innerJoin.length > 0 ||
					whereWithValues.length > 0 ||
					outerJoin.length > 0 ||
					_or.length > 0)
			) {
				const unionAll = SQLBuilder.buildUnionAll(
					[],
					referenceField.tableName,
					alias,
					innerJoin,
					outerJoin,
					whereSQL,
					whereWithValues,
					_or,
					this.buildManyToOneJoin
				);

				logger.log('FilterProcessor - mapFilterManyToOne: whereSQL', alias.toString(), unionAll);

				const subquery =
					unionAll.length > 0
						? unionAll.map((q) => `(${q})`).join(' union all ')
						: this.buildManyToOneJoin(
								[],
								alias,
								referenceField.tableName,
								innerJoin,
								outerJoin,
								whereSQL,
								whereWithValues
							);

				const existsSQL = `exists (${subquery})`.replaceAll(/[ \n\t]+/gi, ' ');

				mapping.where.push(existsSQL);
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
		outerJoin: string[],
		innerJoin: string[],
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
			innerJoin.length,
			whereWithValues.length,
			outerJoin.length,
			_or.length
		);

		if (
			pivotTableWhereSQLs.length > 0 &&
			(innerJoin.length > 0 || whereWithValues.length > 0 || outerJoin.length > 0 || _or.length > 0)
		) {
			const ptAlias = this.aliasManager.next(AliasType.entity, 'pt');
			const ptSQL = `select ${fieldProps.inverseJoinColumns.join(', ')} 
					from ${fieldProps.pivotTable}
						${outerJoin.join(' \n')}
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
				innerJoin,
				outerJoin.concat(`inner join ${ptAlias} on ${onSQL}`),
				'',
				whereWithValues,
				_or,
				this.buildManyToManyPivotTable
			);

			const whereSQL = `(${referenceField.primaryKeys.join(', ')}) in (${ptSQL})`;
			const subquery =
				unionAll.length > 0
					? `with ${ptAlias} as (${ptSQL}) ${unionAll.map((q) => `(${q})`).join(' union all ')}`
					: this.buildManyToManyPivotTable(
							[alias.toColumnName('*')],
							alias,
							referenceField.tableName,
							innerJoin,
							outerJoin,
							whereSQL,
							whereWithValues
						);

			const existsSQL = `exists (${subquery})`.replaceAll(/[ \n\t]+/gi, ' ');

			logger.log('FilterProcessor - mapFilterManyToMany: existsSQL', alias.toString(), existsSQL);

			mapping.where.push(existsSQL);
			mapping.values = { ...mapping.values, ...values };
		}
	}

	/**
	 * Builds the inner query for One-to-X EXISTS filters.
	 * Selects 1 since we only need existence, not the actual rows.
	 */
	protected buildOneToXJoin(
		_fields: string[],
		alias: Alias,
		tableName: string,
		innerJoin: string[],
		outerJoin: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?: { innerJoin: string } | { where: string }
	): string {
		return `select 1
					from "${tableName}" as ${alias}
					${innerJoin.join(' \n')}
					${value && 'innerJoin' in value ? value.innerJoin : ''}
					${outerJoin.join(' \n')}
				where ${whereSQL}
				${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
				${value && 'where' in value ? `and ${value.where}` : ''}
				limit 1`.replaceAll(/[ \n\t]+/gi, ' ');
	}

	/**
	 * Builds the inner query for Many-to-One EXISTS filters.
	 * Selects 1 since we only need existence, not the actual rows.
	 */
	protected buildManyToOneJoin(
		_fields: string[],
		alias: Alias,
		tableName: string,
		innerJoin: string[],
		outerJoin: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?: { innerJoin: string } | { where: string }
	): string {
		return `select 1
					from "${tableName}" as ${alias}
					${innerJoin.join(' \n')}
					${value && 'innerJoin' in value ? value.innerJoin : ''}
					${outerJoin.join(' \n')}
				where ${whereSQL}
				${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
				${value && 'where' in value ? `and ${value.where}` : ''}
				limit 1`.replaceAll(/[ \n\t]+/gi, ' ');
	}

	/**
	 * Builds the inner query for Many-to-Many EXISTS filters.
	 * Selects 1 since we only need existence, not the actual rows.
	 */
	protected buildManyToManyPivotTable(
		_fieldNames: string[],
		alias: Alias,
		tableName: string,
		innerJoin: string[],
		outerJoin: string[],
		whereSQL: string,
		whereWithValues: string[],
		value?: { innerJoin: string } | { where: string }
	): string {
		return `select 1
					from "${tableName}" as ${alias.toString()}
					${value && 'innerJoin' in value ? value.innerJoin : ''}
					${innerJoin.join(' \n')}
					${outerJoin.join(' \n')}
				${whereSQL.length > 0 ? ` where ${whereSQL}` : ''}
				${whereWithValues.length > 0 ? ` and ( ${whereWithValues.join(' and ')} )` : ''}
				${value && 'where' in value ? `and ${value.where}` : ''}
				limit 1`.replaceAll(/[ \n\t]+/gi, ' ');
	}
}
