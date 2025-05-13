import { Reference } from '@mikro-orm/core';
import { Field } from 'type-graphql';
import { ClassOperations, FieldOperations } from './operations';

export enum ReferenceType {
	ONE_TO_ONE = '1:1',
	ONE_TO_MANY = '1:m',
	MANY_TO_ONE = 'm:1',
	MANY_TO_MANY = 'm:n',
}
export type EntityProperty = {
	type: string;
	reference?: string;
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
		[key in string & keyof T]: EntityProperty;
	};
};

export type MetadataProvider = {
	exists: (arg: string) => boolean;
	getMetadata: <T, K extends EntityMetadata<T>>(arg: string) => K;
	rawQuery: (sql: string, bindings?: any) => string;
	executeQuery: (sql: string, params?: any[], _?: any) => Promise<any>;
};

export enum Sort {
	ASC = 'asc',
	DESC = 'desc',
}
export type OrderByOptions = {
	[x: string]: Sort;
};

export type Fields<T> = Partial<{
	[key in string & keyof T]: NonNullable<T[key]> extends Reference<infer K> ? Fields<K> : {};
}>;

export type FieldSettings = {
	type: NonNullable<Parameters<typeof Field>[0]>;
	options?: Parameters<typeof Field>[1];
	generateFilter?: boolean;
	array?: boolean;
};
export type RelatedFieldSettings = FieldSettings & {
	relatedEntityName: string;
};

export type FieldsSettings<T> = {
	[key in string & keyof T]: FieldSettings | RelatedFieldSettings;
};
export type CustomFieldsSettings<T> = {
	[key in Exclude<string, keyof T>]: (FieldSettings | RelatedFieldSettings) & {
		/**
		 * Required field to resolve the custom field.
		 * Example: the custom field is for Account and requires crmAccountId => 'crmAccountId'
		 */
		requires?: (string & keyof T) | Array<string & keyof T>;
		resolve: (obj: T) => any;
	};
};

export type GQLEntityFilterInputFieldType<T> = {
	[key in string & keyof T]?: T[key];
} & {
	[key in string & keyof typeof ClassOperations]?: GQLEntityFilterInputFieldType<T>[];
} & {
	[Key in string & keyof T as `${Capitalize<Key>}`]: {
		[key in string & keyof typeof FieldOperations]?: GQLEntityFilterInputFieldType<T>[];
	};
};
export type GQLEntityOrderByInputType<T> = {
	[Key in string & keyof T]: ['asc', 'desc'];
};
export type GQLEntityPaginationInputType<T> = {
	limit?: number;
	offset?: number;
	orderBy?: GQLEntityOrderByInputType<T>[];
};

export type MappingsType = {
	select: Set<string>;
	json: string[];
	filterJoin: string[];
	join: string[];
	where: string[];
	values: Record<string, any>;
	limit?: number;
	offset?: number;
	orderBy: GQLEntityOrderByInputType<any>[];
	alias: number;
};
