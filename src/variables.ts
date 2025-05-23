const LOG_TYPES = (process.env.D3GOP_LOG_TYPE || 'all').split(',');

console.log('LOG_TYPES', LOG_TYPES);

const shouldLog = (first: any) =>
	LOG_TYPES.length === 0 ||
	LOG_TYPES.indexOf('all') >= 0 ||
	LOG_TYPES.some((lt) => first.startsWith(lt));
export const logger = {
	time: (name: string) => {
		console.time(name);
	},
	timeLog: (name: string, ...args: any[]) => {
		console.timeLog(name, ...args);
	},
	timeEnd: (name: string) => {
		console.timeEnd(name);
	},
	log: (...args: any[]) => {
		if (shouldLog(args[0])) {
			console.log(...args);
		}
	},
	error: (...args: any[]) => {
		console.error(...args);
	},
	warn: (...args: any[]) => {
		console.warn(...args);
	},
	info: (...args: any[]) => {
		if (shouldLog(args[0])) {
			console.info(...args);
		}
	},
	debug: (...args: any[]) => {
		console.debug(...args);
	},
	group: (name: string) => {
		console.group(name);
	},
	groupEnd: () => {
		console.groupEnd();
	},
	assert: (condition: boolean, ...args: any[]) => {
		if (!condition) {
			console.assert(condition, ...args);
		}
	},
	table: (data: any) => {
		console.table(data);
	},
	clear: () => {
		console.clear();
	},
	trace: (...args: any[]) => {
		console.trace(...args);
	},
	timeStamp: (name: string) => {
		console.timeStamp(name);
	},
	count: (label: string) => {
		console.count(label);
	},
	countReset: (label: string) => {
		console.countReset(label);
	},
	profile: (label: string) => {
		console.profile(label);
	},
	profileEnd: (label: string) => {
		console.profileEnd(label);
	},
	dir: (obj: any, options?: any) => {
		console.dir(obj, options);
	},
	dirxml: (obj: any) => {
		console.dirxml(obj);
	},
	groupCollapsed: (name: string) => {
		console.groupCollapsed(name);
	},
} as Console;
