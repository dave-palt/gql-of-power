/**
 * Enum filter value conversion — shared module.
 *
 * Converts GraphQL enum string keys (e.g. `'Active'`) into their raw DB values
 * (e.g. `0`) inside filter objects before they reach SQL generation.
 *
 * Extracted from `query-manager.ts` so that both `GQLQueryManager` (top-level
 * filter path) and `GQLtoSQLMapper` (inline field-argument filter path) can
 * import it without a circular dependency:
 *
 *   gql-to-sql-mapper ← (would cycle) ← query-manager
 *   gql-to-sql-mapper ← enum-filter-converter → gql-entity
 *   query-manager     ← enum-filter-converter → gql-entity
 */
import {
	getCustomFieldsFor,
	getGQLEntityNameFor,
	getMapEnumFieldsFor,
	getRelationFieldsFor,
} from '../entities/gql-entity';

const ENUM_OPERATORS = [
	'_eq',
	'_ne',
	'_gt',
	'_gte',
	'_lt',
	'_lte',
	'_like',
	'_re',
	'_ilike',
	'_fulltext',
	'_in',
	'_nin',
	'_between',
] as const;

/** Keys whose (array) value should be recursively enum-converted element-by-element. */
const LOGICAL_KEYS = new Set(['_and', '_or', '_not']);
/** Keys that are always passed through verbatim (existence subquery shapes). */
const PASSTHROUGH_KEYS = new Set(['_exists', '_not_exists']);

export function toDbValue(value: any, enumObj: any, isArray: boolean): any {
	if (value === null || value === undefined) return value;
	if (isArray && Array.isArray(value)) {
		return value.map((v) => {
			if (typeof v === 'string' && v in enumObj) return enumObj[v];
			return v;
		});
	}
	if (typeof value === 'string' && value in enumObj) return enumObj[value];
	return value;
}

export function findEnumFieldName(key: string, enumFields: Record<string, any>): string | null {
	if (key in enumFields) return key;
	for (const op of ENUM_OPERATORS) {
		if (key.endsWith(op)) {
			const fieldName = key.slice(0, -op.length);
			if (fieldName in enumFields) return fieldName;
		}
	}
	const lowercased = key.charAt(0).toLowerCase() + key.slice(1);
	if (lowercased in enumFields) return lowercased;
	return null;
}

/** Convert an operator-keyed object (e.g. { _eq: 'X', _in: [...] }) whose target is an enum field. */
export function convertOperatorObject(
	operatorObject: Record<string, any>,
	enumObj: any
): Record<string, any> {
	const converted: Record<string, any> = {};
	for (const [op, opVal] of Object.entries(operatorObject)) {
		const isArr = op === '_in' || op === '_nin';
		converted[op] = toDbValue(opVal, enumObj, isArr);
	}
	return converted;
}

/** Recurse into a mapped custom-field nested filter using the referenced entity's enums. */
export function convertMappedCustomField(
	key: string,
	value: any,
	mappedCustomFields: Record<string, { mapping: { refEntity: new () => any } }>
): any {
	const lowercased = key.charAt(0).toLowerCase() + key.slice(1);
	const mappedField =
		mappedCustomFields[key as keyof typeof mappedCustomFields] ??
		mappedCustomFields[lowercased as keyof typeof mappedCustomFields];
	if (!mappedField) return value;
	const refGqlEntityName = getGQLEntityNameFor(mappedField.mapping.refEntity.name);
	const refEnumFields = getMapEnumFieldsFor(refGqlEntityName);
	const refCustomFields = getCustomFieldsFor(refGqlEntityName);
	const refRelationFields = getRelationFieldsFor(refGqlEntityName);
	return convertFilterEnumValues(value, refEnumFields, refCustomFields, refRelationFields);
}

/**
 * Recurse into a plain-`defineFields` relation nested filter using the target
 * entity's enums. The relation field is looked up in `RelationFieldsMap`
 * (registered by `createGQLEntityFilters`), which stores the target entity's
 * ORM name thunk. Falls back to returning the value untouched if the key isn't
 * a known relation field.
 */
export function convertRelationField(
	key: string,
	value: any,
	relationFields: Record<string, () => string>
): any {
	const lowercased = key.charAt(0).toLowerCase() + key.slice(1);
	const relThunk = relationFields[key] ?? relationFields[lowercased];
	if (!relThunk) return value;
	const targetGqlEntityName = getGQLEntityNameFor(relThunk());
	const targetEnumFields = getMapEnumFieldsFor(targetGqlEntityName);
	const targetCustomFields = getCustomFieldsFor(targetGqlEntityName);
	const targetRelationFields = getRelationFieldsFor(targetGqlEntityName);
	return convertFilterEnumValues(value, targetEnumFields, targetCustomFields, targetRelationFields);
}

export function convertFilterEnumValues(
	filter: any,
	enumFields: Record<string, any>,
	mappedCustomFields?: Record<string, { mapping: { refEntity: new () => any } }>,
	relationFields?: Record<string, () => string>
): any {
	if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return filter;
	if (
		Object.keys(enumFields).length === 0 &&
		!mappedCustomFields &&
		(!relationFields || Object.keys(relationFields).length === 0)
	)
		return filter;

	const result: any = {};
	for (const [key, value] of Object.entries(filter)) {
		result[key] = convertFilterEntry(key, value, enumFields, mappedCustomFields, relationFields);
	}
	return result;
}

/** Resolve a single filter key/value to its enum-converted form. */
export function convertFilterEntry(
	key: string,
	value: any,
	enumFields: Record<string, any>,
	mappedCustomFields?: Record<string, { mapping: { refEntity: new () => any } }>,
	relationFields?: Record<string, () => string>
): any {
	if (LOGICAL_KEYS.has(key)) {
		return Array.isArray(value)
			? value.map((v: any) =>
					convertFilterEnumValues(v, enumFields, mappedCustomFields, relationFields)
				)
			: value;
	}
	if (PASSTHROUGH_KEYS.has(key)) return value;

	const enumFieldName = findEnumFieldName(key, enumFields);
	if (enumFieldName) {
		const enumObj = enumFields[enumFieldName];
		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			return convertOperatorObject(value as Record<string, any>, enumObj);
		}
		const isArr = key.endsWith('_in') || key.endsWith('_nin');
		return toDbValue(value, enumObj, isArr);
	}

	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		if (mappedCustomFields) {
			const converted = convertMappedCustomField(key, value, mappedCustomFields);
			if (converted !== value) return converted;
		}
		if (relationFields) {
			return convertRelationField(key, value, relationFields);
		}
	}
	return value;
}
