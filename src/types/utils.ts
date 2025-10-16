export type DefinedType<T> = Exclude<T, undefined | null | never>;
export type ExtractArrayType<T> = DefinedType<T> extends Array<infer K>
	? ExtractArrayType<DefinedType<K>>
	: DefinedType<T>;

export type OmitArrays<T> = {
	[K in keyof DefinedType<T> as DefinedType<DefinedType<T>[K]> extends Array<infer L>
		? never
		: K]: DefinedType<DefinedType<T>[K]>;
};

export type ConcatConditionalArray<T, K> = Partial<
	DefinedType<
		{
			// build inner objects per TKey then collapse to a single object
			[TKey in Extract<keyof T, string>]: {
				[KKey in Extract<keyof K, string> as `${TKey & string}${KKey}`]?: K[KKey] extends Array<any>
					? Array<ExtractArrayType<T[TKey]>> | null
					: ExtractArrayType<T[TKey]> | null;
			};
		}[Extract<keyof T, string>]
	>
>;

export type Primitives = string | number | boolean | null | undefined | Date | BigInt;

export type PrimitivesOnly<T> = DefinedType<T> extends Primitives ? DefinedType<T> : never;
