export const keys = <T extends object>(obj: T): (string & keyof T)[] =>
	Object.keys(obj) as (string & keyof T)[];
