export const parseEqFilter = (
  filterValue: any,
  f: string,
  alias: string,
  prefix: string | undefined
) => {
  if (filterValue !== undefined) {
    const filterFieldWithAlias = `${alias}.${f}`;
    const filterParameterName = `${prefix ?? ""}_${alias}_${f}`;
    return {
      fieldName: filterFieldWithAlias,
      eqFilter: `${filterFieldWithAlias} = :${filterParameterName}`,
      eqValue: { [filterParameterName]: filterValue },
    };
  }
  return;
};
