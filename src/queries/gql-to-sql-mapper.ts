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
const DEFAULT_LIMIT = isNaN(DEFAULT_LIMIT_ENV) ? 3_000 : DEFAULT_LIMIT_ENV;

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
		const { select, json, filterJoin, join, where, values, _or, _and } =
			QueriesUtils.mappingsReducer(recursiveMapResults);

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

		// logger.log('orderByFields', orderByFields, 'select', select, 'orderBy', orderBy);
		const selectFields = [...new Set(orderByFields.concat(Array.from(select)).concat(json))];

		// Build subquery using SQLBuilder
		const buildSubQueryWrapper = (
			globalFilterJoin: string[],
			globalFilterWhere: string[],
			alias: Alias,
			value?: { filterJoin: string[] } | { where: string[] } | { join: string[] }
		) => {
			const allFilterJoins = [...globalFilterJoin];
			if (value && 'filterJoin' in value) {
				allFilterJoins.push(...value.filterJoin);
			}
			if (value && 'join' in value) {
				allFilterJoins.push(...value.join);
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
					join,
				})
		);

		const querySQL = `${
			unionAll.length > 0
				? `select distinct * from (${unionAll.join(' union all ')}) as ${alias.toString()}`
				: buildSubQueryWrapper(filterJoin, where, alias, {
						join,
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
		parentGqlFieldNameKey?: string;
		isFieldFilter?: boolean;
	}) => {
		const prePrefix = isFieldFilter ? 'FF-' : '';
		const logPrefix = alias.concat(prePrefix + 'GQLtoSQLMapper - recursiveMap');
		logger.log(logPrefix, 'start');
		const { properties, primaryKeys } = entityMetadata;

		let res = keys(fields ?? {})
			.sort((f1, f2) => (f1.startsWith('__') ? -1 : f2.startsWith('__') ? 1 : 0))
			.reduce(
				({ mappings }, gqlFieldNameKey) => {
					logger.log(
						logPrefix,
						'- mapFilter for',
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
						const mapping = QueriesUtils.getMapping(mappings, gqlFieldNameKey);

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

			logger.log(
				'recursiveMap || GQLtoSQLMapper - recursiveMap - referenceField latest alias next',
				alias.toString(),
				childAlias.toString(),
				mappingsTypeToString(mapping)
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
			} = QueriesUtils.mappingsReducer(
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

			const mapping = QueriesUtils.getMapping(mappings, parentGqlFieldNameKey);

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

				const {
					filterJoin,
					where: w,
					values,
					_or,
					_and,
					_not,
				} = QueriesUtils.mappingsReducer(mapped);

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
					mappingsTypeToString(mapping)
				);
			} else {
				// m.__arguments = __arguments;
			}
			// mappings.set(parentGqlFieldNameKey, m);
		}
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
}
