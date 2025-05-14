import { Operations } from '../operations';

export const parseFilter = (
	operation: keyof typeof Operations,
	filterValue: any,
	f: string,
	alias: string,
	valueAlias: string
) => {
	if (filterValue !== undefined) {
		const filterFieldWithAlias = `${alias}.${f}`;
		const filterParameterName = `${valueAlias}_${f}`;
		return {
			fieldName: filterFieldWithAlias,
			eqFilter: Operations[operation](
				[filterFieldWithAlias, ':' + filterParameterName],
				[, filterValue]
			),
			eqValue: { [filterParameterName]: filterValue },
		};
	}
	return;
};
