import {
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

		this.Alias = new AliasManager();
		const alias = this.Alias.start('a');
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
					.map(
						(ob) =>
							metadata.properties[ob]?.fieldNames
								?.map((fieldName) => `${alias.toString()}.${fieldName}`)
								?.join(', ') ?? `${alias.toString()}.${ob}`
					)
					.flat()
			)
			.flat();

		logger.log('orderByFields', orderByFields, 'select', select, 'orderBy');
		const selectFields = [...new Set(orderByFields.concat(Array.from(select)).concat(json))];

		// Build subquery using SQLBuilder
		const buildSubQueryWrapper = (
			globalInnerJoin: string[],
			globalFilterWhere: string[],
			alias: Alias,
			value?: { innerJoin: string[] } | { where: string[] } | { outerJoin: string[] }
		) => {
			const allOuterJoins = value && 'outerJoin' in value ? value.outerJoin : [];
			const allInnerJoins = [
				...globalInnerJoin,
				...(value && 'innerJoin' in value ? value.innerJoin : []),
			];

			const allWhere = [...globalFilterWhere, ...(value && 'where' in value ? value.where : [])];

			// Convert arrays to single values for SQLBuilder compatibility
			let valueForBuilder: { innerJoin: string } | { where: string } | undefined;
			if (value && 'innerJoin' in value) {
				valueForBuilder = { innerJoin: value.innerJoin.join('\n') };
			} else if (value && 'where' in value) {
				valueForBuilder = { where: value.where.join(' and ') };
			}

			return SQLBuilder.buildSubQuery(
				selectFields,
				[...rawSelect],
				metadata.tableName,
				alias,
				allInnerJoins,
				allOuterJoins,
				allWhere,
				valueForBuilder
			);
		};

		// Use SQLBuilder.buildUnionAll for OR conditions
		const unionAll = [..._or, ..._and].map(({ innerJoin, where: wheres, alias: mapAlias }) =>
			buildSubQueryWrapper(innerJoin, where, mapAlias ?? alias, {
				innerJoin,
				where: wheres,
				outerJoin,
			})
		);

		const querySQL = `${
			unionAll.length > 0
				? `select distinct * from (${unionAll.join(' union all ')}) as ${alias.toString()}`
				: buildSubQueryWrapper(innerJoin, where, alias, {
						outerJoin,
				  })
		}
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

		logger.log(logName, 'sourceDataSQL', unionAll.length);

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
		logger.log('fields', keys(fields));
		let res = keys(fields ?? {})
			.sort((f1, f2) => (f1.startsWith('__') ? -1 : f2.startsWith('__') ? 1 : 0))
			.reduce(
				({ mappings }, gqlFieldNameKey) => {
					logger.log(
						logPrefix,
						'- mapFilter for',
						gqlFieldNameKey
						// 'keys:',
						// ...mappings.keys()
					);
					if (typeof fields[gqlFieldNameKey] !== 'object' || fields[gqlFieldNameKey] === null) {
						logger.warn(
							logPrefix,
							`- skipping field ${gqlFieldNameKey} as it is not an object`,
							fields[gqlFieldNameKey]
						);
						return { mappings };
					}
					const { args, fieldsByTypeName, name, alias: gqlFieldAlias } = fields[gqlFieldNameKey];

					console.log('==========================', name, '==========================');
					console.log('args', args, { name, gqlFieldAlias }, { gqlFieldNameKey });

					const mapping = QueriesUtils.getMapping(mappings, gqlFieldNameKey);
					if (args) {
						this.handleFieldArguments<T>(gqlFieldNameKey, args, alias, entityMetadata, mapping);
					}

					logger.log(
						logPrefix,
						'- using mapping for',
						gqlFieldNameKey,
						mappingsTypeToString(mapping)
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
						fieldsByTypeName
						// gqlFieldNameKey
					);

					if (!fieldProps) {
						return this.mapCustomField<T>(customFieldProps, mapping, alias, gqlFieldName, mappings);
					} else {
						this.mapField<T>(
							gqlFieldNameKey,
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
							{ tableName, gqlFieldName, gqlFieldNameKey, name },
							mappingsTypeToString(mapping, true)
						);
						logger.log('');
					}

					return { mappings };
				},
				{ mappings: new Map<string, MappingsType>() }
			);

		logger.log(logPrefix, 'fields processed', fields, [...res.mappings.entries()]);

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
				mapping.rawSelect.add(`${latestAlias.toString()}.${req}`);
			});
		}
		// Add null field with proper alias
		// This is because if the field is not present in the entity apollo server will not calculate the field
		mapping.select.add(`null AS "${gqlFieldName}"`);
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
			const childAlias = this.Alias.next(AliasType.field, 'p');

			const subFields = fields?.[fieldProps.type];

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
					innerJoin,
					outerJoin
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
					innerJoin,
					limit,
					offset,
					gqlFieldName,
					select,
					json,
					outerJoin
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
