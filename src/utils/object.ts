export const keys = <T extends object>(obj?: T): (string & keyof T)[] =>
	obj ? (Object.keys(obj) as (string & keyof T)[]) : [];
