// fallow-ignore-file unused-class-member -- ClassOperations is an abstract filter-operation shape: implemented by FilterProcessor subclasses and dispatched dynamically by key (this[gqlFieldNameKey]) in processFilter, so its members have no static references.
export * from './field-operations';
import { Alias } from './queries/alias';
import { CustomFieldsSettings, EntityMetadata } from './types/sql-types';
import { MappingsType } from './types/gql-to-sql-types';
import { GQLEntityFilterInputFieldType } from './types/gql-types';

export type ClassOperationInputType<T> = {
	entityMetadata: EntityMetadata<T>;
	gqlFilters: GQLEntityFilterInputFieldType<T>[];
	fieldName: string &
		(keyof Pick<MappingsType, '_and' | '_not' | '_or'> | '_exists' | '_not_exists');
	parentAlias: Alias;
	alias: Alias;
	mapping: MappingsType;
	mappings: Map<string, MappingsType>;
	customFields?: CustomFieldsSettings<T>;
};

export abstract class ClassOperations {
	abstract _and(input: ClassOperationInputType<any>): any;
	abstract _or(input: ClassOperationInputType<any>): any;
	abstract _not(input: ClassOperationInputType<any>): any;
	abstract _exists(input: ClassOperationInputType<any>): any;
	abstract _not_exists(input: ClassOperationInputType<any>): any;
}
