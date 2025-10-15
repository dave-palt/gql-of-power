const LOG_TYPES = (process.env.D3GOP_LOG_TYPE || 'all').split(',');

console.log('LOG_TYPES', LOG_TYPES);

export const shouldLog = (first: any) =>
	LOG_TYPES.length === 0 ||
	LOG_TYPES.indexOf('all') >= 0 ||
	LOG_TYPES.some((lt) => first.startsWith(lt));

export const logger = {
	time: (...args: Parameters<typeof console.time>) => {
		console.time(...args);
	},
	timeLog: (...args: Parameters<typeof console.timeLog>) => {
		console.timeLog(...args, ...args);
	},
	timeEnd: (...args: Parameters<typeof console.timeEnd>) => {
		console.timeEnd(...args);
	},
	log: (...args: Parameters<typeof console.log>) => {
		if (shouldLog(args[0])) {
			console.log(...args);
		}
	},
	error: (...args: Parameters<typeof console.error>) => {
		console.error(...args);
	},
	warn: (...args: Parameters<typeof console.warn>) => {
		console.warn(...args);
	},
	info: (...args: Parameters<typeof console.info>) => {
		if (shouldLog(args[0])) {
			console.info(...args);
		}
	},
	debug: (...args: Parameters<typeof console.debug>) => {
		console.debug(...args);
	},
	group: (...args: Parameters<typeof console.group>) => {
		console.group(...args);
	},
	groupEnd: () => {
		console.groupEnd();
	},
	assert: (...args: Parameters<typeof console.assert>) => {
		console.assert(...args);
	},
	table: (...args: Parameters<typeof console.table>) => {
		console.table(...args);
	},
	clear: () => {
		console.clear();
	},
	trace: (...args: Parameters<typeof console.trace>) => {
		console.trace(...args);
	},
	timeStamp: (...args: Parameters<typeof console.timeStamp>) => {
		console.timeStamp(...args);
	},
	count: (...args: Parameters<typeof console.count>) => {
		console.count(...args);
	},
	countReset: (...args: Parameters<typeof console.countReset>) => {
		console.countReset(...args);
	},
	profile: (...args: Parameters<typeof console.profile>) => {
		console.profile(...args);
	},
	profileEnd: (...args: Parameters<typeof console.profileEnd>) => {
		console.profileEnd(...args);
	},
	dir: (...args: Parameters<typeof console.dir>) => {
		console.dir(...args);
	},
	dirxml: (...args: Parameters<typeof console.dirxml>) => {
		console.dirxml(...args);
	},
	groupCollapsed: (...args: Parameters<typeof console.groupCollapsed>) => {
		console.groupCollapsed(...args);
	},
} as Console;
