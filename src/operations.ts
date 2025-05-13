export const ClassOperations = {
	_and: ([l, ..._]: string[]) => `and (${l})`,
	_or: ([l, ..._]: string[]) => `or (${l})`,
	_not: ([l, ..._]: string[]) => `not (${l})`,
};
export const FieldOperations = {
	_and: ([l, ..._]: string[]) => `and (${l})`,

	_eq: ([l, r, ..._]: string[]) => `${l} = ${r}`,
	_ne: ([l, r, ..._]: string[]) => `${l} ${r !== null && r !== 'null' ? '!=' : 'is not'} ${r}`,
	_in: ([l, r, ..._]: string[]) => `${l} in (${r})`,
	_nin: ([l, r, ..._]: string[]) => `${l} nin (${r})`,
	_gt: ([l, r, ..._]: string[]) => `${l} gt ${r}`,
	_gte: ([l, r, ..._]: string[]) => `${l} gte ${r}`,
	_lt: ([l, r, ..._]: string[]) => `${l} lt ${r}`,
	_lte: ([l, r, ..._]: string[]) => `${l} lte ${r}`,
	_like: ([l, r, ..._]: string[]) => `${l} like ${r}`,
	_re: ([l, r, ..._]: string[]) => `${l} re ${r}`,
	_ilike: ([l, r, ..._]: string[]) => `${l} ilike ${r}`,
	_fulltext: ([l, r, ..._]: string[]) => `${l} fulltext ${r}`,
	_overlap: ([l, r, ..._]: string[]) => `${l} overlap ${r}`,
	_contains: ([l, r, ..._]: string[]) => `${l} contains ${r}`,
	_contained: ([l, r, ..._]: string[]) => `${l} contained ${r}`,
	_between: ([l, r1, r2, ..._]: string[]) => `${l} between ${r1} and ${r2}`,
	_exists: ([l, ..._]: string[]) => `exists ${l}`,
};

export const Operations = { ...ClassOperations, ...FieldOperations };
