export const ClassOperations = {
	_and: ([l]: string[], [v]: string[]) => `and (${l})`,
	_or: ([l]: string[], [v]: string[]) => `or (${l})`,
	_not: ([l]: string[], [v]: string[]) => `not (${l})`,
};
export const FieldOperations = {
	_and: ([l]: string[], [_]: string[]) => `and (${l})`,

	_eq: ([l, r]: string[], [_, rv]: string[]) =>
		`${l} ${rv !== null && rv !== 'null' ? `= ${r}` : 'is null'}`,
	_ne: ([l, r]: string[], [_, rv]: string[]) =>
		`${l} ${rv !== null && rv !== 'null' ? `!= ${r}` : 'is not null'}`,
	_in: ([l, r]: string[], []: string[]) => `${l} in (${r})`,
	_nin: ([l, r]: string[], []: string[]) => `${l} nin (${r})`,
	_gt: ([l, r]: string[], []: string[]) => `${l} gt ${r}`,
	_gte: ([l, r]: string[], []: string[]) => `${l} gte ${r}`,
	_lt: ([l, r]: string[], []: string[]) => `${l} lt ${r}`,
	_lte: ([l, r]: string[], []: string[]) => `${l} lte ${r}`,
	_like: ([l, r]: string[], []: string[]) => `${l} like ${r}`,
	_re: ([l, r]: string[], []: string[]) => `${l} re ${r}`,
	_ilike: ([l, r]: string[], []: string[]) => `${l} ilike ${r}`,
	_fulltext: ([l, r]: string[], []: string[]) => `${l} fulltext ${r}`,
	_overlap: ([l, r]: string[], []: string[]) => `${l} overlap ${r}`,
	_contains: ([l, r]: string[], []: string[]) => `${l} contains ${r}`,
	_contained: ([l, r]: string[], []: string[]) => `${l} contained ${r}`,
	_between: ([l, r1, r2]: string[], []: string[]) => `${l} between ${r1} and ${r2}`,
	_exists: ([l]: string[], []: string[]) => `exists ${l}`,
};

export const Operations = { ...ClassOperations, ...FieldOperations };
