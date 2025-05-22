export enum AliasType {
	entity = 'entity',
	field = 'field',
	value = 'value',
}
export class Alias {
	constructor(private type: AliasType, private index: number, private prefix: string) {}

	public toString() {
		return `${this.type[0]}_${this.prefix}${this.index}`;
	}
	public toColumnName(value: string) {
		return `${this.type[0]}_${this.prefix}${this.index}.${value}`;
	}

	public toParamName(childAlias: string | number) {
		return `${this.type[0]}_${this.prefix}${this.index}_${childAlias}`;
	}

	public concat(...text: string[]) {
		return `${text.join('')} - ${this.type[0]}_${this.prefix}${this.index}`;
	}

	public get pref() {
		return this.prefix;
	}
}

export class AliasManager {
	private ALIAS_INDEX_MAP = new Map<AliasType, Map<string, number>>();

	private checkMap(type: AliasType, prefix: string) {
		if (!this.ALIAS_INDEX_MAP.has(type)) {
			this.ALIAS_INDEX_MAP.set(type, new Map<string, number>());
		}
		if (!this.ALIAS_INDEX_MAP.get(type)?.has(prefix)) {
			this.ALIAS_INDEX_MAP.get(type)?.set(prefix, 0);
		}
	}
	public resetAll() {
		this.ALIAS_INDEX_MAP.clear();
	}
	public reset(type: AliasType, prefix: string) {
		return this.restartFrom(type, prefix, 1);
	}
	public restartFrom(type: AliasType, prefix: string, index: number) {
		this.checkMap(type, prefix);
		this.ALIAS_INDEX_MAP.get(type)?.set(prefix, index);
		return new Alias(type, index, prefix);
	}

	public start(prefix: string) {
		return this.next(AliasType.entity, prefix);
	}

	public next(type: AliasType, prefix: string) {
		this.checkMap(type, prefix);
		const existingIndex = this.ALIAS_INDEX_MAP.get(type)?.get(prefix) ?? 0;
		console.log('AliasManager.next', type, prefix, existingIndex);
		const index = existingIndex + 1;
		this.ALIAS_INDEX_MAP.get(type)?.set(prefix, index);

		// this will automatically pick the last index
		return new Alias(type, index, prefix);
	}
}
