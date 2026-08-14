import {
	getCustomFieldsFor,
	getAggregateFieldsFor,
	getCountFieldsFor,
	getMapEnumFieldsFor,
	getMapEnumOutputFieldsFor,
	getMapEnumOutputGlobal,
	getParseJsonFieldsFor,
	getFieldsOptionsFor,
	getFieldByAlias,
	getGQLEntityNameFor,
	getRelationFieldsFor,
} from '../entities/gql-entity';
import {
	AggregateFieldMeta,
	CountFieldMeta,
	CustomFieldSettings,
	CustomFieldsSettings,
	EntityMetadata,
	EntityProperty,
	Fields,
	FieldSelection,
	MetadataProviderType,
	ReferenceType,
	RelatedFieldSettings,
	RequireRelationConfig,
} from '../types/sql-types';
import {
	GQLEntityFilterInputFieldType,
	GQLEntityOrderByInputType,
	GQLEntityPaginationInputType,
} from '../types/gql-types';
import { MappingsType, mappingsTypeToString } from '../types/gql-to-sql-types';
import { keys } from '../utils/object';
import { logger } from '../variables';
import { Alias, AliasManager, AliasType } from './alias';
import {
	buildCorrelatedJoinCondition,
	getRelationCardinality,
	RelationCardinality,
} from './relation-dispatch';
import { convertFilterEnumValues } from './enum-filter-converter';
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

		// Resolve orderBy fields, including nested-object related columns for m:1 relations
		const orderByFields = (pagination?.orderBy ?? [])
			.map((obs) =>
				keys(obs)
					.map((ob) => {
						const value = obs[ob];
						// Handle nested object for related m:1 columns (e.g. { author: { name: 'asc' } })
						if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
							const nestedValue = value as Record<string, any>;
							const subExprs = keys(nestedValue)
								.map((subKey) => {
									const resolved = this.resolveRelatedOrderBy(
										entity.name,
										metadata,
										alias,
										ob,
										subKey
									);
									if (!resolved) return null;
									return {
										expr: resolved.sql,
										isSubquery: true,
										parentColumns: resolved.parentColumns,
									};
								})
								.filter(Boolean) as {
								expr: string;
								isSubquery: true;
								parentColumns: string[];
							}[];
							if (subExprs.length > 0) {
								return subExprs;
							}
						}
						const fieldName = getFieldByAlias(entity.name, ob);
						const expr =
							metadata.properties[fieldName]?.fieldNames
								?.map((fn) => `${alias.toString()}.${fn}`)
								?.join(', ') ?? `${alias.toString()}.${fieldName}`;
						return [{ expr, isSubquery: false, parentColumns: [] }];
					})
					.flat()
			)
			.flat();

		// Order-by fields must also be in the inner rawSelect subquery so the outer query can reference them.
		// Correlated subqueries (related columns) reference parent columns (e.g. e_a1.fellowship_id)
		// that may not be in the SELECT list — those parent columns must also be projected.
		orderByFields.forEach((f) => {
			if (!f.isSubquery) {
				rawSelect.add(f.expr);
			} else if (f.parentColumns) {
				f.parentColumns.forEach((col) => rawSelect.add(col));
			}
		});
		logger.log('orderByFields', orderByFields, 'select', select, 'orderBy');
		// Only flat columns go into selectFields — subquery expressions are ORDER BY-only
		const selectFields = [
			...new Set(
				orderByFields
					.filter((f) => !f.isSubquery)
					.map((f) => f.expr)
					.concat(Array.from(select))
					.concat(json)
			),
		];

		const rawSelectArr = [...rawSelect];
		const unionAllEntries = [..._or, ..._and];

		// Build orderBy SQL — use a custom field mapper that handles related dot-notation
		const orderBySQL = pagination?.orderBy
			? this.buildOrderBySQLWithRelated(metadata, alias, pagination.orderBy)
			: '';
		const innerLimitSQL = pagination?.limit ? `limit ${this.namedParameterPrefix}limit` : '';
		const innerOffsetSQL = pagination?.offset ? `offset ${this.namedParameterPrefix}offset` : '';

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
			const unionOrderBySQL = orderBySQL
				? orderBySQL.replace(new RegExp(`\\b${alias.toString()}\\.`, 'g'), `${alias.toString()}_u.`)
				: '';

			queryBody = `select ${selectFields.join(', ')} from ( select distinct * from (${innerUnion}) as ${alias.toString()}_u ${unionOrderBySQL} ${innerLimitSQL} ${innerOffsetSQL} ) as ${alias.toString()} ${outerJoin.join(' \n')}`;
		} else {
			queryBody = SQLBuilder.buildSubQuery(
				selectFields,
				rawSelectArr,
				metadata.tableName,
				alias,
				innerJoin,
				outerJoin,
				where,
				undefined,
				orderBySQL,
				innerLimitSQL,
				innerOffsetSQL
			);
		}

		const querySQL = `${queryBody}
		${orderBySQL}`.replaceAll(/[ \n\t]+/gi, ' ');

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

	/**
	 * Resolves a nested-object orderBy key (e.g. orderBy: [{ author: { name: 'asc' } }])
	 * into a correlated subquery SQL expression for many-to-one relations.
	 *
	 * Generates: (SELECT e_rel.column FROM rel_table e_rel WHERE parent.fk = e_rel.pk)
	 *
	 * Returns { sql, parentColumns } where parentColumns are the parent-table columns
	 * referenced in the WHERE clause (e.g. ['e_a1.fellowship_id']). The caller must
	 * ensure these columns are projected by any wrapping subquery so the correlated
	 * reference resolves in the outer query too.
	 *
	 * Returns null if the relation is not m:1 (caller falls back to flat resolution).
	 */
	private resolveRelatedOrderBy<T>(
		entityName: string,
		metadata: EntityMetadata<T>,
		parentAlias: Alias,
		relationName: string,
		relatedFieldName: string
	): { sql: string; parentColumns: string[] } | null {
		// Look up the relation property on the current entity
		const relProp = metadata.properties[relationName];
		if (!relProp) return null;

		// Only support FK-on-this-table relations (m:1 + owning 1:1 — clean,
		// unambiguous: exactly one related row). Dispatch via the shared
		// ownership rule so owning-side 1:1 is not silently skipped.
		if (getRelationCardinality(relProp) !== RelationCardinality.MANY_TO_ONE) {
			logger.log(
				'resolveRelatedOrderBy',
				`Skipping orderBy on "${relationName}": relation is not m:1/owning-1:1 (only FK-on-this-table relations supported for related orderBy)`
			);
			return null;
		}

		// Get the related entity metadata
		const relEntityName = relProp.type;
		if (!this.exists(relEntityName)) return null;
		const relMetadata = this.getMetadata<any, EntityMetadata<any>>(relEntityName);
		if (!relMetadata?.tableName) return null;

		// Resolve the FK columns: parent.fieldNames → related.referencedColumnNames
		const fkColumns = relProp.fieldNames; // e.g. ['author_id'] on the parent table
		const refPkColumns =
			relProp.referencedColumnNames.length > 0
				? relProp.referencedColumnNames
				: relMetadata.primaryKeys;
		if (fkColumns.length === 0 || fkColumns.length !== refPkColumns.length) return null;

		// Resolve the related field's actual column name(s)
		const relFieldMeta = relMetadata.properties[relatedFieldName];
		if (!relFieldMeta) return null;

		// Generate correlated subquery
		const relAlias = 'e_o'; // stable alias for orderBy subqueries
		const parentColumns = fkColumns.map((fk) => parentAlias.toColumnName(fk));
		const joinCondition = fkColumns
			.map((fk, i) => `${parentAlias.toColumnName(fk)} = ${relAlias}.${refPkColumns[i]}`)
			.join(' and ');

		const relColumns = relFieldMeta.fieldNames.map((fn) => `${relAlias}.${fn}`).join(', ');

		return {
			sql: `(select ${relColumns} from "${relMetadata.tableName}" as ${relAlias} where ${joinCondition})`,
			parentColumns,
		};
	}

	/**
	 * Builds ORDER BY SQL that handles both flat fields and nested-object related columns.
	 * For nested objects (e.g. { author: { name: 'asc' } }), delegates to resolveRelatedOrderBy.
	 * For flat fields (e.g. { title: 'asc' }), uses the standard field mapper.
	 */
	private buildOrderBySQLWithRelated<T>(
		metadata: EntityMetadata<T>,
		alias: Alias,
		orderBy: GQLEntityOrderByInputType<any>[]
	): string {
		const entityName = metadata.name ?? '';
		const fieldMapper = SQLBuilder.getFieldMapper(metadata, alias);

		const orderClauses = orderBy
			.map((obs) =>
				keys(obs)
					.map((ob) => {
						const value = obs[ob];
						if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
							// Nested object: { relationName: { fieldName: 'asc' } }
							const subKeys = keys(value);
							return subKeys
								.map((subKey) => {
									const direction = value[subKey];
									const resolved = this.resolveRelatedOrderBy(
										entityName,
										metadata,
										alias,
										ob,
										subKey
									);
									if (!resolved) {
										throw new Error(
											`gql-of-power: orderBy key "${ob}.{${subKey}}" cannot be resolved — "${ob}" is not an m:1 / owning-side 1:1 relation and not a scalar field.`
										);
									}
									const columns = [resolved.sql];
									return columns.map((fn) => `${fn} ${direction}`).join(', ');
								})
								.filter((o) => o.length > 0)
								.join(', ');
						}
						// Flat field: { fieldName: 'asc' }
						const columns = fieldMapper(ob);
						return columns.map((fn) => `${fn} ${value}`).join(', ');
					})
					.filter((o) => o.length > 0)
					.join(', ')
			)
			.filter((o) => o.length > 0)
			.join(', ');

		return orderClauses ? `order by ${orderClauses}` : '';
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

		logger.warn(
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

		const parseJsonFields = getParseJsonFieldsFor(getGQLEntityNameFor(entityMetadata.name ?? ''));
		const enumFields = getMapEnumFieldsFor(getGQLEntityNameFor(entityMetadata.name ?? ''));
		const enumOutputOverrides = getMapEnumOutputFieldsFor(
			getGQLEntityNameFor(entityMetadata.name ?? '')
		);
		// Build a set of field names that should use CASE WHEN (key mode).
		// A field uses 'key' mode if: per-field override is 'key', OR no override
		// and the global default is 'key'.
		const globalEnumOutput = getMapEnumOutputGlobal();
		const enumKeyFields = new Set<string>();
		for (const fieldName of Object.keys(enumFields)) {
			const mode = enumOutputOverrides[fieldName] ?? globalEnumOutput;
			if (mode === 'key') enumKeyFields.add(fieldName);
		}

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

				const aggregateFieldMeta = getAggregateFieldsFor(
					getGQLEntityNameFor(entityMetadata.name ?? '')
				)[fieldName];
				if (aggregateFieldMeta) {
					this.mapAggregateField<T>(aggregateFieldMeta, mapping, alias, entityMetadata, args);
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

				const fieldProps = properties[fieldName as keyof EntityMetadata<T>['properties']];

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

				const gqlFieldName = fieldName;
				logger.log('recursiveMap fields | gqlFieldName', gqlFieldName, fieldsByTypeName);

				if (!fieldProps) {
					return this.mapCustomField<T>(
						customFieldProps,
						mapping,
						alias,
						gqlFieldName,
						mappings,
						fieldsByTypeName,
						entityMetadata,
						args
					);
				} else {
					this.mapField<T>(
						fieldName,
						fieldProps,
						mapping,
						alias,
						fieldsByTypeName,
						gqlFieldName,
						primaryKeys,
						parseJsonFields,
						enumFields,
						enumKeyFields
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
		ownerMetadata?: EntityMetadata<T>,
		args?: any
	) {
		// mapping strategy: generate a SQL JOIN to the reference entity (terminal — early-returns)
		if (customFieldProps && 'mapping' in customFieldProps && customFieldProps.mapping) {
			return this.mapCustomFieldWithMapping(
				customFieldProps,
				mapping,
				latestAlias,
				gqlFieldName,
				mappings,
				fieldsByTypeName,
				ownerMetadata
			);
		}

		// requiresRelations strategy: does NOT return — falls through to requires / null-terminator
		if (customFieldProps?.requiresRelations) {
			this.mapCustomFieldWithRequiresRelations(
				customFieldProps,
				mapping,
				latestAlias,
				fieldsByTypeName,
				ownerMetadata,
				args
			);
		}

		if (customFieldProps?.requires) {
			this.mapCustomFieldWithRequires(customFieldProps, mapping, latestAlias, ownerMetadata);
		}

		// Add null field with proper alias
		// This is because if the field is not present in the entity apollo server will not calculate the field
		mapping.select.add(`null AS "${gqlFieldName}"`);
		return { mappings, latestAlias };
	}

	// --- mapCustomField strategy helpers (pure extract-method; bodies copied verbatim) ---

	private mapCustomFieldWithMapping<T>(
		customFieldProps: RelatedFieldSettings<T> | CustomFieldSettings<T>,
		mapping: MappingsType,
		latestAlias: Alias,
		gqlFieldName: string,
		mappings: Map<string, MappingsType>,
		fieldsByTypeName?: any,
		ownerMetadata?: EntityMetadata<T>
	): { mappings: Map<string, MappingsType>; latestAlias: Alias } {
		// Dispatcher guarantees `customFieldProps.mapping` is present (discriminated-union narrowing
		// doesn't survive the method boundary, so access via cast — same pattern used for the
		// `array` flag below and elsewhere in this file).
		const mappingConfig = (customFieldProps as any).mapping;
		const { refEntity, refFields: rawRefFields, fields: rawLocalFields } = mappingConfig;

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

		const isArray = !!(customFieldProps as any).array;

		mapping.json.push(`${joinAlias.toColumnName('value')} as "${gqlFieldName}"`);

		const selectFields = [
			...new Set(
				refSqlCols.map((sqlCol) => joinAlias.toColumnName(sqlCol)).concat(Array.from(refSelect))
			),
		];

		const jsonSQL = SQLBuilder.generateJsonSelectStatement(joinAlias.toString(), isArray);

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

	private mapCustomFieldWithRequiresRelations<T>(
		customFieldProps: RelatedFieldSettings<T> | CustomFieldSettings<T>,
		mapping: MappingsType,
		latestAlias: Alias,
		fieldsByTypeName?: any,
		ownerMetadata?: EntityMetadata<T>,
		args?: any
	): void {
		for (const [relationFieldName, rawConfig] of Object.entries(
			customFieldProps.requiresRelations!
		)) {
			this._mapSingleRequiredRelation(
				relationFieldName,
				rawConfig as RequireRelationConfig,
				mapping,
				latestAlias,
				fieldsByTypeName,
				ownerMetadata,
				args
			);
		}
	}

	private _mapSingleRequiredRelation<T>(
		relationFieldName: string,
		config: RequireRelationConfig,
		mapping: MappingsType,
		latestAlias: Alias,
		fieldsByTypeName: any,
		ownerMetadata: EntityMetadata<T> | undefined,
		args: any
	): void {
		const relFieldProps = ownerMetadata?.properties[
			relationFieldName as keyof typeof ownerMetadata.properties
		] as EntityProperty | undefined;
		if (!relFieldProps?.reference) {
			logger.warn(
				'mapCustomField - requiresRelations: field not found or not a relationship',
				relationFieldName
			);
			return;
		}

		const relatedEntityName = relFieldProps.type;
		if (!this.exists(relatedEntityName)) {
			logger.warn(
				'mapCustomField - requiresRelations: related entity not registered',
				relatedEntityName
			);
			return;
		}

		const refMetadata = this.getMetadata<any, EntityMetadata<any>>(relatedEntityName);
		const childAlias = this.Alias.next(AliasType.field, 'rq');

		let subFields: any;
		if (config.useQueryFields) {
			subFields =
				fieldsByTypeName?.[getGQLEntityNameFor(relatedEntityName)] ??
				fieldsByTypeName?.[relatedEntityName];
		} else if (config.fields) {
			subFields = config.fields;
		} else {
			subFields = {};
			for (const [propName, propMeta] of Object.entries(refMetadata.properties)) {
				if (
					(propMeta as EntityProperty).fieldNames?.length > 0 &&
					!(propMeta as EntityProperty).reference
				) {
					subFields[propName] = {};
				}
			}
		}

		let relationFilter = config.filter;
		let relationPagination = config.pagination;
		if (config.forwardArgs && args) {
			relationFilter = { ...config.filter, ...args.filter };
			relationPagination = { ...config.pagination, ...args.pagination };
		}

		const newMappings = this.recursiveMap({
			entityMetadata: refMetadata,
			fields: subFields,
			parentAlias: latestAlias,
			alias: childAlias,
			gqlFilters: relationFilter ? [relationFilter] : undefined,
		});

		const newMapping = QueriesUtils.newMappings();
		if (relationPagination?.limit) newMapping.limit = relationPagination.limit;
		if (relationPagination?.offset) newMapping.offset = relationPagination.offset;
		if (relationPagination?.orderBy) {
			newMapping.orderBy = relationPagination.orderBy;
		}

		const {
			select: refSelect,
			json: refJson,
			outerJoin: refOuterJoin,
			where: whereWithValues,
			values: refValues,
			innerJoin: refInnerJoin,
			limit,
			offset,
			orderBy,
			_or: refOr,
			_and: refAnd,
		} = QueriesUtils.mappingsReducer(newMappings, newMapping);

		// For nested relation subqueries, class-level logical operators (_and,
		// _or, _not) must be flattened into the WHERE clause — the relationship
		// handler builds lateral joins (not UNION ALL), so the root-level
		// _or/_and UNION-ALL splitting doesn't apply here.
		//
		// _not already pushes 'NOT (...)' conditions to `where`, so only
		// _and and _or entries need explicit flattening.
		const nestedWhere = [...whereWithValues];
		const nestedValues = { ...refValues };
		for (const andEntry of refAnd) {
			nestedWhere.push(...andEntry.where);
			Object.assign(nestedValues, andEntry.values);
		}
		if (refOr.length > 0) {
			// OR entries are combined into a single '(w1 OR w2 OR ...)' clause
			const orClauses: string[] = [];
			for (const orEntry of refOr) {
				if (orEntry.where.length > 0) {
					orClauses.push(`(${orEntry.where.join(' and ')})`);
					Object.assign(nestedValues, orEntry.values);
				}
			}
			if (orClauses.length > 0) {
				nestedWhere.push(`(${orClauses.join(' or ')})`);
			}
		}

		this._dispatchRequiredRelationMapping(
			relFieldProps,
			refMetadata,
			mapping,
			latestAlias,
			childAlias,
			nestedWhere,
			nestedValues,
			refInnerJoin,
			refOuterJoin,
			refSelect,
			refJson,
			limit,
			offset,
			orderBy,
			config,
			ownerMetadata
		);
	}

	private _dispatchRequiredRelationMapping<T>(
		relFieldProps: EntityProperty,
		refMetadata: EntityMetadata<any>,
		mapping: MappingsType,
		latestAlias: Alias,
		childAlias: Alias,
		whereWithValues: any,
		refValues: any,
		refInnerJoin: any,
		refOuterJoin: any,
		refSelect: any,
		refJson: any,
		limit: any,
		offset: any,
		orderBy: any,
		config: RequireRelationConfig,
		ownerMetadata: EntityMetadata<T> | undefined
	): void {
		const primaryKeys = ownerMetadata?.primaryKeys ?? [];
		const cardinality = getRelationCardinality(relFieldProps);
		if (cardinality === RelationCardinality.ONE_TO_X) {
			this.relationshipHandler.mapOneToX(
				refMetadata,
				relFieldProps,
				mapping,
				latestAlias,
				childAlias,
				whereWithValues,
				refValues,
				limit,
				offset,
				orderBy,
				config.as,
				refJson,
				refSelect,
				refInnerJoin,
				refOuterJoin
			);
		} else if (cardinality === RelationCardinality.MANY_TO_ONE) {
			this.relationshipHandler.mapManyToOne(
				relFieldProps,
				refMetadata,
				latestAlias,
				childAlias,
				mapping,
				whereWithValues,
				refValues,
				refInnerJoin,
				limit,
				offset,
				config.as,
				refSelect,
				refJson,
				refOuterJoin
			);
		} else if (cardinality === RelationCardinality.MANY_TO_MANY) {
			this.relationshipHandler.mapManyToMany(
				refMetadata,
				primaryKeys,
				relFieldProps,
				latestAlias,
				childAlias,
				refSelect,
				whereWithValues,
				refOuterJoin,
				refJson,
				mapping,
				config.as,
				refValues,
				limit,
				offset,
				orderBy
			);
		}
	}

	private mapCustomFieldWithRequires<T>(
		customFieldProps: RelatedFieldSettings<T> | CustomFieldSettings<T>,
		mapping: MappingsType,
		latestAlias: Alias,
		ownerMetadata?: EntityMetadata<T>
	): void {
		const requires =
			customFieldProps.requires instanceof Array
				? customFieldProps.requires
				: [customFieldProps.requires!];
		requires.forEach((req) => {
			const reqProps = ownerMetadata?.properties[req as keyof typeof ownerMetadata.properties] as
				EntityProperty | undefined;
			if (reqProps?.reference) return;
			mapping.select.add(`${latestAlias.toString()}.${req} AS "${req}"`);
			mapping.rawSelect.add(`${latestAlias.toString()}.${req}`);
		});
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

		// Build the join condition between parent and child — single source of
		// truth in relation-dispatch.ts (encodes the 1:1 ownership rule of PR #46).
		const { sql: joinCondition } = buildCorrelatedJoinCondition({
			fieldProps,
			relatedMetadata,
			parentPrimaryKeys: entityMetadata.primaryKeys,
			parentAlias,
			relatedAlias: countAlias,
		});

		// Process optional filter args
		let filterWhere: string[] = [];
		let filterValues: Record<string, any> = [];
		let filterInnerJoin: string[] = [];
		let filterOuterJoin: string[] = [];
		let filterOr: MappingsType[] = [];

		if (args?.filter) {
			const countGqlEntityName = getGQLEntityNameFor(relatedMetadata.name ?? '');
			const countConvertedFilter = convertFilterEnumValues(
				args.filter,
				getMapEnumFieldsFor(countGqlEntityName),
				getCustomFieldsFor(countGqlEntityName),
				getRelationFieldsFor(countGqlEntityName)
			);
			const filterMapped = this.recursiveMap({
				entityMetadata: relatedMetadata,
				parentAlias: countAlias,
				alias: countAlias,
				gqlFilters: [countConvertedFilter],
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

	/**
	 * Generates a correlated aggregate subquery for an aggregate field.
	 *
	 * Produces SQL like:
	 * ```sql
	 * (SELECT SUM(pages) FROM "books" AS e_w1 WHERE e_w1.author_id = a_1.id AND <filter>) AS "totalPages"
	 * ```
	 */
	protected mapAggregateField<T>(
		aggregateFieldMeta: AggregateFieldMeta,
		mapping: MappingsType,
		parentAlias: Alias,
		entityMetadata: EntityMetadata<T>,
		args?: any
	): void {
		const { aggregateFieldName, fn, column, relationshipFieldName, relatedEntityName } =
			aggregateFieldMeta;

		const relatedName = relatedEntityName();
		if (!this.exists(relatedName)) {
			mapping.select.add(`null AS "${aggregateFieldName}"`);
			return;
		}

		const relatedMetadata = this.getMetadata<any, EntityMetadata<any>>(relatedName);
		const fieldProps =
			entityMetadata.properties[relationshipFieldName as keyof typeof entityMetadata.properties];

		if (!fieldProps) {
			logger.warn('mapAggregateField: relationship field not found', relationshipFieldName);
			mapping.select.add(`null AS "${aggregateFieldName}"`);
			return;
		}

		// Resolve the SQL column name from the related entity's property metadata
		const colProps = relatedMetadata.properties[column as keyof typeof relatedMetadata.properties];
		const sqlColumn = colProps?.fieldNames?.[0] ?? column;

		const aggAlias = this.Alias.next(AliasType.entity, 'w');

		// Build the join condition between parent and child — single source of
		// truth in relation-dispatch.ts (encodes the 1:1 ownership rule of PR #46).
		// The previous inline dispatch lumped ALL 1:1 into the child-side branch,
		// so an owning-side 1:1 (inversedBy) crashed with TypeError — same bug
		// class as issue #45.
		const { sql: joinCondition } = buildCorrelatedJoinCondition({
			fieldProps,
			relatedMetadata,
			parentPrimaryKeys: entityMetadata.primaryKeys,
			parentAlias,
			relatedAlias: aggAlias,
		});

		// Process optional filter args
		let filterWhere: string[] = [];
		let filterValues: Record<string, any> = [];
		let filterInnerJoin: string[] = [];
		let filterOuterJoin: string[] = [];
		let filterOr: MappingsType[] = [];

		if (args?.filter) {
			// Convert mapNumericEnum string keys → raw DB values before SQL
			// generation, matching the count-field path. Without this, enum-typed
			// fields in inline aggregate subquery filters bypass conversion and
			// silently produce wrong SQL (same bug class fixed for count fields).
			const aggGqlEntityName = getGQLEntityNameFor(relatedMetadata.name ?? '');
			const aggConvertedFilter = convertFilterEnumValues(
				args.filter,
				getMapEnumFieldsFor(aggGqlEntityName),
				getCustomFieldsFor(aggGqlEntityName),
				getRelationFieldsFor(aggGqlEntityName)
			);
			const filterMapped = this.recursiveMap({
				entityMetadata: relatedMetadata,
				parentAlias: aggAlias,
				alias: aggAlias,
				gqlFilters: [aggConvertedFilter],
				isFieldFilter: true,
			});

			const reduced = QueriesUtils.mappingsReducer(filterMapped);
			filterWhere = reduced.where;
			filterValues = reduced.values as Record<string, any>;
			filterInnerJoin = reduced.innerJoin;
			filterOuterJoin = reduced.outerJoin;
			filterOr = reduced._or;
		}

		const aggExpr = `${fn}(${aggAlias.toString()}.${sqlColumn})`;

		let subquery: string;
		if (filterOr.length > 0) {
			// UNION ALL: aggregate over the unioned branches
			const branches = filterOr.map((orMapping) => {
				const allWhere = [joinCondition, ...filterWhere, ...orMapping.where];
				const allInnerJoin = [...filterInnerJoin, ...orMapping.innerJoin];
				return `select ${aggAlias.toString()}.${sqlColumn} from "${relatedMetadata.tableName}" as ${aggAlias.toString()} ${allInnerJoin.join(' \n')} where ${allWhere.join(' and ')}`;
			});
			subquery = `select ${aggExpr} from (${branches.map((b) => `(${b})`).join(' union all ')}) as ${aggAlias.toString()}_cnt`;
		} else {
			const whereParts = [joinCondition, ...filterWhere].filter((w) => w.length > 0);
			subquery = `select ${aggExpr} from "${relatedMetadata.tableName}" as ${aggAlias.toString()} ${filterInnerJoin.join(' \n')} ${filterOuterJoin.join(' \n')} ${whereParts.length > 0 ? `where ${whereParts.join(' and ')}` : ''}`;
		}

		subquery = subquery.replaceAll(/[ \n	]+/gi, ' ').trim();
		mapping.select.add(`(${subquery}) AS "${aggregateFieldName}"`);
		mapping.values = { ...mapping.values, ...filterValues };

		logger.log('mapAggregateField', aggregateFieldName, 'subquery', subquery);
	}

	protected mapField<T>(
		parentGqlFieldNameKey: string,
		fieldProps: { [key in string & keyof T]: EntityProperty }[string & keyof T],
		mapping: MappingsType,
		alias: Alias,
		fields: any,
		gqlFieldName: string,
		primaryKeys: string[],
		parseJsonFields: Set<string> = new Set(),
		enumFields: Record<string, any> = {},
		enumKeyFields: Set<string> = new Set()
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
				// Pass the inline filter (from `books(filter: {...})`) to the
				// CHILD's recursiveMap so the WHERE lands inside the child's
				// lateral join subquery — child-row filtering, NOT EXISTS on parent.
				gqlFilters: mapping.inlineFilter ? [mapping.inlineFilter] : undefined,
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
				'fields'
			);
			const fieldCardinality = getRelationCardinality(fieldProps);
			if (fieldCardinality === RelationCardinality.ONE_TO_X) {
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
			} else if (fieldCardinality === RelationCardinality.MANY_TO_ONE) {
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
			} else if (fieldCardinality === RelationCardinality.MANY_TO_MANY) {
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
			this.processFieldNames(
				alias,
				fieldProps.fieldNames,
				mapping,
				gqlFieldName,
				parseJsonFields.has(gqlFieldName),
				enumFields,
				enumKeyFields
			);
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
			if (filter) {
				// Convert mapNumericEnum string keys → raw DB values for inline
				// field filter args. The filter keys belong to the TARGET entity
				// (e.g. Book), not the parent (e.g. Author). We WRAP the filter
				// under the field name and convert using the PARENT entity's
				// registries — convertRelationField / convertMappedCustomField
				// then resolve the target entity and recurse into its enum
				// fields, handling arbitrary nesting depth.
				const gqlEntityName = getGQLEntityNameFor(entityMetadata.name ?? '');
				const parentEnumFields = getMapEnumFieldsFor(gqlEntityName);
				const parentCustomFields = getCustomFieldsFor(gqlEntityName);
				const parentRelationFields = getRelationFieldsFor(gqlEntityName);
				const wrappedConverted = convertFilterEnumValues(
					{ [parentGqlFieldNameKey]: filter },
					parentEnumFields,
					parentCustomFields,
					parentRelationFields
				);
				const convertedFilter = wrappedConverted[parentGqlFieldNameKey] ?? filter;

				// Store the converted filter for mapField to pass to the child's
				// recursiveMap. This ensures the WHERE clause lands inside the
				// child's lateral join subquery (child-row filtering), NOT as an
				// EXISTS on the parent.
				mapping.inlineFilter = convertedFilter;
			}

			mapping.limit = pagination?.limit;
			mapping.offset = pagination?.offset;
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
		gqlFieldName: string,
		parseJson: boolean = false,
		enumFields: Record<string, any> = {},
		enumKeyFields: Set<string> = new Set()
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

		let aliasedField: string;
		if (parseJson) {
			const jsonExpr = `REPLACE(TRIM(BOTH '"' FROM ${fieldNameWithAlias}::text), '${'\\"'}','"')::jsonb`;
			aliasedField = `${jsonExpr} AS "${gqlFieldName}"`;
		} else if (gqlFieldName in enumFields && enumKeyFields.has(gqlFieldName)) {
			// CASE WHEN mode: SQL returns the enum string key directly.
			// Used when the schema is rebuilt from SDL (Apollo Server with
			// pre-generated schema file), where graphql-js enum values default
			// to the name string instead of the numeric value.
			const caseExpr = SQLBuilder.buildEnumCaseSQL(fieldNameWithAlias, enumFields[gqlFieldName]);
			aliasedField = caseExpr
				? `${caseExpr} AS "${gqlFieldName}"`
				: gqlFieldName !== fieldNames[0]
					? `${fieldNameWithAlias} AS "${gqlFieldName}"`
					: fieldNameWithAlias;
		} else {
			aliasedField =
				gqlFieldName !== fieldNames[0]
					? `${fieldNameWithAlias} AS "${gqlFieldName}"`
					: fieldNameWithAlias;
		}

		mapping.select.add(aliasedField);
		mapping.rawSelect.add(fieldNameWithAlias);
		logger.log('field names -----', gqlFieldName, { fieldNames, aliasedField });
	}
}
