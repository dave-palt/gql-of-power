export const ClassOperations = {
	_and: ([l]: string[], []: Array<string | number | boolean | bigint>) => `and (${l})`,
	_or: ([l]: string[], []: Array<string | number | boolean | bigint>) => `or (${l})`,
	_not: ([l]: string[], []: Array<string | number | boolean | bigint>) => `not (${l})`,
};
export const FieldOperations = {
	_and: ([l]: string[], [_]: Array<string | number | boolean | bigint>) => `and (${l})`,

	_eq: ([l, r]: string[], [_, rv]: Array<string | number | boolean | bigint>) =>
		`${l} ${rv !== null && rv !== 'null' ? `= ${r}` : 'is null'}`,
	_ne: ([l, r]: string[], [_, rv]: Array<string | number | boolean | bigint>) =>
		`${l} ${rv !== null && rv !== 'null' ? `!= ${r}` : 'is not null'}`,
	_in: ([l, ...r]: string[], []: Array<string | number | boolean | bigint>) =>
		`${l} in (${r.join(', ')})`,
	_nin: ([l, r]: string[], []: Array<string | number | boolean | bigint>) => `${l} nin (${r})`,
	_gt: ([l, r]: string[], []: Array<string | number | boolean | bigint>) => `${l} gt ${r}`,
	_gte: ([l, r]: string[], []: Array<string | number | boolean | bigint>) => `${l} gte ${r}`,
	_lt: ([l, r]: string[], []: Array<string | number | boolean | bigint>) => `${l} lt ${r}`,
	_lte: ([l, r]: string[], []: Array<string | number | boolean | bigint>) => `${l} lte ${r}`,
	_like: ([l, r]: string[], []: Array<string | number | boolean | bigint>) => `${l} like ${r}`,
	_re: ([l, r]: string[], []: Array<string | number | boolean | bigint>) => `${l} re ${r}`,
	_ilike: ([l, r]: string[], []: Array<string | number | boolean | bigint>) => `${l} ilike ${r}`,
	_fulltext: ([l, r]: string[], []: Array<string | number | boolean | bigint>) =>
		`${l} fulltext ${r}`,
	_overlap: ([l, r]: string[], []: Array<string | number | boolean | bigint>) =>
		`${l} overlap ${r}`,
	_contains: ([l, r]: string[], []: Array<string | number | boolean | bigint>) =>
		`${l} contains ${r}`,
	_contained: ([l, r]: string[], []: Array<string | number | boolean | bigint>) =>
		`${l} contained ${r}`,
	_between: ([l, r1, r2]: string[], []: Array<string | number | boolean | bigint>) =>
		`${l} between ${r1} and ${r2}`,
	_exists: ([l]: string[], []: Array<string | number | boolean | bigint>) => `exists ${l}`,
};

export const Operations = { ...ClassOperations, ...FieldOperations };
