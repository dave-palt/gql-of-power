import {
	Field,
	FieldResolver,
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
	CustomFieldsSettings,
	FieldSettings,
	FieldsSettings,
	GQLEntityFilterInputFieldType,
	GQLEntityPaginationInputType,
	OrderByOptions,
	RelatedFieldSettings,
	Sort,
} from '../types';
import { AccessControlEntry, AccessControlList } from '../types/access-control';
import { keys } from '../utils';

// ─── Internal registries ────────────────────────────────────────────────────

const TypeMap: { [key: string]: any } = {};

const FieldsOptionsMap: Record<string, Record<string, string>> = {};
const CustomFieldsMap: Record<string, CustomFieldsSettings<any>> = {};
const CountFieldsMap: Record<string, Record<string, CountFieldMeta>> = {};
const MapEnumFieldsMap: Record<string, Record<string, any>> = {};

const aclMap: AccessControlList<any, any> = {};

/** Auto-resolver registry: gqlEntityName → FieldsResolver class */
const autoResolverRegistry = new Map<string, new () => any>();

// ─── Global config ───────────────────────────────────────────────────────────

let gqlTypesSuffix = '';
let gqlSortSuffix = '';
let sortEnumRegistered = false;

export const setGlobalConfig = (config: { gqlTypesSuffix?: string; gqlSortSuffix?: string }) => {
	if (config.gqlTypesSuffix !== undefined) gqlTypesSuffix = config.gqlTypesSuffix;
	if (config.gqlSortSuffix !== undefined) gqlSortSuffix = config.gqlSortSuffix;
};

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
export const getMapEnumFieldsFor = (name: string): Record<string, any> =>
	MapEnumFieldsMap[name] ?? {};

export const clearMapEnumFields = (): void => {
	for (const key of Object.keys(MapEnumFieldsMap)) {
		delete MapEnumFieldsMap[key];
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

			const fieldNameOverride = (fieldOptions as any).alias;
			if (fieldNameOverride) {
				FieldsOptionsMap[gqlEntityName] = FieldsOptionsMap[gqlEntityName] || {};
				FieldsOptionsMap[gqlEntityName][fieldNameOverride] = fieldName;
			}
			const fieldNameToUse = fieldNameOverride ?? fieldName;
			const isArray = 'array' in fieldOptions && fieldOptions.array;

			if ((fieldOptions as any).mapNumericEnum) {
				try {
					const enumObj = fieldOptions.type();
					MapEnumFieldsMap[gqlEntityName] = MapEnumFieldsMap[gqlEntityName] || {};
					MapEnumFieldsMap[gqlEntityName][fieldNameToUse] = enumObj;
				} catch {
					// type thunk may throw for forward refs — safe to skip
				}
			}

			metadata.collectClassFieldMetadata({
				target: GQLEntity,
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
			// Try to derive relatedEntityName from the type thunk
			const derivedRelatedEntityName = () => {
				const typeClass = (fieldOptions as any).type?.();
				return (typeClass as any)?.relatedEntityName ?? typeClass?.name ?? '';
			};
			(resolved as any)[fieldName] = {
				...fieldOptions,
				relatedEntityName: derivedRelatedEntityName,
			};
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
		const fieldNameOverride = fieldOptions.alias;
		if (fieldNameOverride) {
			FieldsOptionsMap[gqlEntityName] = FieldsOptionsMap[gqlEntityName] || {};
			FieldsOptionsMap[gqlEntityName][fieldNameOverride] = fieldName;
		}
		const fieldNameToUse = fieldNameOverride ?? fieldName;

		if ((fieldOptions as any).mapNumericEnum) {
			try {
				const enumObj = fieldOptions.type();
				MapEnumFieldsMap[gqlEntityName] = MapEnumFieldsMap[gqlEntityName] || {};
				MapEnumFieldsMap[gqlEntityName][fieldNameToUse] = enumObj;
			} catch {
				// type thunk may throw for forward refs — safe to skip
			}
		}

		const isArray = 'array' in fieldOptions && fieldOptions.array;
		metadata.collectClassFieldMetadata({
			target: GQLEntity,
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

// ─── Shared resolver builder ─────────────────────────────────────────────────

function _buildResolversForEntity<T>(
	GQLEntity: new () => any,
	gqlEntityName: string,
	fields: string[],
	opts: Partial<FieldsSettings<T>>,
	metadata: ReturnType<typeof getMetadataStorage>,
	customFields?: CustomFieldsSettings<T>,
	rawFields?: Partial<FieldsSettings<T>>
) {
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

	if (rawFields) {
		for (const fieldName of Object.keys(rawFields)) {
			const fieldOpts = (rawFields as any)[fieldName];
			if (!fieldOpts?.mapNumericEnum) continue;

			const fieldNameToUse = fieldOpts.alias ?? fieldName;
			const enumTypeThunk = fieldOpts.type;

			const resolveFn = (root: any) => {
				const value = root[fieldNameToUse];
				if (value === null || value === undefined) return null;
				try {
					const enumObj = enumTypeThunk();
					const key = enumObj[value];
					if (typeof key === 'string') return key;
					for (const enumKey of Object.keys(enumObj)) {
						if (enumObj[enumKey] === value) return enumKey;
					}
					return value;
				} catch {
					return value;
				}
			};

			Object.defineProperty(FieldsResolver.prototype, fieldNameToUse, {
				value: resolveFn,
				writable: true,
				configurable: true,
			});

			FieldResolver(enumTypeThunk, {
				...fieldOpts.options,
				name: fieldNameToUse,
			})(
				FieldsResolver.prototype,
				fieldNameToUse,
				Object.getOwnPropertyDescriptor(FieldsResolver.prototype, fieldNameToUse)!
			);

			Root()(FieldsResolver.prototype, fieldNameToUse, 0);
		}
	}

	if (customFields) {
		CustomFieldsMap[gqlEntityName] = customFields;

		for (const fieldName of keys(customFields)) {
			const fieldOptions = fieldName in customFields ? customFields[fieldName] : undefined;

			if (!fieldOptions) {
				continue;
			}
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
			if (fieldOptions.resolve) {
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
			} else if ('mapping' in fieldOptions && fieldOptions.mapping) {
				// mapping strategy: SQL mapper generates the JOIN — no FieldResolver needed
				if (fieldOptions.generateFilter) {
					const UppercasedFieldName = fieldNameToUse[0].toUpperCase() + fieldNameToUse.slice(1);
					const refEntityName = fieldOptions.mapping.refEntity.name;
					const refGqlEntityName = getGQLEntityNameFor(refEntityName);
					const refFilterTypeName = refGqlEntityName + 'FilterInput';

					metadata.collectClassFieldMetadata({
						target: GQLEntityFilterInput,
						name: UppercasedFieldName,
						schemaName: UppercasedFieldName,
						getType: () => TypeMap[refFilterTypeName] ?? GQLEntityFilterInput,
						typeOptions: { nullable: true },
						complexity: undefined,
						description: `Filter by ${fieldNameToUse} fields`,
						deprecationReason: undefined,
					});
				}
			}
		}
	}

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
	}

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
				getType: () => TypeMap[relFilterTypeName] ?? GQLEntityFilterInput,
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

	InputType(gqlEntityName + 'FilterInput')(GQLEntityFilterInput);

	return {
		GQLEntityFilterInput: GQLEntityFilterInput as any as GQLEntityFilterInputFieldType<T>,
		GQLEntityPaginationInputField:
			GQLEntityPaginationInputField as any as GQLEntityPaginationInputType<T>,
		GQLEntityOrderBy,
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

type TypeGQLMetadataStorage = ReturnType<typeof getMetadataStorage>;
type FieldParameter = Parameters<TypeGQLMetadataStorage['collectClassFieldMetadata']>[0];

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
				const backCompFieldFilterOpt = {
					target: GQLEntityFilterInput,
					name: optionGQLName,
					schemaName: optionGQLName,
					getType: option.appliesToArray && getFilterType ? getFilterType : getType,
					options: {
						...fieldOptions.options,
						...(option.array || option.appliesToArray ? { array: true, arrayDepth: 1 } : {}),
						nullable: true,
					},
					typeOptions: {
						...(option.array || option.appliesToArray ? { array: true, arrayDepth: 1 } : {}),
						nullable: true,
					},
					complexity: undefined,
					description: optionGQLName,
					deprecationReason: undefined,
				} as FieldParameter;
				metadata.collectClassFieldMetadata(backCompFieldFilterOpt);

				const fieldFilterOpt = {
					target: GQLEntityFilterInputField,
					name: option.key,
					schemaName: option.key,
					getType: option.appliesToArray && getFilterType ? getFilterType : getType,
					options: {
						...fieldOptions.options,
						...(option.array || option.appliesToArray ? { array: true, arrayDepth: 1 } : {}),
						nullable: true,
					},
					typeOptions: {
						...(option.array || option.appliesToArray ? { array: true, arrayDepth: 1 } : {}),
						nullable: true,
					},
					complexity: undefined,
					description: option.key,
					deprecationReason: undefined,
				} as FieldParameter;
				metadata.collectClassFieldMetadata(fieldFilterOpt);
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

		if ('array' in fieldOptions) {
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
