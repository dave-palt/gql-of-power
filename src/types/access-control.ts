import { GQLEntityFilterInputFieldType } from './gql-types';

export enum AccessType {
	Read = 'Read',
	Create = 'Create',
	Update = 'Update',
	Delete = 'Delete',
}

export type AccessControlList<T, U> = {
	[K in string]?: AccessControlEntry<T, U>;
};

export interface AccessControlEntry<T, U> {
	read?: AccessControlValue<T, U>;
	create?: AccessControlValue<T, U>;
	update?: AccessControlValue<T, U>;
	delete?: AccessControlValue<T, U>;
	write?: AccessControlValue<T, U>;
	all?: AccessControlValue<T, U>;
}

export type ConsolidatedAccessControlEntry<T, U> = {
	[K in AccessType]?: ConsolidatedAccessControlValue<T, U>;
};

export type AccessControlValue<T, U> = true | QueryFilterFunction<T, U>;
export type ConsolidatedAccessControlValue<T, U> = true | QueryFilterFunction<T, U>[];
export type QueryFilterFunction<T, U> = (
	context?: U
) => GQLEntityFilterInputFieldType<T> | Promise<GQLEntityFilterInputFieldType<T>>;

export interface AuthorizationContextReader<T> {
	getAuthorizationContext(): T;
}
