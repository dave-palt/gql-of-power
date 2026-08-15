import {
	Field,
	FieldResolver,
	Float,
	getMetadataStorage,
	InputType,
	Int,
	ObjectType,
	registerEnumType,
	Resolver,
	Root,
} from 'type-graphql';
import { FieldOperations } from '../operations';
import {
	CountFieldMeta,
	AggregateFieldMeta,
	CustomFieldsSettings,
	CustomFieldSettings,
	FieldSettings,
	FieldsSettings,
	OrderByOptions,
	RelatedFieldSettings,
	RequireRelationConfig,
	Sort,
} from '../types/sql-types';
import {
	GQLEntityFilterInputFieldType,
	GQLEntityPaginationInputType,
	OrStrategy,
} from '../types/gql-types';
import { AccessControlEntry, AccessControlList } from '../types/access-control';
import { keys } from '../utils/object';

// ─── Internal registries ────────────────────────────────────────────────────

const TypeMap: { [key: string]: any } = {};

const FieldsOptionsMap: Record<string, Record<string, string>> = {};
const CustomFieldsMap: Record<string, CustomFieldsSettings<any>> = {};
const CountFieldsMap: Record<string, Record<string, CountFieldMeta>> = {};
const AggregateFieldsMap: Record<string, Record<string, AggregateFieldMeta>> = {};
const MapEnumFieldsMap: Record<string, Record<string, any>> = {};

/**
 * Per-field enum output mode override.
 * Keyed by gqlEntityName → fieldName → 'raw' | 'key'.
 * When a field is not in this map, the global `mapEnumOutputGlobal` is used.
 */
const MapEnumOutputFieldsMap: Record<string, Record<string, 'raw' | 'key'>> = {};
const ParseJsonFieldsMap: Record<string, Set<string>> = {};
/**
 * Relation fields declared via the plain `defineFields` pattern (not via
 * `customFields`/`mapping`). Keyed by gqlEntityName → field name → target
 * entity's ORM name (the raw string returned by `relatedEntityName()`). Used by
 * `convertFilterEnumValues` to recurse into nested relation filters and apply
 * the target entity's mapNumericEnum conversions.
 */
const RelationFieldsMap: Record<string, Record<string, () => string>> = {};

const aclMap: AccessControlList<any, any> = {};

/**
 * Shared field-metadata registration used by both the @GQLEntityClass decorator
 * and createGQLEntity(). For a single field it:
 *   1. registers the alias (if any) in FieldsOptionsMap,
 *   2. registers the enum mapping (mapNumericEnum) and JSON parsing (parseJson),
 *   3. emits the type-graphql collectClassFieldMetadata call.
 *
 * Extracted to eliminate the field-iteration clone between the two entry points.
 */
function registerFieldMetadata(
	fieldName: string,
	fieldOptions: any,
	gqlEntityName: string,
	target: any,
	metadata: ReturnType<typeof getMetadataStorage>
): void {
	const fieldNameOverride = fieldOptions.alias;
	if (fieldNameOverride) {
		FieldsOptionsMap[gqlEntityName] = FieldsOptionsMap[gqlEntityName] || {};
		FieldsOptionsMap[gqlEntityName][fieldNameOverride] = fieldName;
	}
	const fieldNameToUse = fieldNameOverride ?? fieldName;

	if (fieldOptions.mapNumericEnum) {
		try {
			const enumObj = fieldOptions.type();
			MapEnumFieldsMap[gqlEntityName] = MapEnumFieldsMap[gqlEntityName] || {};
			MapEnumFieldsMap[gqlEntityName][fieldNameToUse] = enumObj;
			// Store per-field output mode override (if provided)
			if (fieldOptions.mapEnumOutput) {
				MapEnumOutputFieldsMap[gqlEntityName] = MapEnumOutputFieldsMap[gqlEntityName] || {};
				MapEnumOutputFieldsMap[gqlEntityName][fieldNameToUse] = fieldOptions.mapEnumOutput;
			}
		} catch {
			// type thunk may throw for forward refs — safe to skip
		}
	}

	if (fieldOptions.parseJson) {
		ParseJsonFieldsMap[gqlEntityName] = ParseJsonFieldsMap[gqlEntityName] || new Set();
		ParseJsonFieldsMap[gqlEntityName].add(fieldNameToUse);
	}

	const isArray = 'array' in fieldOptions && fieldOptions.array;
	metadata.collectClassFieldMetadata({
		target,
		name: fieldNameToUse,
		schemaName: fieldNameToUse,
		getType: fieldOptions.type,
		complexity: undefined,
		description: fieldNameToUse,
		deprecationReason: undefined,
		typeOptions: {
			...(isArray ? { array: true, arrayDepth: 1 } : {}),
			...fieldOptions.options,
		},
	});
}

/** Auto-resolver registry: gqlEntityName → FieldsResolver class */
const autoResolverRegistry = new Map<string, new () => any>();

/**
 * Builds a filter-input FieldParameter for a single filter operator option.
 * Used twice per option in createGQLEntityFilters — once for the backwards-compat
 * `fieldName + key` field and once for the nested `key` field — both share the
 * exact same options/typeOptions/getType logic, differing only in target + name.
 */
function buildFilterFieldParameter(
	target: any,
	name: string,
	option: { array?: boolean; appliesToArray?: boolean },
	fieldOptions: any,
	getType: any,
	getFilterType: any
): any {
	const isArray = option.array || option.appliesToArray;
	return {
		target,
		name,
		schemaName: name,
		getType: option.appliesToArray && getFilterType ? getFilterType : getType,
		options: {
			...fieldOptions.options,
			...(isArray ? { array: true, arrayDepth: 1 } : {}),
			nullable: true,
		},
		typeOptions: {
			...(isArray ? { array: true, arrayDepth: 1 } : {}),
			nullable: true,
		},
		complexity: undefined,
		description: name,
		deprecationReason: undefined,
	};
}

// ─── Global config ───────────────────────────────────────────────────────────

let gqlTypesSuffix = '';
let gqlSortSuffix = '';
let sortEnumRegistered = false;

/**
 * Global enum output mode.
 *
 * Resolved at module load from the `GQL_OF_POWER_MAP_ENUM_OUTPUT` env var.
 * Per-field `mapEnumOutput` takes precedence, then this global, then `'raw'`.
 *
 * - `'raw'` — raw DB values pass through (native `buildSchema()` path).
 * - `'key'` — SQL `CASE WHEN` returns enum string keys (SDL-rebuilt schema path).
 */
let mapEnumOutputGlobal: 'raw' | 'key' =
	(process.env.GQL_OF_POWER_MAP_ENUM_OUTPUT as 'raw' | 'key') || 'raw';

/**
 * Global `_or`/`_and` combination strategy.
 *
 * Resolved at module load from the `GQL_OF_POWER_OR_STRATEGY` env var.
 * Per-query `pagination.orStrategy` takes precedence, then this global,
 * then `'union-all'`.
 *
 * - `'union-all'` — each `_or` branch becomes a separate SELECT combined
 *   with `union all` (historical default).
 * - `'or'` — branches flatten into one query with `((w1) or (w2))` in the
 *   WHERE clause (index-friendly single scan; see README for the
 *   relationship-branch caveat).
 */
let orStrategyGlobal: OrStrategy =
	(process.env.GQL_OF_POWER_OR_STRATEGY as OrStrategy) || 'union-all';

export const setGlobalConfig = (config: {
	gqlTypesSuffix?: string;
	gqlSortSuffix?: string;
	mapEnumOutput?: 'raw' | 'key';
	orStrategy?: OrStrategy;
}) => {
	if (config.gqlTypesSuffix !== undefined) gqlTypesSuffix = config.gqlTypesSuffix;
	if (config.gqlSortSuffix !== undefined) gqlSortSuffix = config.gqlSortSuffix;
	if (config.mapEnumOutput !== undefined) mapEnumOutputGlobal = config.mapEnumOutput;
	if (config.orStrategy !== undefined) orStrategyGlobal = config.orStrategy;
};

export const getMapEnumOutputGlobal = () => mapEnumOutputGlobal;

export const getOrStrategyGlobal = () => orStrategyGlobal;

// ─── Public accessors ────────────────────────────────────────────────────────

export const getFieldsOptionsFor = (name: string): Record<string, string> =>
	FieldsOptionsMap[name] ?? {};
export const getFieldByAlias = (entityName: string | undefined, alias: string): string =>
	FieldsOptionsMap[entityName ?? '__no__use__']?.[alias] ?? alias;
export const getCustomFieldsFor = (name: string) => CustomFieldsMap[name] ?? {};

/**
 * Returns the count fields registered for the given GQL entity name.
 * Keyed by the count field name (e.g. 'bookCount'), value is the count field metadata.
 */
export const getCountFieldsFor = (name: string): Record<string, CountFieldMeta> =>
	CountFieldsMap[name] ?? {};

/**
 * Manually registers a count field for an entity.
 * Useful for testing without the @GQLEntityClass decorator.
 * In production, count fields are auto-registered by the decorator when `countFieldName` is set.
 */
export const registerCountField = (
	gqlEntityName: string,
	countFieldName: string,
	relationshipFieldName: string,
	relatedEntityName: () => string
): void => {
	CountFieldsMap[gqlEntityName] = CountFieldsMap[gqlEntityName] || {};
	CountFieldsMap[gqlEntityName][countFieldName] = {
		countFieldName,
		relationshipFieldName,
		relatedEntityName,
	};
};

/**
 * Clears all registered count fields. Intended for test teardown.
 */
export const clearCountFields = (): void => {
	for (const key of Object.keys(CountFieldsMap)) {
		delete CountFieldsMap[key];
	}
};

/**
 * Returns the aggregate fields registered for the given GQL entity name.
 * Keyed by the aggregate field name (e.g. 'totalPages'), value is the aggregate field metadata.
 */
export const getAggregateFieldsFor = (name: string): Record<string, AggregateFieldMeta> =>
	AggregateFieldsMap[name] ?? {};

/**
 * Manually registers an aggregate field for an entity.
 * Useful for testing without the @GQLEntityClass decorator.
 * In production, aggregate fields are auto-registered by the decorator when `aggregateFields` is set.
 */
export const registerAggregateField = (
	gqlEntityName: string,
	aggregateFieldName: string,
	fn: 'sum' | 'avg' | 'min' | 'max',
	column: string,
	relationshipFieldName: string,
	relatedEntityName: () => string
): void => {
	AggregateFieldsMap[gqlEntityName] = AggregateFieldsMap[gqlEntityName] || {};
	AggregateFieldsMap[gqlEntityName][aggregateFieldName] = {
		aggregateFieldName,
		fn,
		column,
		relationshipFieldName,
		relatedEntityName,
	};
};

/**
 * Clears all registered aggregate fields. Intended for test teardown.
 */
export const clearAggregateFields = (): void => {
	for (const key of Object.keys(AggregateFieldsMap)) {
		delete AggregateFieldsMap[key];
	}
};
export const getMapEnumFieldsFor = (name: string): Record<string, any> =>
	MapEnumFieldsMap[name] ?? {};

/**
 * Returns the per-field enum output mode overrides for an entity.
 * Fields not in this map use the global `getMapEnumOutputGlobal()` setting.
 */
export const getMapEnumOutputFieldsFor = (name: string): Record<string, 'raw' | 'key'> =>
	MapEnumOutputFieldsMap[name] ?? {};

export const clearMapEnumFields = (): void => {
	for (const key of Object.keys(MapEnumFieldsMap)) {
		delete MapEnumFieldsMap[key];
	}
	for (const key of Object.keys(MapEnumOutputFieldsMap)) {
		delete MapEnumOutputFieldsMap[key];
	}
};

export const getParseJsonFieldsFor = (name: string): Set<string> =>
	ParseJsonFieldsMap[name] ?? new Set();

export const registerParseJsonField = (gqlEntityName: string, fieldName: string): void => {
	ParseJsonFieldsMap[gqlEntityName] = ParseJsonFieldsMap[gqlEntityName] || new Set();
	ParseJsonFieldsMap[gqlEntityName].add(fieldName);
};

export const clearParseJsonFields = (): void => {
	for (const key of Object.keys(ParseJsonFieldsMap)) {
		delete ParseJsonFieldsMap[key];
	}
};

export const getRelationFieldsFor = (name: string): Record<string, () => string> =>
	RelationFieldsMap[name] ?? {};

export const clearRelationFields = (): void => {
	for (const key of Object.keys(RelationFieldsMap)) {
		delete RelationFieldsMap[key];
	}
};

export const getACLFor = (name: string) => aclMap[name] ?? {};

export const getGQLEntityNameFor = (name: string) =>
	`${name}${gqlTypesSuffix || process.env['D3GOP_TYPES_SUFFIX'] || ''}`;
export const getGQLEntityNameForClass = <T>(classType: new () => T) =>
	getGQLEntityNameFor(classType.name);
export const getGQLEntityFieldResolverName = (gqlEntityName: string) =>
	`${gqlEntityName}FieldsResolver`;
export const getGQLEntityFieldResolverNameFor = <T extends Object>(classType: new () => T) =>
	getGQLEntityFieldResolverName(getGQLEntityNameForClass(classType));
export const getGQLEntityTypeFor = <T extends Object, K>(classType: new () => T) =>
	getGQLEntityFieldResolverName(TypeMap[getGQLEntityNameForClass(classType)]);

/**
 * Returns all FieldsResolver classes registered by @GQLEntityClass decorators.
 * Safe to spread directly into the resolvers array — these handle field resolvers only,
 * never conflicts with custom @GQLResolver classes which handle queries/mutations.
 *
 * Usage in schema/index.ts:
 *   export const v2Resolvers = [
 *     AuthorV2Resolver,       // custom queries/mutations
 *     ...getAutoResolvers(),  // field resolvers for all entities
 *   ];
 */
export function getAutoResolvers(): Array<new () => any> {
	return Array.from(autoResolverRegistry.values());
}

// ─── Sort enum deferred registration ────────────────────────────────────────

/**
 * Registers the Sort enum with type-graphql using the current sort suffix.
 * Deferred from module load so that setGlobalConfig() can be called first,
 * or falls back to the D3GOP_SORT_SUFFIX env variable.
 * Safe to call multiple times — only registers once.
 */
function ensureSortRegistered() {
	if (sortEnumRegistered) return;
	const suffix = gqlSortSuffix || process.env['D3GOP_SORT_SUFFIX'] || '';
	registerEnumType(Sort, { name: `Sort${suffix}` });
	sortEnumRegistered = true;
}

// ─── Static members type ──────────────────────────────────────────────────────

/**
 * Static members attached to every class decorated with @GQLEntityClass.
 * TypeScript knows about these via the decorator return type — no `declare static` needed.
 */
export type GQLEntityStaticMembers = {
	readonly FilterInput: new () => any;
	readonly PaginationInput: new () => any;
	readonly OrderBy: new () => any;
	readonly Input: new () => any;
	readonly FieldsResolver: new () => any;
	readonly gqlEntityName: string;
	readonly relatedEntityName: string;
};

/**
 * Abstract base class for GQLEntityClass-decorated entities.
 * Provides TypeScript visibility of the static members that @GQLEntityClass attaches at runtime.
 * Extend this in your entity class to get full type safety without `declare static` boilerplate.
 *
 * @example
 * @GQLEntityClass(Author, fields)
 * export class AuthorGQL extends GQLEntityBase {}
 *
 * AuthorGQL.FilterInput   // ✓ TypeScript knows about this
 * AuthorGQL.PaginationInput // ✓
 */
export abstract class GQLEntityBase {
	static FilterInput: new () => any;
	static PaginationInput: new () => any;
	static OrderBy: new () => any;
	static Input: new () => any;
	static FieldsResolver: new () => any;
	static gqlEntityName: string;
	static relatedEntityName: string;
}

// ─── defineFields ─────────────────────────────────────────────────────────────

/**
 * Typed field config builder for @GQLEntityClass.
 * The `ormClass` parameter is used only for TypeScript inference — constrains
 * the config keys to `keyof T` at compile time. Identity function at runtime.
 *
 * @example
 * const fields = defineFields(Author, {
 *   id: { type: () => ID, generateFilter: true },
 *   name: { type: () => String, generateFilter: true },
 *   books: { type: () => BookGQL, array: true, generateFilter: true },
 * });
 */
export function defineFields<T extends Object>(
	_ormClass: new () => T,
	fields: Partial<FieldsSettings<T>>
): Partial<FieldsSettings<T>> {
	return fields;
}

// ─── @GQLEntityClass decorator ───────────────────────────────────────────────

/**
 * Class decorator that defines an entity as a GraphQL ObjectType and generates
 * FilterInput, PaginationInput, OrderBy, and FieldsResolver automatically.
 *
 * The decorated class itself IS the GQLEntity @ObjectType — no separate GQLEntity needed.
 * Statics attached: FilterInput, PaginationInput, OrderBy, FieldsResolver, gqlEntityName, relatedEntityName.
 *
 * The FieldsResolver is registered in the auto-resolver registry — include it in
 * schema/index.ts via ...getAutoResolvers().
 *
 * Cross-entity references via relation fields use static imports + thunks — safe because
 * the decorated class is a class constructor (hoisted), identical to type-graphql @ObjectType.
 *
 * @example
 * const fields = defineFields(Author, {
 *   id: { type: () => ID, generateFilter: true },
 *   books: { type: () => BookGQL, array: true, generateFilter: true },
 * });
 *
 * @GQLEntityClass(Author, fields)
 * export class AuthorGQL {}
 *
 * // AuthorGQL.FilterInput, .PaginationInput, .OrderBy, .FieldsResolver are now available
 */
export function GQLEntityClass<T extends Object, K>(
	ormClass: new () => T,
	fields: Partial<FieldsSettings<T>>,
	extra?: {
		customFields?: CustomFieldsSettings<T>;
		acl?: AccessControlEntry<T, K>;
	}
): <C extends new (...args: any[]) => any>(target: C) => C & GQLEntityStaticMembers {
	return (target: any) => {
		const { customFields, acl } = extra ?? {};
		ensureSortRegistered();

		const metadata = getMetadataStorage();
		const gqlEntityName = getGQLEntityNameForClass(ormClass);

		aclMap[gqlEntityName] = acl ?? {};

		// Use the decorated class itself as the GQLEntity
		const GQLEntity = target as any;
		TypeMap[gqlEntityName] = GQLEntity;

		const fieldNames = keys(fields);

		for (const fieldName of fieldNames) {
			const fieldOptions = fieldName in fields ? fields[fieldName] : undefined;
			if (!fieldOptions) continue;

			registerFieldMetadata(fieldName, fieldOptions, gqlEntityName, GQLEntity, metadata);
		}

		ObjectType(gqlEntityName)(GQLEntity);

		// Auto-fill relatedEntityName for relation fields that use a @GQLEntityClass-decorated type
		const resolvedFields = _resolveRelatedEntityNames(fields);

		const resolverDef = _buildResolversForEntity(
			GQLEntity,
			gqlEntityName,
			fieldNames,
			resolvedFields,
			metadata,
			customFields,
			fields
		);

		// Attach statics — the class IS the GQLEntity
		Object.assign(target, {
			FilterInput: resolverDef.GQLEntityFilterInput,
			PaginationInput: resolverDef.GQLEntityPaginationInputField,
			OrderBy: resolverDef.GQLEntityOrderBy,
			Input: resolverDef.GQLEntityInput,
			FieldsResolver: resolverDef.FieldsResolver,
			gqlEntityName,
			relatedEntityName: ormClass.name,
		});

		// Register FieldsResolver in the auto-resolver registry
		autoResolverRegistry.set(gqlEntityName, resolverDef.FieldsResolver);

		return target as any;
	};
}

/**
 * For any field that has `array: true` but no explicit `relatedEntityName`,
 * attempt to derive it from the decorated type class's `.relatedEntityName` static.
 * This allows `defineFields` consumers to skip the redundant `relatedEntityName` boilerplate.
 */
function _resolveRelatedEntityNames<T>(
	fields: Partial<FieldsSettings<T>>
): Partial<FieldsSettings<T>> {
	const resolved: Partial<FieldsSettings<T>> = {};
	for (const [fieldName, fieldOptions] of Object.entries(fields)) {
		if (!fieldOptions) {
			(resolved as any)[fieldName] = fieldOptions;
			continue;
		}
		const isArray = 'array' in (fieldOptions as object) && (fieldOptions as any).array;
		const hasRelatedEntityName = 'relatedEntityName' in (fieldOptions as object);

		if (isArray && !hasRelatedEntityName) {
			const typeClass = (fieldOptions as any).type?.();
			const isGqlEntity = typeClass?.prototype instanceof GQLEntityBase || typeClass?._____name;
			if (isGqlEntity) {
				const derivedRelatedEntityName = () => {
					return (typeClass as any)?.relatedEntityName ?? typeClass?.name ?? '';
				};
				(resolved as any)[fieldName] = {
					...fieldOptions,
					relatedEntityName: derivedRelatedEntityName,
				};
			} else {
				(resolved as any)[fieldName] = fieldOptions;
			}
		} else {
			(resolved as any)[fieldName] = fieldOptions;
		}
	}
	return resolved;
}

// ─── @GQLResolver decorator ──────────────────────────────────────────────────

/**
 * Marks a class as a custom resolver for a @GQLEntityClass entity.
 * Applies @Resolver(() => EntityClass) to the decorated class.
 *
 * The decorated class handles custom queries/mutations only — field resolvers
 * are always handled by the auto-generated FieldsResolver (via getAutoResolvers()).
 * type-graphql merges both into the final schema for the same type.
 *
 * @example
 * @GQLResolver(AuthorGQL)
 * export class AuthorV2Resolver {
 *   @Query(() => [AuthorGQL])
 *   async authorsV2(...) { ... }
 * }
 */
export function GQLResolver(entityClass: new () => any): ClassDecorator {
	return (target) => {
		Resolver(() => entityClass)(target);
	};
}

// ─── Phase 1: createGQLEntity ────────────────────────────────────────────────

/**
 * Phase 1: creates and registers the GQLEntity @ObjectType class.
 * Returns the entity definition with a deferred `buildResolvers()` method.
 *
 * Use this instead of `createGQLTypes` when you have circular imports between
 * entity files — import only the entity definition from other modules, then call
 * `buildResolvers()` at registration time (e.g. in schema/index.ts).
 */
export function createGQLEntity<T extends Object, K>(
	classType: new () => T,
	opts: Partial<FieldsSettings<T>>,
	{
		customFields,
		acl,
	}: {
		customFields?: CustomFieldsSettings<T>;
		acl?: AccessControlEntry<T, K>;
	} = {}
) {
	ensureSortRegistered();

	const metadata = getMetadataStorage();

	const gqlEntityName = getGQLEntityNameForClass(classType);

	aclMap[gqlEntityName] = acl ?? {};

	const fields = keys(opts);

	class GQLEntity {
		_____name = gqlEntityName;
	}
	Object.defineProperty(GQLEntity, 'name', { value: gqlEntityName });
	TypeMap[gqlEntityName] = GQLEntity;

	for (const fieldName of fields) {
		const fieldOptions = fieldName in opts ? opts[fieldName] : undefined;
		if (!fieldOptions) {
			continue;
		}
		registerFieldMetadata(fieldName, fieldOptions, gqlEntityName, GQLEntity, metadata);
	}

	ObjectType(gqlEntityName)(GQLEntity);

	function buildResolvers() {
		return _buildResolversForEntity(
			GQLEntity,
			gqlEntityName,
			fields,
			opts,
			metadata,
			customFields,
			opts
		);
	}

	return {
		GQLEntity,
		gqlEntityName,
		relatedEntityName: classType.name,
		buildResolvers,
	};
}

// ─── Input type builder ──────────────────────────────────────────────────────

type TypeGQLMetadataStorage = ReturnType<typeof getMetadataStorage>;
type FieldParameter = Parameters<TypeGQLMetadataStorage['collectClassFieldMetadata']>[0];

function _buildInputType<T>(
	gqlEntityName: string,
	fields: string[],
	opts: Partial<FieldsSettings<T>>,
	metadata: TypeGQLMetadataStorage,
	customFields?: CustomFieldsSettings<T>
): new () => any {
	const inputTypeName = `${gqlEntityName}Input`;

	class GQLEntityInput {}
	Object.defineProperty(GQLEntityInput, 'name', { value: inputTypeName });

	const customFieldNames = customFields ? new Set(Object.keys(customFields)) : new Set<string>();

	for (const fieldName of fields) {
		const fieldOpts = (opts as any)[fieldName];
		if (!fieldOpts) continue;

		const fieldNameToUse = fieldOpts.alias ?? fieldName;

		if (customFieldNames.has(fieldName)) continue;
		if (fieldOpts.excludeFromInput) continue;
		if ('array' in fieldOpts && fieldOpts.array) continue;
		if ('relatedEntityName' in fieldOpts && fieldOpts.relatedEntityName) continue;

		metadata.collectClassFieldMetadata({
			target: GQLEntityInput,
			name: fieldNameToUse,
			schemaName: fieldNameToUse,
			getType: fieldOpts.type,
			typeOptions: { nullable: true },
			complexity: undefined,
			description: fieldNameToUse,
			deprecationReason: undefined,
		} as FieldParameter);
	}

	InputType(inputTypeName)(GQLEntityInput);
	TypeMap[inputTypeName] = GQLEntityInput;

	return GQLEntityInput;
}

// ─── Shared resolver builder ─────────────────────────────────────────────────

/** Phase 3: process custom fields — alias registration, metadata, resolve/mapping/requiresRelations strategies. */
function _processCustomFields<T>(
	customFields: CustomFieldsSettings<T>,
	gqlEntityName: string,
	GQLEntity: new () => any,
	GQLEntityFilterInput: any,
	FieldsResolver: any,
	opts: Partial<FieldsSettings<T>>,
	metadata: ReturnType<typeof getMetadataStorage>
) {
	CustomFieldsMap[gqlEntityName] = customFields;

	for (const fieldName of keys(customFields)) {
		const fieldOptions = fieldName in customFields ? customFields[fieldName] : undefined;
		if (!fieldOptions) {
			continue;
		}
		_processSingleCustomField(
			fieldName,
			fieldOptions,
			gqlEntityName,
			GQLEntity,
			GQLEntityFilterInput,
			FieldsResolver,
			opts,
			metadata
		);
	}
}

/** Per-custom-field body of _processCustomFields: alias + field metadata, resolve/mapping strategy, requiresRelations. */
function _processSingleCustomField<T>(
	fieldName: string,
	fieldOptions: CustomFieldSettings<T>,
	gqlEntityName: string,
	GQLEntity: new () => any,
	GQLEntityFilterInput: any,
	FieldsResolver: any,
	opts: Partial<FieldsSettings<T>>,
	metadata: ReturnType<typeof getMetadataStorage>
) {
	const fieldNameToUse = _registerCustomFieldAliasAndMetadata(
		fieldName,
		fieldOptions,
		gqlEntityName,
		GQLEntity,
		metadata
	);

	if (fieldOptions.resolve) {
		_registerCustomFieldResolver(fieldNameToUse, fieldOptions, FieldsResolver);
	} else if ('mapping' in fieldOptions && fieldOptions.mapping) {
		_registerMappingFieldFilter(fieldNameToUse, fieldOptions, GQLEntityFilterInput, metadata);
	}

	if ('requiresRelations' in fieldOptions && fieldOptions.requiresRelations) {
		_registerRequiresRelationsForwardArgs(fieldNameToUse, fieldOptions, GQLEntity, opts, metadata);
	}
}

/** Phase 1: register alias in FieldsOptionsMap + emit collectClassFieldMetadata; return the fieldNameToUse. */
function _registerCustomFieldAliasAndMetadata<T>(
	fieldName: string,
	fieldOptions: CustomFieldSettings<T>,
	gqlEntityName: string,
	GQLEntity: new () => any,
	metadata: ReturnType<typeof getMetadataStorage>
): string {
	const fieldNameOverride = fieldOptions.alias;
	if (fieldNameOverride) {
		FieldsOptionsMap[gqlEntityName] = FieldsOptionsMap[gqlEntityName] || {};
		FieldsOptionsMap[gqlEntityName][fieldNameOverride] = fieldName;
	}

	const fieldNameToUse = fieldNameOverride ?? fieldName;

	metadata.collectClassFieldMetadata({
		target: GQLEntity,
		name: fieldNameToUse,
		schemaName: fieldNameToUse,
		getType: fieldOptions.type,
		typeOptions: {
			...('array' in fieldOptions && fieldOptions.array ? { array: true, arrayDepth: 1 } : {}),
			...fieldOptions.options,
		},
		complexity: undefined,
		description: fieldNameToUse,
		deprecationReason: undefined,
	});

	return fieldNameToUse;
}

/** requiresRelations strategy: register filter + pagination handler params for relations with forwardArgs. */
function _registerRequiresRelationsForwardArgs<T>(
	fieldNameToUse: string,
	fieldOptions: CustomFieldSettings<T>,
	GQLEntity: new () => any,
	opts: Partial<FieldsSettings<T>>,
	metadata: ReturnType<typeof getMetadataStorage>
) {
	for (const [relFieldName, rawRelConfig] of Object.entries(
		fieldOptions.requiresRelations as Record<string, any>
	)) {
		const relConfig = rawRelConfig as RequireRelationConfig;
		if (!relConfig.forwardArgs) continue;

		const relFieldOpts = (opts as any)?.[relFieldName];
		if (!relFieldOpts?.relatedEntityName) {
			continue;
		}

		const relatedGqlEntityName = getGQLEntityNameFor(relFieldOpts.relatedEntityName());
		const baseParamIndex = fieldOptions.resolve
			? (fieldOptions.resolveDecorators?.length ?? 0) + 1
			: 0;

		metadata.collectHandlerParamMetadata({
			kind: 'arg',
			name: 'filter',
			description: undefined,
			methodName: fieldNameToUse,
			index: baseParamIndex,
			getType: () => TypeMap[relatedGqlEntityName + 'FilterInput'],
			target: GQLEntity,
			typeOptions: { nullable: true },
			deprecationReason: undefined,
			validateFn: undefined,
			validateSettings: undefined,
		});

		metadata.collectHandlerParamMetadata({
			kind: 'arg',
			name: 'pagination',
			description: undefined,
			methodName: fieldNameToUse,
			index: baseParamIndex + 1,
			getType: () => TypeMap[`${relatedGqlEntityName}PaginationInput`],
			target: GQLEntity,
			typeOptions: { nullable: true },
			deprecationReason: undefined,
			validateFn: undefined,
			validateSettings: undefined,
		});
	}
}

/** Resolve strategy: attach @FieldResolver + parameter decorators for a custom field. */
function _registerCustomFieldResolver<T>(
	fieldNameToUse: string,
	fieldOptions: CustomFieldSettings<T>,
	FieldsResolver: any
) {
	// resolve strategy: attach @FieldResolver + parameter decorators
	Object.defineProperty(FieldsResolver.prototype, fieldNameToUse, {
		value: fieldOptions.resolve,
		writable: true,
		configurable: true,
	});

	FieldResolver(fieldOptions.type, {
		...('array' in fieldOptions && fieldOptions.array ? { array: true, arrayDepth: 1 } : {}),
		...fieldOptions.options,
		name: fieldNameToUse,
	})(
		FieldsResolver.prototype,
		fieldNameToUse,
		Object.getOwnPropertyDescriptor(FieldsResolver.prototype, fieldNameToUse)!
	);

	fieldOptions.resolveDecorators?.forEach((decorator, i) => {
		decorator(FieldsResolver.prototype, fieldNameToUse, i);
	});

	if (!fieldOptions.resolveDecorators?.length) {
		Root()(FieldsResolver.prototype, fieldNameToUse, 0);
	}
}

/** Mapping strategy: if generateFilter, register a nested FilterInput field on the ref entity. */
function _registerMappingFieldFilter<T>(
	fieldNameToUse: string,
	fieldOptions: CustomFieldSettings<T>,
	GQLEntityFilterInput: any,
	metadata: ReturnType<typeof getMetadataStorage>
) {
	if (!fieldOptions.generateFilter) {
		return;
	}
	const UppercasedFieldName = fieldNameToUse[0].toUpperCase() + fieldNameToUse.slice(1);
	const refEntityName = fieldOptions.mapping!.refEntity.name;
	const refGqlEntityName = getGQLEntityNameFor(refEntityName);
	const refFilterTypeName = refGqlEntityName + 'FilterInput';

	metadata.collectClassFieldMetadata({
		target: GQLEntityFilterInput,
		name: UppercasedFieldName,
		schemaName: UppercasedFieldName,
		getType: () => {
			const type = TypeMap[refFilterTypeName];
			if (!type) {
				throw new Error(
					`gql-of-power: FilterInput for referenced entity "${refGqlEntityName}" (${refFilterTypeName}) ` +
						`is not registered. Make sure ${refGqlEntityName}'s buildResolvers() is called ` +
						`(or use createGQLTypes / @GQLEntityClass) before building the schema.`
				);
			}
			return type;
		},
		typeOptions: { nullable: true },
		complexity: undefined,
		description: `Filter by ${fieldNameToUse} fields`,
		deprecationReason: undefined,
	});
}

/** Phase 4: InputType-decorate OrderBy, declare PaginationInput, and run createGQLEntityFilters per field. */
function _registerFiltersAndPagination<T>(
	gqlEntityName: string,
	fields: string[],
	opts: Partial<FieldsSettings<T>>,
	metadata: ReturnType<typeof getMetadataStorage>,
	GQLEntity: new () => any,
	GQLEntityOrderBy: any,
	GQLEntityFilterInput: any
): any {
	InputType(gqlEntityName + 'OrderBy')(GQLEntityOrderBy);

	const paginationTypeName = `${gqlEntityName}PaginationInput`;

	@InputType(paginationTypeName)
	class GQLEntityPaginationInputField {
		@Field(() => Int, {
			nullable: true,
		})
		limit?: number;

		@Field(() => Int, {
			nullable: true,
		})
		offset?: number;

		@Field(() => [GQLEntityOrderBy], { nullable: true })
		orderBy?: OrderByOptions[];

		@Field(() => Boolean, { nullable: true })
		distinct?: boolean;
	}
	Object.defineProperty(GQLEntityPaginationInputField, 'name', {
		value: paginationTypeName,
	});
	TypeMap[paginationTypeName] = GQLEntityPaginationInputField;

	for (const fieldName of fields) {
		const fieldOptions = fieldName in opts ? (opts as any)[fieldName] : undefined;
		if (!fieldOptions) {
			continue;
		}
		const fieldNameOverride = fieldOptions.alias;
		const fieldNameToUse = fieldNameOverride ?? fieldName;

		createGQLEntityFilters(
			fieldOptions,
			fieldNameToUse,
			GQLEntity,
			metadata,
			GQLEntityOrderBy,
			gqlEntityName,
			GQLEntityFilterInput
		);
	}

	return GQLEntityPaginationInputField;
}

/** Phase 5: register count fields (Int field, filter arg, 6 operators, implicit-eq, nested CountFieldFilterInput). */
function _registerCountFields<T>(
	gqlEntityName: string,
	fields: string[],
	opts: Partial<FieldsSettings<T>>,
	metadata: ReturnType<typeof getMetadataStorage>,
	GQLEntity: new () => any,
	GQLEntityFilterInput: any
) {
	for (const fieldName of fields) {
		const fieldOptions = fieldName in opts ? (opts as any)[fieldName] : undefined;
		if (!fieldOptions) {
			continue;
		}
		const fieldNameOverride = fieldOptions.alias;
		const fieldNameToUse = fieldNameOverride ?? fieldName;

		// Register count fields derived from relationship fields with countFieldName
		if (fieldOptions.countFieldName) {
			const countFieldName = fieldOptions.countFieldName as string;
			const relatedEntityName = fieldOptions.relatedEntityName as () => string;

			// Register the Int field on the GQLEntity ObjectType
			metadata.collectClassFieldMetadata({
				target: GQLEntity,
				name: countFieldName,
				schemaName: countFieldName,
				getType: () => Int,
				typeOptions: { nullable: true },
				complexity: undefined,
				description: `Count of ${fieldName} with optional filter`,
				deprecationReason: undefined,
			});

			// Register filter arg on the count field (same as array relationship fields)
			const relatedGQLEntityName = getGQLEntityNameFor(relatedEntityName());

			metadata.collectHandlerParamMetadata({
				kind: 'arg',
				name: 'filter',
				description: undefined,
				methodName: countFieldName,
				index: 0,
				getType: () => TypeMap[relatedGQLEntityName + 'FilterInput'],
				target: GQLEntity,
				typeOptions: { nullable: true },
				deprecationReason: undefined,
				validateFn: undefined,
				validateSettings: undefined,
			});

			// Store in CountFieldsMap
			CountFieldsMap[gqlEntityName] = CountFieldsMap[gqlEntityName] || {};
			CountFieldsMap[gqlEntityName][countFieldName] = {
				countFieldName,
				relationshipFieldName: fieldNameToUse,
				relatedEntityName,
			};

			// Register count filter operators on the entity's FilterInput
			// Supports: bookCount_eq, bookCount_gt, bookCount: 4, BookCount: { _gt: 3 }
			const countFilterOperators: Array<{ key: string; array?: boolean }> = [
				{ key: '_eq' },
				{ key: '_ne' },
				{ key: '_gt' },
				{ key: '_gte' },
				{ key: '_lt' },
				{ key: '_lte' },
			];

			for (const op of countFilterOperators) {
				const opFieldName = countFieldName + op.key;
				metadata.collectClassFieldMetadata({
					target: GQLEntityFilterInput,
					name: opFieldName,
					schemaName: opFieldName,
					getType: () => Int,
					typeOptions: { nullable: true },
					complexity: undefined,
					description: `Filter by ${countFieldName} ${op.key}`,
					deprecationReason: undefined,
				});
			}

			// bookCount: 4 (implicit _eq)
			metadata.collectClassFieldMetadata({
				target: GQLEntityFilterInput,
				name: countFieldName,
				schemaName: countFieldName,
				getType: () => Int,
				typeOptions: { nullable: true },
				complexity: undefined,
				description: `Filter by ${countFieldName} (equals)`,
				deprecationReason: undefined,
			});

			// BookCount: { _gt: 3 } (nested object form)
			const UppercasedCountFieldName = countFieldName[0].toUpperCase() + countFieldName.slice(1);
			const countFieldFilterTypeName = `${gqlEntityName}_${UppercasedCountFieldName}`;

			@InputType(countFieldFilterTypeName)
			class CountFieldFilterInput {}
			Object.defineProperty(CountFieldFilterInput, 'name', {
				value: countFieldFilterTypeName,
			});
			TypeMap[countFieldFilterTypeName] = CountFieldFilterInput;

			for (const op of countFilterOperators) {
				metadata.collectClassFieldMetadata({
					target: CountFieldFilterInput,
					name: op.key,
					schemaName: op.key,
					getType: () => Int,
					typeOptions: { nullable: true },
					complexity: undefined,
					description: op.key,
					deprecationReason: undefined,
				});
			}

			InputType(countFieldFilterTypeName)(CountFieldFilterInput);

			metadata.collectClassFieldMetadata({
				target: GQLEntityFilterInput,
				name: UppercasedCountFieldName,
				schemaName: UppercasedCountFieldName,
				getType: () => CountFieldFilterInput,
				typeOptions: { nullable: true },
				complexity: undefined,
				description: `Filter by ${countFieldName} with operators`,
				deprecationReason: undefined,
			});
		}

		// Register aggregate fields derived from relationship fields with aggregateFields
		if (fieldOptions.aggregateFields && Array.isArray(fieldOptions.aggregateFields)) {
			const relatedEntityName = fieldOptions.relatedEntityName as () => string;
			const relatedGQLEntityName = getGQLEntityNameFor(relatedEntityName());

			for (const { fn, column, fieldName: aggFieldName } of fieldOptions.aggregateFields) {
				// avg → Float, sum/min/max → Float (consistent, avoids integer-division surprises)
				metadata.collectClassFieldMetadata({
					target: GQLEntity,
					name: aggFieldName,
					schemaName: aggFieldName,
					getType: () => Float,
					typeOptions: { nullable: true },
					complexity: undefined,
					description: `${fn.toUpperCase()} of ${column} with optional filter`,
					deprecationReason: undefined,
				});

				// Register filter arg on the aggregate field
				metadata.collectHandlerParamMetadata({
					kind: 'arg',
					name: 'filter',
					description: undefined,
					methodName: aggFieldName,
					index: 0,
					getType: () => TypeMap[relatedGQLEntityName + 'FilterInput'],
					target: GQLEntity,
					typeOptions: { nullable: true },
					deprecationReason: undefined,
					validateFn: undefined,
					validateSettings: undefined,
				});

				// Store in AggregateFieldsMap
				AggregateFieldsMap[gqlEntityName] = AggregateFieldsMap[gqlEntityName] || {};
				AggregateFieldsMap[gqlEntityName][aggFieldName] = {
					aggregateFieldName: aggFieldName,
					fn,
					column,
					relationshipFieldName: fieldNameToUse,
					relatedEntityName,
				};

				// Register numeric filter operators on the entity's FilterInput
				// Supports: totalPages_eq, totalPages_gt, totalPages: 500, TotalPages: { _gt: 500 }
				const aggFilterOperators: Array<{ key: string }> = [
					{ key: '_eq' },
					{ key: '_ne' },
					{ key: '_gt' },
					{ key: '_gte' },
					{ key: '_lt' },
					{ key: '_lte' },
				];

				for (const op of aggFilterOperators) {
					const opFieldName = aggFieldName + op.key;
					metadata.collectClassFieldMetadata({
						target: GQLEntityFilterInput,
						name: opFieldName,
						schemaName: opFieldName,
						getType: () => Float,
						typeOptions: { nullable: true },
						complexity: undefined,
						description: `Filter by ${aggFieldName} ${op.key}`,
						deprecationReason: undefined,
					});
				}

				// totalPages: 500 (implicit _eq)
				metadata.collectClassFieldMetadata({
					target: GQLEntityFilterInput,
					name: aggFieldName,
					schemaName: aggFieldName,
					getType: () => Float,
					typeOptions: { nullable: true },
					complexity: undefined,
					description: `Filter by ${aggFieldName} (equals)`,
					deprecationReason: undefined,
				});

				// TotalPages: { _gt: 500 } (nested object form)
				const UppercasedAggFieldName = aggFieldName[0].toUpperCase() + aggFieldName.slice(1);
				const aggFieldFilterTypeName = `${gqlEntityName}_${UppercasedAggFieldName}`;

				@InputType(aggFieldFilterTypeName)
				class AggregateFieldFilterInput {}

				Object.defineProperty(AggregateFieldFilterInput, 'name', {
					value: aggFieldFilterTypeName,
				});
				TypeMap[aggFieldFilterTypeName] = AggregateFieldFilterInput;

				for (const op of aggFilterOperators) {
					metadata.collectClassFieldMetadata({
						target: AggregateFieldFilterInput,
						name: op.key,
						schemaName: op.key,
						getType: () => Float,
						typeOptions: { nullable: true },
						complexity: undefined,
						description: op.key,
						deprecationReason: undefined,
					});
				}

				InputType(aggFieldFilterTypeName)(AggregateFieldFilterInput);

				metadata.collectClassFieldMetadata({
					target: GQLEntityFilterInput,
					name: UppercasedAggFieldName,
					schemaName: UppercasedAggFieldName,
					getType: () => AggregateFieldFilterInput,
					typeOptions: { nullable: true },
					complexity: undefined,
					description: `Filter by ${aggFieldName} with operators`,
					deprecationReason: undefined,
				});
			}
		}
	}
}

/** Phase 6: declare ExistsFilterInput (one field per relationship) + register _exists/_not_exists on FilterInput. */
function _registerExistsFilters<T>(
	gqlEntityName: string,
	fields: string[],
	opts: Partial<FieldsSettings<T>>,
	metadata: ReturnType<typeof getMetadataStorage>,
	GQLEntityFilterInput: any
) {
	// Generate ExistsFilterInput with a field for each relationship
	const relationshipFields = fields.filter((f) => {
		const opts2 = (opts as any)[f];
		return opts2 && 'array' in opts2 && opts2.array && opts2.relatedEntityName;
	});

	if (relationshipFields.length > 0) {
		@InputType(gqlEntityName + 'ExistsFilterInput')
		class GQLEntityExistsFilterInput {}
		Object.defineProperty(GQLEntityExistsFilterInput, 'name', {
			value: gqlEntityName + 'ExistsFilterInput',
		});
		TypeMap[gqlEntityName + 'ExistsFilterInput'] = GQLEntityExistsFilterInput;

		for (const relFieldName of relationshipFields) {
			const relOpts = (opts as any)[relFieldName];
			const relEntityName = relOpts.relatedEntityName();
			const relGQLEntityName = getGQLEntityNameFor(relEntityName);
			const relFilterTypeName = relGQLEntityName + 'FilterInput';

			metadata.collectClassFieldMetadata({
				target: GQLEntityExistsFilterInput,
				name: relFieldName,
				schemaName: relFieldName,
				getType: () => {
					const type = TypeMap[relFilterTypeName];
					if (!type) {
						throw new Error(
							`gql-of-power: FilterInput for related entity "${relGQLEntityName}" (${relFilterTypeName}) ` +
								`is not registered. Make sure ${relGQLEntityName}'s buildResolvers() is called ` +
								`(or use createGQLTypes / @GQLEntityClass) before building the schema.`
						);
					}
					return type;
				},
				typeOptions: { nullable: true },
				complexity: undefined,
				description: `Filter ${relFieldName} by their fields for existence check`,
				deprecationReason: undefined,
			});
		}

		InputType(gqlEntityName + 'ExistsFilterInput')(GQLEntityExistsFilterInput);

		// Register _exists and _not_exists on the entity's FilterInput
		metadata.collectClassFieldMetadata({
			target: GQLEntityFilterInput,
			name: '_exists',
			schemaName: '_exists',
			getType: () => GQLEntityExistsFilterInput,
			typeOptions: { nullable: true },
			complexity: undefined,
			description:
				'Check that related entities exist matching the given filters. Multiple keys are AND-combined.',
			deprecationReason: undefined,
		});

		metadata.collectClassFieldMetadata({
			target: GQLEntityFilterInput,
			name: '_not_exists',
			schemaName: '_not_exists',
			getType: () => GQLEntityExistsFilterInput,
			typeOptions: { nullable: true },
			complexity: undefined,
			description:
				'Check that NO related entities exist matching the given filters. Multiple keys are AND-combined.',
			deprecationReason: undefined,
		});
	}
}

function _buildResolversForEntity<T>(
	GQLEntity: new () => any,
	gqlEntityName: string,
	fields: string[],
	opts: Partial<FieldsSettings<T>>,
	metadata: ReturnType<typeof getMetadataStorage>,
	customFields?: CustomFieldsSettings<T>,
	rawFields?: Partial<FieldsSettings<T>>
) {
	// ─── Phase 1: define base input types + resolver shell ──────────────────
	class GQLEntityFilterInput {
		@Field(() => [GQLEntityFilterInput], { nullable: true })
		_and?: GQLEntityFilterInput[];

		@Field(() => [GQLEntityFilterInput], { nullable: true })
		_or?: GQLEntityFilterInput[];

		@Field(() => [GQLEntityFilterInput], { nullable: true })
		_not?: GQLEntityFilterInput[];
	}
	Object.defineProperty(GQLEntityFilterInput, 'name', {
		value: gqlEntityName + 'FilterInput',
	});
	TypeMap[gqlEntityName + 'FilterInput'] = GQLEntityFilterInput;

	class GQLEntityOrderBy {}
	Object.defineProperty(GQLEntityOrderBy, 'name', {
		value: gqlEntityName + 'OrderBy',
	});
	TypeMap[gqlEntityName + 'OrderBy'] = GQLEntityOrderBy;

	@Resolver(() => GQLEntity)
	class FieldsResolver {}

	// ─── Phases 3-6: delegate to focused helpers ────────────────────────────

	if (customFields) {
		_processCustomFields(
			customFields,
			gqlEntityName,
			GQLEntity,
			GQLEntityFilterInput,
			FieldsResolver,
			opts,
			metadata
		);
	}

	const GQLEntityPaginationInputField = _registerFiltersAndPagination(
		gqlEntityName,
		fields,
		opts,
		metadata,
		GQLEntity,
		GQLEntityOrderBy,
		GQLEntityFilterInput
	);

	_registerCountFields(gqlEntityName, fields, opts, metadata, GQLEntity, GQLEntityFilterInput);

	_registerExistsFilters(gqlEntityName, fields, opts, metadata, GQLEntityFilterInput);

	InputType(gqlEntityName + 'FilterInput')(GQLEntityFilterInput);

	const GQLEntityInput = _buildInputType(gqlEntityName, fields, opts, metadata, customFields);

	return {
		GQLEntityFilterInput: GQLEntityFilterInput as any as GQLEntityFilterInputFieldType<T>,
		GQLEntityPaginationInputField:
			GQLEntityPaginationInputField as any as GQLEntityPaginationInputType<T>,
		GQLEntityOrderBy,
		GQLEntityInput,
		FieldsResolver,
		bindFieldResolvers: (_c: any) => {},
	};
}

// ─── Convenience wrapper ─────────────────────────────────────────────────────

/**
 * Convenience wrapper — creates entity, builds resolvers, and returns everything merged.
 * Equivalent to calling `createGQLEntity(...).buildResolvers()` and merging results.
 * Use this for entities that have no circular import issues.
 */
export function createGQLTypes<T extends Object, K>(
	classType: new () => T,
	opts: Partial<FieldsSettings<T>>,
	extra: {
		customFields?: CustomFieldsSettings<T>;
		acl?: AccessControlEntry<T, K>;
	} = {}
) {
	const entityDef = createGQLEntity(classType, opts, extra);
	const resolverDef = entityDef.buildResolvers();
	return {
		...entityDef,
		...resolverDef,
	};
}

// ─── Filter/sort metadata builder ───────────────────────────────────────────

/**
 * Creates filter and sorting metadata for a field. Called during buildResolvers().
 */
export function createGQLEntityFilters<T, K>(
	fieldOptions: FieldSettings | RelatedFieldSettings<T>,
	fieldName: string,
	GQLEntity: new () => T,
	metadata: TypeGQLMetadataStorage,
	GQLEntityOrderBy: any,
	gqlEntityName: string,
	GQLEntityFilterInput: new () => K
) {
	const getType: FieldSettings['type'] = fieldOptions.type;

	const isArray = 'array' in fieldOptions && fieldOptions.array;

	const UppercasedFieldName = fieldName[0].toUpperCase() + fieldName.slice(1);
	if (fieldOptions.generateFilter) {
		/**
		 * SORTING
		 * right now sorting by reference is not supported
		 */
		if (!isArray) {
			const orderByField = {
				target: GQLEntityOrderBy,
				name: fieldName,
				schemaName: fieldName,
				complexity: undefined,
				description: fieldName,
				deprecationReason: undefined,
				getType: () => Sort,
				options: { ...fieldOptions.options, nullable: true },
				typeOptions: { ...fieldOptions.options, nullable: true },
			} as FieldParameter;
			metadata.collectClassFieldMetadata(orderByField);
		}

		/**
		 * FILTERING
		 */
		const inputFieldName = `${gqlEntityName}_${UppercasedFieldName}`;
		@InputType(inputFieldName)
		class GQLEntityFilterInputField {
			@Field(() => [GQLEntityFilterInputField], {
				nullable: true,
				deprecationReason: 'this is the same as using an object with multiple values',
			})
			_and?: GQLEntityFilterInputField[];

			@Field(() => [GQLEntityFilterInputField], { nullable: true })
			_or?: GQLEntityFilterInputField[];

			@Field(() => [GQLEntityFilterInputField], { nullable: true })
			_not?: GQLEntityFilterInputField[];
		}
		Object.defineProperty(GQLEntityFilterInputField, 'name', {
			value: inputFieldName,
		});
		TypeMap[inputFieldName] = GQLEntityFilterInputField;

		const options: Array<{
			key: keyof typeof FieldOperations;
			array?: boolean;
			appliesToArray?: boolean;
		}> = [
			{ key: '_eq' },
			{ key: '_ne' },
			{ key: '_in', array: true },
			{ key: '_nin', array: true },
			{ key: '_gt' },
			{ key: '_gte' },
			{ key: '_lt' },
			{ key: '_lte' },
			{ key: '_like' },
			{ key: '_re' },
			{ key: '_ilike' },
			{ key: '_fulltext' },
			{ key: '_overlap', appliesToArray: true },
			{ key: '_contains', array: true, appliesToArray: true },
			{ key: '_contained' },
			{ key: '_exists' },
			{ key: '_between', array: true },
		];
		const canFilterForField = 'type' in fieldOptions;
		const includeNotArrays = !('relatedEntityName' in fieldOptions);
		const getFilterType = 'getFilterType' in fieldOptions && fieldOptions.getFilterType;

		const applicableOptions = canFilterForField
			? options.filter(
					({ appliesToArray }) =>
						(!appliesToArray && includeNotArrays) || (appliesToArray && getFilterType)
				)
			: [];

		if (canFilterForField && applicableOptions.length > 0) {
			for (const option of applicableOptions) {
				const optionGQLName = fieldName + option.key;
				metadata.collectClassFieldMetadata(
					buildFilterFieldParameter(
						GQLEntityFilterInput,
						optionGQLName,
						option,
						fieldOptions,
						getType,
						getFilterType
					)
				);
				metadata.collectClassFieldMetadata(
					buildFilterFieldParameter(
						GQLEntityFilterInputField,
						option.key,
						option,
						fieldOptions,
						getType,
						getFilterType
					)
				);
			}
		}
		if (!('relatedEntityName' in fieldOptions)) {
			const fieldFilterValue = {
				target: GQLEntityFilterInput,
				name: fieldName,
				schemaName: fieldName,
				getType: getType,
				options: fieldOptions.options,
				typeOptions: { nullable: true },
				complexity: undefined,
				description: fieldName,
				deprecationReason: undefined,
			} as FieldParameter;
			metadata.collectClassFieldMetadata(fieldFilterValue);
		}

		const fieldFilter = {
			target: GQLEntityFilterInput,
			name: UppercasedFieldName,
			schemaName: UppercasedFieldName,
			getType:
				'relatedEntityName' in fieldOptions
					? () => {
							return (
								TypeMap[getGQLEntityNameFor(fieldOptions.relatedEntityName()) + 'FilterInput'] ??
								GQLEntityFilterInputField
							);
						}
					: () => GQLEntityFilterInputField,
			options: { ...fieldOptions.options, nullable: true },
			typeOptions: { nullable: true },
			complexity: undefined,
			description: fieldName,
			deprecationReason: undefined,
		} as FieldParameter;
		metadata.collectClassFieldMetadata(fieldFilter);

		// Register relation fields for nested-filter enum conversion. The nested
		// FilterInput is exposed under both the camelCased fieldName (above) and the
		// UppercasedFieldName — record both so convertFilterEnumValues can resolve
		// whichever key the caller uses.
		if ('relatedEntityName' in fieldOptions && fieldOptions.relatedEntityName) {
			RelationFieldsMap[gqlEntityName] = RelationFieldsMap[gqlEntityName] || {};
			const relThunk = fieldOptions.relatedEntityName as () => string;
			RelationFieldsMap[gqlEntityName][fieldName] = relThunk;
			RelationFieldsMap[gqlEntityName][UppercasedFieldName] = relThunk;
		}

		if ('array' in fieldOptions && 'relatedEntityName' in fieldOptions) {
			const relatedEntityName = getGQLEntityNameFor(fieldOptions.relatedEntityName());

			metadata.collectHandlerParamMetadata({
				kind: 'arg',
				name: 'filter',
				description: undefined,
				methodName: fieldName,
				index: 0,
				getType: () => TypeMap[relatedEntityName + 'FilterInput'],
				target: GQLEntity,
				typeOptions: { nullable: true },
				deprecationReason: undefined,
				validateFn: undefined,
				validateSettings: undefined,
			});
			metadata.collectHandlerParamMetadata({
				kind: 'arg',
				name: 'pagination',
				description: undefined,
				methodName: fieldName,
				index: 1,
				getType: () => TypeMap[`${relatedEntityName}PaginationInput`],
				target: GQLEntity,
				typeOptions: { nullable: true },
				deprecationReason: undefined,
				validateFn: undefined,
				validateSettings: undefined,
			});
		}
	}
}

/**
 * @deprecated Use createGQLEntityFilters. This alias is kept for any external callers.
 */
export const createGQLEntityFields = createGQLEntityFilters;
