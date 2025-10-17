import { Person } from '../../tests/fixtures/middle-earth-schema';
import { ClassOperationsClass, FieldOperationsClass } from '../operations';
import {
	ConcatConditionalArray,
	DefinedType,
	ExtractArrayType,
	OmitArrays,
	Primitives,
} from './utils';

/**
 * \[_field\]: T\[field\]
 *
 * @deprecated we don't use \[field\]: T\[field\] anymore
 */
export type FieldValuesType<T> = {
	[key in string & keyof OmitArrays<DefinedType<T>> as `_${key}`]?: Partial<
		ExtractArrayType<OmitArrays<DefinedType<T>>[key]>
	>;
};

/**
 * \[field_eq\]: T\[field\]
 */
export type FieldOperationsType<T> = Partial<
	ConcatConditionalArray<DefinedType<T>, FieldOperationsClass<DefinedType<T>>>
>;

/**
 *  - \[_eq\]: typeof T\[field\]
 *  - \[_in\]: typeof T\[field\]\[\]
 *  - etc...
 */
export type FieldValuesObjectOperationsType<T> = DefinedType<T> extends Array<infer K>
	? {
			[k in string &
				keyof Pick<
					FieldOperationsClass<DefinedType<K>>,
					'_in' | '_nin' | '_contains' | '_eq' | '_overlap'
				>]?: FieldOperationsClass<DefinedType<K>>[k] | null;
	  }
	: {
			[k in string & keyof FieldOperationsClass<DefinedType<T>>]?:
				| FieldOperationsClass<DefinedType<T>>[k]
				| null;
	  };

/**
 * { \[field\]: { _eq: typeof T\[field\], ... } }
 */
export type FieldValuesObjectType<T> = DefinedType<DefinedType<T>> extends Array<infer K>
	? Partial<FieldValuesObjectType<DefinedType<K>>>
	: DefinedType<T> extends Primitives
	? Partial<FieldValuesObjectOperationsType<DefinedType<T>>>
	: {
			[key in string & keyof DefinedType<T>]?: DefinedType<DefinedType<T>[key]> extends Array<
				infer K
			>
				? K extends Primitives
					? Partial<FieldValuesObjectOperationsType<ExtractArrayType<DefinedType<K>>>>
					: Partial<GQLEntityFilterInputFieldType<DefinedType<K>>>
				: Partial<GQLEntityFilterInputFieldType<DefinedType<DefinedType<T>[key]>>>;
	  };

/**
 *  - \[_field\]: T\[field\]
 *  - \[field_eq\]: T\[field\]
 *  - \[field\]: { _eq: typeof T\[field\], ... }
 */
export type FieldFilterType<T> = //FieldValuesType<T> &
	Partial<FieldValuesObjectType<T>> & Partial<FieldOperationsType<T>>;

/**
 *  - \[_and\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 *  - \[_or\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 *  - \[_not\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 */
export type ClassOperationsType<T> = Partial<{
	[key in string & keyof ClassOperationsClass<T>]?: Array<
		FieldFilterType<T> & ClassOperationsType<T>
	>;
}>;

/**
 *  - \[_field\]: T\[field\]
 *  - \[field_eq\]: T\[field\]
 *  - \[field\]: { _eq: typeof T\[field\], ... }
 *
 *  - \[_and\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 *  - \[_or\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 *  - \[_not\]: \[
 *      - \[_field\]: T\[field\]
 *      - \[field_eq\]: T\[field\]
 *      - \[field\]: { _eq: typeof T\[field\], ... }
 *  - \]
 */
export type GQLEntityFilterInputFieldType<T> = Partial<FieldFilterType<T>> & ClassOperationsType<T>;

export type GQLEntityFilterInputFieldValueType<T> = Partial<
	GQLEntityFilterInputFieldType<T>[keyof GQLEntityFilterInputFieldType<T>]
>;

export type GQLEntityOrderByInputType<T> = Record<string & keyof T, 'asc' | 'desc'>;

export type GQLEntityPaginationInputType<T> = {
	limit?: number;
	offset?: number;
	orderBy?: GQLEntityOrderByInputType<T>[];
};

// =================================================================================
// TESTS
// =================================================================================

type TestType = { fieldA?: string; b?: number[]; c?: { d?: boolean }[] };

type Y = OmitArrays<TestType>;
type X = ExtractArrayType<TestType['b']>;
type Z = FieldValuesObjectOperationsType<TestType['b']>;

type M = ExtractArrayType<DefinedType<DefinedType<TestType>['b']>>;

const _ZZ: Z = {
	_in: [1, 2, 3],
};

const _FieldValuesType: FieldValuesType<TestType> = {
	_fieldA: 'test',
};

const _FieldOperationsType: FieldOperationsType<TestType> = {
	fieldA_eq: 'test',
	fieldA_between: ['1', '2'],
	b_eq: 1, // FIXME: [1,2,3]
	b_in: [1, 2, 3],
};

const _FieldOperationObjectType_A: FieldValuesObjectOperationsType<TestType['fieldA']> = {
	_eq: 'test',
};
const _FieldOperationObjectType_B: FieldValuesObjectOperationsType<TestType['b']> = {
	_in: [1, 2, 3],
};
const _FieldOperationObjectType_C: FieldValuesObjectOperationsType<TestType['c']> = {
	_eq: {
		d: true,
	},
};

const _FieldValuesObjectType: FieldValuesObjectType<TestType> = {
	fieldA: {
		// ..._FieldOperationObjectType_A,
		_eq: 'test',
	},
	b: {
		..._FieldOperationObjectType_B,
		_in: [1, 2, 3],
	},
	c: {
		..._FieldOperationObjectType_C,
		// _d: true,
		d: {
			_eq: true,
		},
	},
};

const _FieldFilterType: FieldFilterType<TestType> = {
	..._FieldValuesType,
	..._FieldOperationsType,
	..._FieldValuesObjectType,
	//
	// _a: 'test',
	fieldA_eq: 'test',
	fieldA: { _eq: 'test' },
	b_eq: 1, // FIXME: [1,2,3]
	b: { _in: [1, 2, 3] },
	// a: {},
	c: {
		// _d: true,
		d: {},
	},
};

const _ClassOperationsType: ClassOperationsType<TestType> = {
	_and: [
		_FieldFilterType,
		{
			// _a: 'test',
			fieldA_between: ['1', '2'],
			fieldA: {
				_eq: 'test',
			},
			c: {
				// _d: true,
				d: {
					_eq: true,
				},
			},
		},
	],
};

const _GQLEntityFilterInputFieldType: GQLEntityFilterInputFieldType<TestType> = {
	..._FieldFilterType,
	..._ClassOperationsType,
	_and: [{ fieldA: { _eq: 'test' } }],
	fieldA: { _eq: 'test' },
	fieldA_eq: 'test',
	b_eq: 1, // FIXME: [1,2,3]
	b: { _in: [1, 2, 3], _gt: 5 },
	c: { d: { _eq: true }, d_eq: true },
};

const _Person: GQLEntityFilterInputFieldType<Person> = {
	name: { _like: '%Baggins%' },
	// name_eq: 'Frodo',
	// race_eq: 'Hobbit',
	fellowship: {
		name_eq: 'Gandalf',
	},
	battles: {
		name_eq: "Helm's Deep",
	},
	_or: [
		{
			name_eq: 'Gandalf',
		},
	],
};
const _ = { ..._GQLEntityFilterInputFieldType };
