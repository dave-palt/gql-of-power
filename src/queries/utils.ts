import { GQLEntityOrderByInputType, MappingsType } from '../types';

export class QueriesUtils {
	public static newMappings = (): MappingsType => ({
		select: new Set<string>(),
		rawSelect: new Set<string>(),
		json: [] as string[],
		innerJoin: [] as string[],
		outerJoin: [] as string[],
		where: [] as string[],
		values: {} as Record<string, any>,
		orderBy: [] as GQLEntityOrderByInputType<any>[],
		_or: [] as MappingsType[],
		_and: [] as MappingsType[],
		_not: [] as MappingsType[],
	});

	public static getMapping = (
		mappings: Map<string, MappingsType>,
		fieldNameKey: string
	): MappingsType => {
		const found = mappings.get(fieldNameKey);
		if (found) {
			return found;
		}

		const mapping = QueriesUtils.newMappings();
		mappings.set(fieldNameKey, mapping);
		return mapping;
	};

	public static mappingsReducer = (
		m: Map<string, MappingsType>,
		startMapping = QueriesUtils.newMappings()
	) =>
		Array.from(m.values()).reduce(
			(
				{
					select,
					rawSelect,
					innerJoin,
					json,
					outerJoin,
					where,
					values,
					limit,
					offset,
					orderBy,
					_or,
					_and,
					_not,
				},
				mapping
			) => {
				mapping.select.forEach((s) => select.add(s));
				mapping.rawSelect.forEach((s) => rawSelect.add(s));
				json.push(...mapping.json);
				innerJoin.push(...mapping.innerJoin);
				outerJoin.push(...mapping.outerJoin);
				where.push(...mapping.where);
				orderBy.push(...mapping.orderBy);
				_or.push(...mapping._or);
				_and.push(...mapping._and);
				_not.push(...mapping._not);
				values = { ...values, ...mapping.values };

				return {
					select,
					rawSelect,
					json,
					innerJoin,
					outerJoin,
					where,
					values,
					limit: mapping.limit ?? limit,
					offset: mapping.offset ?? offset,
					orderBy,
					_or,
					_and,
					_not,
				};
			},
			startMapping
		);
}

export const isPrimitive = (
	filterValue: any
): filterValue is string | number | boolean | bigint | null =>
	typeof filterValue === 'bigint' ||
	typeof filterValue === 'boolean' ||
	typeof filterValue === 'number' ||
	typeof filterValue === 'string' ||
	typeof filterValue === 'symbol' ||
	filterValue === null;
