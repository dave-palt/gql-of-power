import { getCountFieldsFor, getFieldByAlias, getGQLEntityNameFor } from '../entities';
import {
	CountFieldMeta,
	CustomFieldSettings,
	CustomFieldsSettings,
	EntityMetadata,
	EntityProperty,
	Fields,
	FieldSelection,
	GQLEntityFilterInputFieldType,
	GQLEntityPaginationInputType,
	MappingsType,
	mappingsTypeToString,
	MetadataProviderType,
	ReferenceType,
	RelatedFieldSettings,
} from '../types';
import { keys } from '../utils';
import { logger } from '../variables';
import { Alias, AliasManager, AliasType } from './alias';
import { FilterProcessor } from './filter-processor';
import { RelationshipHandler } from './relationship-handler';
import { SQLBuilder } from './sql-builder';
import { QueriesUtils } from './utils';

const DEFAULT_LIMIT_ENV = parseInt(process.env.D3GOP_DEFAULT_QUERY_LIMIT ?? '');
const DEFAULT_LIMIT = isNaN(+DEFAULT_LIMIT_ENV) ? 3_000 : +DEFAULT_LIMIT_ENV;

export type QueryAndBindings = { querySQL: string; bindings: any };

export class GQLtoSQLMapper {
	private Alias = new AliasManager();
	private filterProcessor: FilterProcessor;
	private relationshipHandler: RelationshipHandler;

	private exists: MetadataProviderType['exists'];
	private getMetadata: MetadataProviderType['getMetadata'];
	private namedParameterPrefix: string;

	constructor(
		metadataProvider: MetadataProviderType,
		opts: { namedParameterPrefix?: string } = { namedParameterPrefix: ':' }
	) {
		this.exists = metadataProvider.exists;
		this.getMetadata = metadataProvider.getMetadata;
		this.namedParameterPrefix = opts?.namedParameterPrefix ?? ':';

		this.filterProcessor = new FilterProcessor(
			this.Alias,
			metadataProvider,
			this.recursiveMap.bind(this),
			this.namedParameterPrefix
		);
		this.relationshipHandler = new RelationshipHandler();
	}

	public buildQueryAndBindingsFor<T, K>({
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

		this.Alias = new AliasManager();
		const alias = this.Alias.start('a');
		const metadata = this.getMetadata(entity.name) as EntityMetadata<T>;

		const allFilters = filter ? [filter] : [];

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
			gqlFilters: allFilters,
		});
		logger.log('recursiveMapResults', recursiveMapResults);
		const mapping = QueriesUtils.mappingsReducer(recursiveMapResults);
		const { select, rawSelect, json, innerJoin, outerJoin, where, values, _or, _and } = mapping;
		logger.log(
			'GQLtoSQLMapper - buildQueryAndBindingsFor - mapping',
			mappingsTypeToString(mapping, true),
			{ select }
		);

		const orderByFields = (pagination?.orderBy ?? [])
			.map((obs) =>
				keys(obs)
					.map((ob) => {
						const fieldName = getFieldByAlias(entity.name, ob);
						return (
							metadata.properties[fieldName]?.fieldNames
								?.map((fieldName) => `${alias.toString()}.${fieldName}`)
								?.join(', ') ?? `${alias.toString()}.${fieldName}`
						);
					})
					.flat()
			)
			.flat();

		// Order-by fields must also be in the inner rawSelect subquery so the outer query can reference them
		orderByFields.forEach((f) => rawSelect.add(f));
		logger.log('orderByFields', orderByFields, 'select', select, 'orderBy');
		const selectFields = [...new Set(orderByFields.concat(Array.from(select)).concat(json))];

		const rawSelectArr = [...rawSelect];
		const unionAllEntries = [..._or, ..._and];

		let queryBody: string;
		if (unionAllEntries.length > 0) {
			const unionBranches = unionAllEntries.map(({ innerJoin: orInnerJoin, where: orWheres }) => {
				const allInnerJoins = [...innerJoin, ...orInnerJoin];
				const allWhere = [...where, ...orWheres];
				return SQLBuilder.buildInnerBranch(
					rawSelectArr,
					metadata.tableName,
					alias,
					allInnerJoins,
					allWhere
				);
			});

			const innerUnion = unionBranches.map((q) => `(${q})`).join(' union all ');

			queryBody = `select ${selectFields.join(', ')} from ( select distinct * from (${innerUnion}) as ${alias.toString()}_u ) as ${alias.toString()} ${outerJoin.join(' \n')}`;
		} else {
			queryBody = SQLBuilder.buildSubQuery(
				selectFields,
				rawSelectArr,
				metadata.tableName,
				alias,
				innerJoin,
				outerJoin,
				where
			);
		}

		const querySQL = `${queryBody}
		${
			pagination?.orderBy
				? SQLBuilder.buildOrderBySQL(pagination.orderBy, SQLBuilder.getFieldMapper(metadata, alias))
				: ''
		}
		${pagination?.limit ? `limit ${this.namedParameterPrefix}limit` : ``}
		${pagination?.offset ? `offset ${this.namedParameterPrefix}offset` : ``}`.replaceAll(
			/[ \n\t]+/gi,
			' '
		);

		logger.log(logName, 'sourceDataSQL', unionAllEntries.length);

		logger.log(logName, 'final querySQL', querySQL);

		const bindings = {
			...values,
			limit: DEFAULT_LIMIT,
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
		gqlFilters = [],
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
		/**
		 * @deprecated not used anymore
		 */
		parentGqlFieldNameKey?: string;
		isFieldFilter?: boolean;
	}) => {
		const prePrefix = isFieldFilter ? 'FF-' : '';
		const logPrefix = alias.concat(prePrefix + 'GQLtoSQLMapper - recursiveMap');
		logger.log(logPrefix, 'start');
		const { properties, primaryKeys, tableName } = entityMetadata;

		const definedFields = fields ?? {};
		const fieldKeys = keys(definedFields);

		console.warn(
			'[DIAG recursiveMap] entity:',
			entityMetadata.name,
			'property keys:',
			Object.keys(properties),
			'fieldKeys from query:',
			fieldKeys
		);

		const allFields =
			primaryKeys.reduce(
				(acc, pk) =>
					fieldKeys.some((fk) => getFieldByAlias(entityMetadata.name, fk) === pk)
						? acc
						: {
								...acc,
								[pk]: {
									name: pk,
									alias: pk,
								},
							},
				definedFields
			) ?? definedFields;

		let res = keys(allFields).reduce(
			({ mappings }, gqlFieldNameKey) => {
				logger.log('========================== FIELD ==========================', {
					gqlFieldNameKey,
					entityMetadata: {
						name: entityMetadata.name,
						tableName,
						properties: Object.keys(properties),
					},
				});
				if (typeof allFields[gqlFieldNameKey] !== 'object' || allFields[gqlFieldNameKey] === null) {
					logger.warn(
						logPrefix,
						`- skipping field ${gqlFieldNameKey} as it is not an object`,
						allFields[gqlFieldNameKey]
					);
					return { mappings };
				}
				const { args, fieldsByTypeName, name, alias: gqlFieldAlias } = allFields[gqlFieldNameKey];
				const decoratorAlias = getFieldByAlias(entityMetadata.name, gqlFieldNameKey);
				const fieldName =
					decoratorAlias !== gqlFieldNameKey
						? decoratorAlias
						: ((name as string | undefined) ?? gqlFieldNameKey);
				logger.log(logPrefix, '- mapFilter for', gqlFieldNameKey, 'alias for', fieldName);

				logger.log('==========================', name, '==========================');
				logger.log('args', args, { name, gqlFieldAlias }, { fieldName });

				const mapping = QueriesUtils.getMapping(mappings, fieldName);

				const countFieldMeta = getCountFieldsFor(getGQLEntityNameFor(entityMetadata.name ?? ''))[
					fieldName
				];
				if (countFieldMeta) {
					this.mapCountField<T>(countFieldMeta, mapping, alias, entityMetadata, args);
					return { mappings };
				}

				if (args) {
					this.handleFieldArguments<T>(fieldName, args, alias, entityMetadata, mapping);
				}

				logger.log(logPrefix, '- using mapping for', fieldName, mappingsTypeToString(mapping));
				const customFieldProps =
					customFields && fieldName in customFields
						? customFields[fieldName as keyof typeof customFields]
						: undefined;

				const fieldProps =
					properties[fieldName as keyof EntityMetadata<T>['properties']] ??
					properties[customFieldProps?.requires as keyof EntityMetadata<T>['properties']];

				logger.warn(
					'[DIAG]',
					fieldName,
					'fieldProps found:',
					!!fieldProps,
					'customFieldProps found:',
					!!customFieldProps,
					fieldProps
						? {
								type: fieldProps.type,
								reference: fieldProps.reference,
								fieldNames: fieldProps.fieldNames,
							}
						: 'N/A'
				);

				const gqlFieldName = (customFieldProps?.requires as string) ?? fieldName;
				logger.log('recursiveMap fields | gqlFieldName', gqlFieldName, fieldsByTypeName);

				if (!fieldProps) {
					return this.mapCustomField<T>(
						customFieldProps,
						mapping,
						alias,
						gqlFieldName,
						mappings,
						fieldsByTypeName,
						entityMetadata
					);
				} else {
					this.mapField<T>(
						fieldName,
						fieldProps,
						mapping,
						alias,
						fieldsByTypeName,
						gqlFieldName,
						primaryKeys
					);
					// gqlFieldName === 'battles' &&
					logger.log(
						'=======',
						{ tableName, gqlFieldName, fieldName, name },
						mappingsTypeToString(mapping, true)
					);
					logger.log('');
				}

				return { mappings };
			},
			{ mappings: new Map<string, MappingsType>() }
		);

		logger.log(logPrefix, 'fields processed', allFields, [...res.mappings.entries()]);

		res = gqlFilters.reduce(
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
		gqlFilters.length > 0 && logger.log(logPrefix, 'gqlFilters', gqlFilters);
		res.mappings.size > 0 && logger.log(logPrefix, 'filters processed', res.mappings.entries());

		logger.log(logPrefix, 'end');
		logger.log('');
		return res.mappings;
	};

	private mapCustomField<T>(
		customFieldProps: RelatedFieldSettings<T> | CustomFieldSettings<T> | undefined,
		mapping: MappingsType,
		latestAlias: Alias,
		gqlFieldName: string,
		mappings: Map<string, MappingsType>,
		fieldsByTypeName?: any,
		ownerMetadata?: EntityMetadata<T>
	) {
		// mapping strategy: generate a SQL JOIN to the reference entity
		if (customFieldProps && 'mapping' in customFieldProps && customFieldProps.mapping) {
			const {
				refEntity,
				refFields: rawRefFields,
				fields: rawLocalFields,
			} = customFieldProps.mapping;

			// Normalise single string → array for uniform handling
			const refFields = Array.isArray(rawRefFields) ? rawRefFields : [rawRefFields];
			const localFields = Array.isArray(rawLocalFields) ? rawLocalFields : [rawLocalFields];

			const refEntityName = refEntity.name;

			if (!this.exists(refEntityName)) {
				// Reference entity not registered — fall back to null
				mapping.select.add(`null AS "${gqlFieldName}"`);
				return { mappings, latestAlias };
			}

			const refMetadata = this.getMetadata<any, EntityMetadata<any>>(refEntityName);
			const joinAlias = this.Alias.next(AliasType.field, 'j');

			// Resolve ORM property names to SQL column names via metadata.
			// localSqlCols: FK columns on the owner entity (e.g. 'author_id')
			// refSqlCols: PK/matched columns on the ref entity (e.g. 'id')
			const localSqlCols = localFields.map(
				(localProp) =>
					ownerMetadata?.properties[localProp as keyof typeof ownerMetadata.properties]
						?.fieldNames?.[0] ?? String(localProp)
			);
			const refSqlCols = refFields.map(
				(refProp) => refMetadata.properties[refProp]?.fieldNames?.[0] ?? String(refProp)
			);

			// Build ON clause: owner_alias.fk_col = ref_alias.pk_col
			const where = localSqlCols
				.map((localSqlCol, i) => {
					return `${latestAlias.toColumnName(localSqlCol)} = ${joinAlias.toColumnName(refSqlCols[i])}`;
				})
				.join(' AND ');

			// fieldsByTypeName is keyed by the GQL type name which may have a suffix (e.g. 'AuthorV2').
			// Resolve via getGQLEntityNameFor so the suffix is applied consistently.
			const subFields =
				fieldsByTypeName?.[getGQLEntityNameFor(refEntityName)] ?? fieldsByTypeName?.[refEntityName];
			const newMappings = this.recursiveMap({
				entityMetadata: refMetadata,
				fields: subFields,
				parentAlias: latestAlias,
				alias: joinAlias,
			});

			const {
				select: refSelect,
				outerJoin: refOuterJoin,
				where: refWhere,
				values: refValues,
				innerJoin: refInnerJoin,
			} = QueriesUtils.mappingsReducer(newMappings);

			// Ensure FK column(s) are in both the outer SELECT and the inner rawSelect subquery
			localSqlCols.forEach((sqlCol) => {
				mapping.select.add(latestAlias.toColumnName(sqlCol));
				mapping.rawSelect.add(latestAlias.toColumnName(sqlCol));
			});

			// JSON aggregate — single object (not array), same pattern as RelationshipHandler.mapManyToOne
			mapping.json.push(`${joinAlias.toColumnName('value')} as "${gqlFieldName}"`);

			const selectFields = [
				...new Set(
					refSqlCols.map((sqlCol) => joinAlias.toColumnName(sqlCol)).concat(Array.from(refSelect))
				),
			];

			const jsonSQL = SQLBuilder.generateJsonSelectStatement(joinAlias.toString()); // single object

			const subFromSQL = `(
				select ${selectFields.join(', ')}
				from "${refMetadata.tableName}" as ${joinAlias.toString()}
				${refInnerJoin.join(' \n')}
				where ${where}
				${refWhere.length > 0 ? ` and ( ${refWhere.join(' and ')} )` : ''}
			) as ${joinAlias.toString()}`;

			const leftOuterJoin =
				`left outer join lateral ( select ${jsonSQL} as value from ${subFromSQL} ${refOuterJoin.join(' \n')} ) as ${joinAlias.toString()} on true`.replaceAll(
					/[ \n\t]+/gi,
					' '
				);

			mapping.outerJoin.push(leftOuterJoin);
			mapping.values = { ...mapping.values, ...refValues };
			return { mappings, latestAlias };
		}

		if (customFieldProps?.requires) {
			const requires =
				customFieldProps.requires instanceof Array
					? customFieldProps.requires
					: [customFieldProps.requires];
			requires.forEach((req) => {
				mapping.select.add(`${latestAlias.toString()}.${req} AS "${gqlFieldName}"`);
				mapping.rawSelect.add(`${latestAlias.toString()}.${req}`);
			});
		}
		// Add null field with proper alias
		// This is because if the field is not present in the entity apollo server will not calculate the field
		mapping.select.add(`null AS "${gqlFieldName}"`);
		return { mappings, latestAlias };
	}

	/**
	 * Generates a correlated COUNT(*) subquery for a count field.
	 *
	 * Produces SQL like:
	 * ```sql
	 * (SELECT COUNT(*) FROM "books" AS e_w1 WHERE e_w1.author_id = a_1.id AND <filter>) AS "bookCount"
	 * ```
	 *
	 * The relationship join condition is derived from the entity metadata (same logic as
	 * FilterProcessor's EXISTS subqueries). Optional filter args on the count field are
	 * processed recursively into WHERE conditions within the subquery.
	 */
	protected mapCountField<T>(
		countFieldMeta: CountFieldMeta,
		mapping: MappingsType,
		parentAlias: Alias,
		entityMetadata: EntityMetadata<T>,
		args?: any
	): void {
		const { countFieldName, relationshipFieldName, relatedEntityName } = countFieldMeta;

		const relatedName = relatedEntityName();
		if (!this.exists(relatedName)) {
			mapping.select.add(`0 AS "${countFieldName}"`);
			return;
		}

		const relatedMetadata = this.getMetadata<any, EntityMetadata<any>>(relatedName);
		const fieldProps =
			entityMetadata.properties[relationshipFieldName as keyof typeof entityMetadata.properties];

		if (!fieldProps) {
			logger.warn('mapCountField: relationship field not found', relationshipFieldName);
			mapping.select.add(`0 AS "${countFieldName}"`);
			return;
		}

		const countAlias = this.Alias.next(AliasType.entity, 'w');

		// Build the join condition between parent and child, same logic as FilterProcessor
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
			// For m:n, use a pivot subquery in the join condition
			const pivotCols = fieldProps.joinColumns;
			const inverseCols = fieldProps.inverseJoinColumns;
			const pivotSubquery = `select ${inverseCols.join(', ')} from ${fieldProps.pivotTable} where ${pivotCols.map((c, i) => `${parentAlias.toColumnName(entityMetadata.primaryKeys[i])} = ${fieldProps.pivotTable}.${c}`).join(' and ')}`;
			joinCondition = `(${relatedMetadata.primaryKeys.map((c) => countAlias.toColumnName(c)).join(', ')}) in (${pivotSubquery})`;
		}

		// Process optional filter args
		let filterWhere: string[] = [];
		let filterValues: Record<string, any> = [];
		let filterInnerJoin: string[] = [];
		let filterOuterJoin: string[] = [];
		let filterOr: MappingsType[] = [];

		if (args?.filter) {
			const filterMapped = this.recursiveMap({
				entityMetadata: relatedMetadata,
				parentAlias: countAlias,
				alias: countAlias,
				gqlFilters: [args.filter],
				isFieldFilter: true,
			});

			const reduced = QueriesUtils.mappingsReducer(filterMapped);
			filterWhere = reduced.where;
			filterValues = reduced.values as Record<string, any>;
			filterInnerJoin = reduced.innerJoin;
			filterOuterJoin = reduced.outerJoin;
			filterOr = reduced._or;
		}

		// Build the COUNT subquery
		let subquery: string;

		if (filterOr.length > 0) {
			// When filter has _or branches, use UNION ALL inside the count subquery
			const branches = filterOr.map((orMapping) => {
				const allWhere = [joinCondition, ...filterWhere, ...orMapping.where];
				const allInnerJoin = [...filterInnerJoin, ...orMapping.innerJoin];
				return `select 1 from "${relatedMetadata.tableName}" as ${countAlias.toString()} ${allInnerJoin.join(' \n')} where ${allWhere.join(' and ')}`;
			});
			subquery = `select count(*) from (${branches.map((b) => `(${b})`).join(' union all ')}) as ${countAlias.toString()}_cnt`;
		} else {
			const whereParts = [joinCondition, ...filterWhere].filter((w) => w.length > 0);
			subquery = `select count(*) from "${relatedMetadata.tableName}" as ${countAlias.toString()} ${filterInnerJoin.join(' \n')} ${filterOuterJoin.join(' \n')} ${whereParts.length > 0 ? `where ${whereParts.join(' and ')}` : ''}`;
		}

		subquery = subquery.replaceAll(/[ \n\t]+/gi, ' ').trim();
		mapping.select.add(`(${subquery}) AS "${countFieldName}"`);
		mapping.values = { ...mapping.values, ...filterValues };

		logger.log('mapCountField', countFieldName, 'subquery', subquery);
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

		logger.warn(
			'[DIAG mapField]',
			gqlFieldName,
			'fieldProps.type:',
			fieldProps.type,
			'exists:',
			this.exists(fieldProps.type),
			'reference found:',
			!!referenceField,
			'reference:',
			fieldProps.reference,
			'fieldNames:',
			fieldProps.fieldNames
		);

		if (referenceField) {
			logger.log('GQLtoSQLMapper - recursiveMap - referenceField latest alias', alias.toString());
			const childAlias = this.Alias.next(AliasType.field, 'p');

			// fieldsByTypeName is keyed by the GQL type name which may have a suffix (e.g. 'DriverTruckAllocationV2').
			// Resolve via getGQLEntityNameFor so the suffix is applied consistently.
			const subFields = fields?.[getGQLEntityNameFor(fieldProps.type)] ?? fields?.[fieldProps.type];

			logger.log(
				'recursiveMap || GQLtoSQLMapper - recursiveMap - referenceField latest alias next',
				alias.toString(),
				childAlias.toString()
				// mappingsTypeToString(mapping)
			);

			logger.log(
				'fields[gqlFieldName]',
				fieldProps.type,
				// referenceField,
				'gqlFieldName',
				gqlFieldName,
				'subFields',
				subFields
			);

			const newMappings = this.recursiveMap({
				entityMetadata: referenceField,
				fields: subFields,
				parentAlias: alias,
				alias: childAlias,
				parentGqlFieldNameKey: parentGqlFieldNameKey,
			});

			logger.log(
				'NEW MAPPING:',
				{ parentGqlFieldNameKey, gqlFieldName },
				[...newMappings.keys()],
				mappingsTypeToString(mapping, true)
			);
			const newMapping = QueriesUtils.newMappings();

			// the parent contains the pagination for the child
			if (mapping.limit) {
				newMapping.limit = mapping.limit;
			}
			if (mapping.offset) {
				newMapping.offset = mapping.offset;
			}
			if (mapping.orderBy) {
				newMapping.orderBy = mapping.orderBy;
			}
			const {
				select,
				json,
				outerJoin,
				where: whereWithValues,
				values,
				innerJoin,
				limit,
				offset,
				orderBy,
				...rest
			} = QueriesUtils.mappingsReducer(newMappings, newMapping);

			logger.log(
				'NEW MAPPING reduced:',
				{ parentGqlFieldNameKey, gqlFieldName },
				mappingsTypeToString(
					{
						select,
						json,
						outerJoin,
						where: whereWithValues,
						values,
						innerJoin,
						limit,
						offset,
						orderBy,
						...rest,
					},
					true
				)
			);

			logger.log(
				'GQLtoSQLMapper - recursiveMap - referenceField',
				referenceField.name,
				'innerJoin',
				innerJoin,
				'limit',
				limit,
				'offset',
				offset,
				'orderBy',
				mapping.orderBy,
				'reference',
				fieldProps.reference,
				fields
			);
			if (
				fieldProps.reference === ReferenceType.ONE_TO_MANY ||
				(fieldProps.reference === ReferenceType.ONE_TO_ONE && fieldProps.mappedBy)
			) {
				logger.warn('[DIAG mapField dispatch]', gqlFieldName, '→ mapOneToX');
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
					innerJoin,
					outerJoin
				);
			} else if (
				fieldProps.reference === ReferenceType.MANY_TO_ONE ||
				(fieldProps.reference === ReferenceType.ONE_TO_ONE && !fieldProps.mappedBy)
			) {
				logger.warn(
					'[DIAG mapField dispatch]',
					gqlFieldName,
					'→ mapManyToOne',
					'fieldNames:',
					fieldProps.fieldNames,
					'refTableName:',
					referenceField.tableName
				);
				this.relationshipHandler.mapManyToOne(
					fieldProps,
					referenceField,
					alias,
					childAlias,
					mapping,
					whereWithValues,
					values,
					innerJoin,
					limit,
					offset,
					gqlFieldName,
					select,
					json,
					outerJoin
				);
			} else if (fieldProps.reference === ReferenceType.MANY_TO_MANY) {
				logger.warn('[DIAG mapField dispatch]', gqlFieldName, '→ mapManyToMany');
				this.relationshipHandler.mapManyToMany(
					referenceField,
					primaryKeys,
					fieldProps,
					alias,
					childAlias,
					select,
					whereWithValues,
					outerJoin,
					json,
					mapping,
					gqlFieldName,
					values,
					limit,
					offset,
					orderBy
				);
			} else {
				logger.warn(
					'[DIAG mapField dispatch] UNHANDLED reference type',
					fieldProps.reference,
					'for field',
					gqlFieldName,
					'expected one of:',
					Object.values(ReferenceType)
				);
			}
		} else if (fieldProps.fieldNames.length > 0) {
			logger.log(
				'MAPPING for FIELDS:',
				{ parentGqlFieldNameKey, gqlFieldName },
				mappingsTypeToString(mapping, true)
			);
			this.processFieldNames(alias, fieldProps.fieldNames, mapping, gqlFieldName);
		} else {
			logger.log('reference type', fieldProps.reference, 'not handled for field', gqlFieldName);
		}
	}

	protected handleFieldArguments<T>(
		parentGqlFieldNameKey: string,
		args: any,
		alias: Alias,
		entityMetadata: EntityMetadata<T>,
		mapping: MappingsType
	) {
		const prefix = 'GQLtoSQLMapper - handleFieldArguments';

		logger.log(prefix, 'args', parentGqlFieldNameKey, args);
		// const mapping = QueriesUtils.getMapping(mappings, parentGqlFieldNameKey);

		const { filter, pagination } = args ?? {};

		logger.log(prefix, 'args', parentGqlFieldNameKey, { ...filter }, JSON.stringify(pagination));
		if (filter || pagination) {
			const mapped = this.recursiveMap({
				entityMetadata,
				parentAlias: alias,
				alias,
				gqlFilters: [
					{ [parentGqlFieldNameKey]: { ...filter } } as GQLEntityFilterInputFieldType<T>,
				],
				isFieldFilter: true,
			});

			const { innerJoin, where: w, values, _or, _and, _not } = QueriesUtils.mappingsReducer(mapped);

			mapping.innerJoin.push(...innerJoin);
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
				mappingsTypeToString(mapping, true)
			);
		} else {
			// m.__arguments = __arguments;
		}
		// mappings.set(parentGqlFieldNameKey, m);
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
		mapping.rawSelect.add(fieldNameWithAlias);
		logger.log('field names -----', gqlFieldName, { fieldNames, aliasedField });
	}
}
