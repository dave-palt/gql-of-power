export const parseEqFilter = (filterValue: any, f: string, alias: string, valueAlias: string) => {
	if (filterValue !== undefined) {
		const filterFieldWithAlias = `${alias}.${f}`;
		const filterParameterName = `${valueAlias}_${f}`;
		return {
			fieldName: filterFieldWithAlias,
			eqFilter: `${filterFieldWithAlias} = :${filterParameterName}`,
			eqValue: { [filterParameterName]: filterValue },
		};
	}
	return;
};
