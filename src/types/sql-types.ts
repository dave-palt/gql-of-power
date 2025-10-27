import { Knex } from 'knex';
import { Field, FieldResolver, registerEnumType } from 'type-graphql';
import { FieldOperations } from '../operations';
import { GQLEntityFilterInputFieldType, GQLEntityPaginationInputType } from './gql-types';
import { ExtractArrayType } from './utils';

export enum ReferenceType {
	ONE_TO_ONE = '1:1',
	ONE_TO_MANY = '1:m',
	MANY_TO_ONE = 'm:1',
	MANY_TO_MANY = 'm:n',
}
export type EntityProperty = {
	type: string;
	reference?: ReferenceType | string;
	name: string;
	fieldNames: string[];
	mappedBy: string;
	joinColumns: string[];
	referencedColumnNames: string[];
	inverseJoinColumns: string[];
	pivotTable: string;
};

export type EntityMetadata<T> = {
	primaryKeys: string[];
	name?: string;
	tableName: string;
	properties: {
		[key in (string & keyof T) | string]: EntityProperty;
	};
};

export type RawSQLHandler = {
	rawQuery: (sql: string, bindings?: any) => string;
};

export type SqlClientConfiguration = {
	client: string | typeof Knex.Client;
};

export type DatabaseDriver = RawSQLHandler | SqlClientConfiguration;

export type MetadataProvider = {
	exists: (entityName: string) => boolean;
	getMetadata: <T, K extends EntityMetadata<T>>(entityName: string) => K;
	executeQuery: (sql: string, ...params: any[]) => Promise<any>;
} & SqlClientConfiguration;

export type MetadataProviderType = MetadataProvider & DatabaseDriver;

export enum Sort {
	ASC = 'asc',
	DESC = 'desc',
}
export type OrderByOptions = {
	[x: string]: Sort;
};

export type EnumData = Parameters<typeof registerEnumType>;

type GetFieldType = NonNullable<Parameters<typeof Field>[0]>;
type GetFieldResolverType = NonNullable<Parameters<typeof FieldResolver>[0]>;

export type FieldBaseSettings = { generateFilter?: boolean; enum?: EnumData } & (
	| {}
	| {
			array: true;
			relatedEntityName: () => string;
			/**
			 * GQL Type for contains or overlap.
			 * This should match the type of the related field like id (probably Int).
			 * Without this the filters overlap and contains will not be generated.
			 */
			getFilterType?: GetFieldResolverType;
			alias?: string;
	  }
);

export type FieldOptions = Parameters<typeof Field>[1];
export type RelatedFieldOptions = Parameters<typeof FieldResolver>[1];

export type FieldSettings = FieldBaseSettings & {
	type: GetFieldType;
	options?: FieldOptions;
	alias?: string;
};

export type RelatedFieldSettings<T> = FieldBaseSettings & {
	type: GetFieldResolverType;
	options?: RelatedFieldOptions;
	/**
	 * Required field/s to resolve the custom field.
	 * Example: the custom field is for Account and requires accountId set this to 'accountId' and it will be fetched from the entity even if accountId is not requested in the gql query.
	 */
	requires?: (string & keyof T) | Array<string & keyof T>;
	resolve?: (...any: any) => any;
	alias?: string;
};

export type FieldsSettings<T> = {
	[key in string & keyof T]: FieldSettings;
};
export type CustomFieldsSettings<T> = {
	[key in Exclude<string, keyof T>]: RelatedFieldSettings<T>;
};

export type GQLArgumentsFilterAndPagination<T> =
	| {
			filter: GQLEntityFilterInputFieldType<T>;
	  }
	| {
			pagination: GQLEntityPaginationInputType<T>;
	  };

export type ActualValueType<T> = Exclude<T, undefined | null>;
export type ExtractType<T> = ActualValueType<T> extends Array<infer K>
	? ActualValueType<K>
	: ActualValueType<T>;

export type FieldsDetailsMap<T> = {
	[key in keyof ExtractArrayType<T>]?: FieldDetails<ExtractArrayType<T>, key>;
};
export type FieldDetails<T, K extends keyof T> = {
	name?: K;
	alias?: string;
	args?: Record<string, any> | GQLArgumentsFilterAndPagination<ExtractArrayType<T[K]>>;
	fieldsByTypeName?: Partial<{
		[key: string]: FieldsDetailsMap<ExtractArrayType<T[K]>>;
	}>;
};
// Simple field selection type for GraphQL field selection (like graphql-parse-resolve-info output)
export type FieldSelection<T> = Partial<{
	[K in keyof ExtractArrayType<T>]?: FieldDetails<ExtractArrayType<T>, K> | {};
}>;

// Keep the original complex Fields type for when it's needed
export type Fields<
	T,
	/**
	 *
	 */
	ArrayIdentifierFieldName extends string = 'getItems',
	SingleRecordIdentifierFieldName extends string = 'getEntity'
> = Partial<{
	[key in string & keyof NonNullable<T>]: NonNullable<NonNullable<T>[key]> extends Array<infer E>
		?
				| Fields<NonNullable<E>, ArrayIdentifierFieldName, SingleRecordIdentifierFieldName>
				| GQLArgumentsFilterAndPagination<NonNullable<E>>
		: NonNullable<NonNullable<T>[key]> extends infer K
		? K extends infer E
			? ArrayIdentifierFieldName extends keyof NonNullable<E>
				? NonNullable<E>[ArrayIdentifierFieldName] extends () => infer F
					? F extends Array<infer G>
						? Partial<
								| Fields<G, ArrayIdentifierFieldName, SingleRecordIdentifierFieldName> &
										(
											| {
													[key in string & keyof typeof FieldOperations]?: Fields<
														NonNullable<G>,
														ArrayIdentifierFieldName,
														SingleRecordIdentifierFieldName
													>[];
											  }
											| GQLArgumentsFilterAndPagination<G>
										)
						  >
						: {}
					: {}
				: SingleRecordIdentifierFieldName extends keyof NonNullable<K>
				? NonNullable<K>[SingleRecordIdentifierFieldName] extends () => infer F
					?
							| Fields<NonNullable<F>, ArrayIdentifierFieldName, SingleRecordIdentifierFieldName> &
									(
										| Partial<{
												[Key in string & keyof F as `${Capitalize<Key>}`]: {
													[key in string & keyof typeof FieldOperations]?: Fields<
														NonNullable<F>,
														ArrayIdentifierFieldName,
														SingleRecordIdentifierFieldName
													>[];
												};
										  }>
										| GQLArgumentsFilterAndPagination<F>
									)
					: Fields<NonNullable<K>, ArrayIdentifierFieldName, SingleRecordIdentifierFieldName>
				: NonNullable<T>[key] | GQLArgumentsFilterAndPagination<NonNullable<T>[key]>
			: Fields<
					NonNullable<NonNullable<T>[key]>,
					ArrayIdentifierFieldName,
					SingleRecordIdentifierFieldName
			  >
		: {};
}>;
