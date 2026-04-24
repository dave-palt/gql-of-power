import { beforeEach, describe, expect, it } from 'bun:test';
import { FieldSelection } from '../../src';
import {
	clearMapEnumFields,
	defineFields,
	getMapEnumFieldsFor,
	GQLEntityBase,
	GQLEntityClass,
	setGlobalConfig,
} from '../../src/entities/gql-entity';
import { GQLQueryManager } from '../../src/query-manager';
import { EntityMetadata, EntityProperty, ReferenceType } from '../../src/types';
import '../setup';

enum RingBearerStatus {
	Worthy = 100,
	Corrupted = 200,
	Undefined = 300,
}

enum QuestState {
	NotStarted = 0,
	InProgress = 1,
	Completed = 2,
	Failed = 3,
}

enum Allegiance {
	Good = 'GOOD',
	Evil = 'EVIL',
	Neutral = 'NEUTRAL',
}

enum QuestFrequency {
	Weekly = '1',
	Fortnightly = '2',
	Every3Weeks = '3',
	Every4Weeks = '4',
	Every6Weeks = '11',
	MonthlyFirstWeek = '5',
	OnCall = '6',
	Other = '7',
}

enum RuneInscription {
	Alpha = 'ABC123',
	Beta = 'XYZ789',
	Gamma = '1A2B3C',
}

class TestBearer {
	id!: number;
	name!: string;
	status!: number;
	questState!: number;
	allegiance!: string;
}

class TestBearerWithAlias {
	id!: number;
	name!: string;
	holderStatus!: number;
}

class TestQuest {
	id!: number;
	name!: string;
	frequency!: string;
}

class TestRune {
	id!: number;
	name!: string;
	inscription!: string;
}

const createProperty = (
	type: string,
	name: string,
	fieldNames: string[],
	reference?: {
		referenceType: ReferenceType;
		mappedBy?: string;
	}
): EntityProperty => ({
	type,
	name,
	fieldNames,
	mappedBy: reference?.mappedBy || '',
	joinColumns: [],
	referencedColumnNames: [],
	inverseJoinColumns: [],
	pivotTable: '',
	reference: reference?.referenceType,
});

const TestBearerMetadata: EntityMetadata<TestBearer> = {
	name: 'TestBearer',
	tableName: 'test_bearers',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['bearer_name']),
		status: createProperty('number', 'status', ['status']),
		questState: createProperty('number', 'questState', ['quest_state']),
		allegiance: createProperty('string', 'allegiance', ['allegiance']),
	},
};

const TestBearerWithAliasMetadata: EntityMetadata<TestBearerWithAlias> = {
	name: 'TestBearerWithAlias',
	tableName: 'test_bearers_alias',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['bearer_name']),
		holderStatus: createProperty('number', 'holderStatus', ['holder_status']),
	},
};

const TestQuestMetadata: EntityMetadata<TestQuest> = {
	name: 'TestQuest',
	tableName: 'test_quests',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['quest_name']),
		frequency: createProperty('string', 'frequency', ['frequency']),
	},
};

const TestRuneMetadata: EntityMetadata<TestRune> = {
	name: 'TestRune',
	tableName: 'test_runes',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		name: createProperty('string', 'name', ['rune_name']),
		inscription: createProperty('string', 'inscription', ['inscription']),
	},
};

setGlobalConfig({ gqlTypesSuffix: '' });

function createMockProvider() {
	return {
		client: 'pg',
		exists: (name: string) => name === 'TestBearer' || name === 'TestBearerWithAlias',
		getMetadata: <T, K>(entityName: string): K => {
			if (entityName === 'TestBearer') return TestBearerMetadata as K;
			if (entityName === 'TestBearerWithAlias') return TestBearerWithAliasMetadata as K;
			throw new Error(`Unknown entity: ${entityName}`);
		},
		rawQuery: (sql: string, bindings?: any) => sql,
		executeQuery: async (sql: string) => {
			if (sql.includes('test_bearers_alias')) {
				return [
					{ id: 1, name: 'Frodo', status: 100 },
					{ id: 2, name: 'Gollum', status: 200 },
				];
			}
			return [
				{ id: 1, name: 'Frodo', status: 100, questState: 1, allegiance: 'GOOD' },
				{ id: 2, name: 'Gollum', status: 200, questState: 3, allegiance: 'EVIL' },
				{ id: 3, name: 'Sam', status: 300, questState: 2, allegiance: 'GOOD' },
			];
		},
	};
}

describe('mapNumericEnum field registration', () => {
	beforeEach(() => {
		clearMapEnumFields();
	});

	it('should register only fields with mapNumericEnum: true', () => {
		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
			questState: { type: () => QuestState, generateFilter: true, mapNumericEnum: true },
			allegiance: { type: () => Allegiance, generateFilter: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerGQL extends GQLEntityBase {}

		const enumFields = getMapEnumFieldsFor('TestBearer');

		expect('status' in enumFields).toBe(true);
		expect('questState' in enumFields).toBe(true);
		expect('allegiance' in enumFields).toBe(false);
		expect(enumFields['status']).toBe(RingBearerStatus);
		expect(enumFields['questState']).toBe(QuestState);
	});

	it('should register enum fields with alias', () => {
		const fields = defineFields(TestBearerWithAlias, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			holderStatus: {
				type: () => RingBearerStatus,
				generateFilter: true,
				mapNumericEnum: true,
				alias: 'status',
			},
		});

		@GQLEntityClass(TestBearerWithAlias, fields)
		class TestBearerAliasGQL extends GQLEntityBase {}

		const enumFields = getMapEnumFieldsFor('TestBearerWithAlias');

		expect('status' in enumFields).toBe(true);
		expect('holderStatus' in enumFields).toBe(false);
	});

	it('should not register any fields when mapNumericEnum is absent', () => {
		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			allegiance: { type: () => String, generateFilter: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerNoEnumGQL extends GQLEntityBase {}

		const enumFields = getMapEnumFieldsFor('TestBearer');
		expect(Object.keys(enumFields).length).toBe(0);
	});
});

describe('mapNumericEnum FieldResolver', () => {
	beforeEach(() => {
		clearMapEnumFields();
	});

	it('should convert numeric DB values to enum string keys', () => {
		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
			questState: { type: () => QuestState, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerGQL extends GQLEntityBase {}

		const resolver = new TestBearerGQL.FieldsResolver();

		expect((resolver as any).status({ status: 100 })).toBe('Worthy');
		expect((resolver as any).status({ status: 200 })).toBe('Corrupted');
		expect((resolver as any).status({ status: 300 })).toBe('Undefined');
		expect((resolver as any).questState({ questState: 0 })).toBe('NotStarted');
		expect((resolver as any).questState({ questState: 1 })).toBe('InProgress');
		expect((resolver as any).questState({ questState: 2 })).toBe('Completed');
		expect((resolver as any).questState({ questState: 3 })).toBe('Failed');
	});

	it('should handle aliased fields', () => {
		const fields = defineFields(TestBearerWithAlias, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			holderStatus: {
				type: () => RingBearerStatus,
				generateFilter: true,
				mapNumericEnum: true,
				alias: 'status',
			},
		});

		@GQLEntityClass(TestBearerWithAlias, fields)
		class TestBearerAliasGQL extends GQLEntityBase {}

		const resolver = new TestBearerAliasGQL.FieldsResolver();

		expect((resolver as any).status({ status: 100 })).toBe('Worthy');
		expect((resolver as any).status({ status: 200 })).toBe('Corrupted');
	});

	it('should return null/undefined unchanged', () => {
		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerGQL extends GQLEntityBase {}

		const resolver = new TestBearerGQL.FieldsResolver();

		expect((resolver as any).status({ status: null })).toBeNull();
		expect((resolver as any).status({})).toBeNull();
	});

	it('should return raw value for unknown numeric values', () => {
		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerGQL extends GQLEntityBase {}

		const resolver = new TestBearerGQL.FieldsResolver();

		expect((resolver as any).status({ status: 99999 })).toBe(99999);
	});
});

describe('mapNumericEnum filter conversion', () => {
	let queryManager: GQLQueryManager;

	beforeEach(() => {
		clearMapEnumFields();
		queryManager = new GQLQueryManager();
	});

	it('should convert enum key filter values to numeric DB values', async () => {
		const provider = {
			...createMockProvider(),
			executeQuery: async () => [],
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerFilterGQL extends GQLEntityBase {}

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {}, status: {} } as FieldSelection<TestBearer>;

		const filter = { status_eq: 'Corrupted' };

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
	});

	it('should convert nested object filter values', async () => {
		const provider = {
			...createMockProvider(),
			executeQuery: async () => [],
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerNestedGQL extends GQLEntityBase {}

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {}, status: {} } as FieldSelection<TestBearer>;

		const filter = { Status: { _eq: 'Worthy' } };

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
	});

	it('should convert _in filter arrays', async () => {
		const provider = {
			...createMockProvider(),
			executeQuery: async () => [],
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			questState: { type: () => QuestState, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerInGQL extends GQLEntityBase {}

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {}, questState: {} } as FieldSelection<TestBearer>;

		const filter = { questState_in: ['InProgress', 'Completed'] };

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
	});

	it('should handle _and/_or with enum filters', async () => {
		const provider = {
			...createMockProvider(),
			executeQuery: async () => [],
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			status: { type: () => RingBearerStatus, generateFilter: true, mapNumericEnum: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerOrGQL extends GQLEntityBase {}

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {}, status: {} } as FieldSelection<TestBearer>;

		const filter = {
			_or: [{ status: 'Worthy' }, { status: 'Corrupted' }],
		};

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
	});

	it('should not convert filters for non-mapNumericEnum fields', async () => {
		const provider = {
			...createMockProvider(),
			executeQuery: async () => [],
		};

		const fields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			allegiance: { type: () => Allegiance, generateFilter: true },
		});

		@GQLEntityClass(TestBearer, fields)
		class TestBearerNoMapGQL extends GQLEntityBase {}

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {}, allegiance: {} } as FieldSelection<TestBearer>;

		const filter = { allegiance_eq: 'GOOD' };

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
	});
});

describe('mapNumericEnum FieldResolver with string-valued enums', () => {
	beforeEach(() => {
		clearMapEnumFields();
	});

	it('should convert string DB values to enum keys for string-valued enums', () => {
		const fields = defineFields(TestQuest, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			frequency: {
				type: () => QuestFrequency,
				generateFilter: true,
				mapNumericEnum: true,
			},
		});

		@GQLEntityClass(TestQuest, fields)
		class TestQuestGQL extends GQLEntityBase {}

		const resolver = new TestQuestGQL.FieldsResolver();

		expect((resolver as any).frequency({ frequency: '1' })).toBe('Weekly');
		expect((resolver as any).frequency({ frequency: '2' })).toBe('Fortnightly');
		expect((resolver as any).frequency({ frequency: '3' })).toBe('Every3Weeks');
		expect((resolver as any).frequency({ frequency: '4' })).toBe('Every4Weeks');
		expect((resolver as any).frequency({ frequency: '5' })).toBe('MonthlyFirstWeek');
		expect((resolver as any).frequency({ frequency: '6' })).toBe('OnCall');
		expect((resolver as any).frequency({ frequency: '7' })).toBe('Other');
		expect((resolver as any).frequency({ frequency: '11' })).toBe('Every6Weeks');
	});

	it('should convert alphanumeric string DB values to enum keys', () => {
		const fields = defineFields(TestRune, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			inscription: {
				type: () => RuneInscription,
				generateFilter: true,
				mapNumericEnum: true,
			},
		});

		@GQLEntityClass(TestRune, fields)
		class TestRuneGQL extends GQLEntityBase {}

		const resolver = new TestRuneGQL.FieldsResolver();

		expect((resolver as any).inscription({ inscription: 'ABC123' })).toBe('Alpha');
		expect((resolver as any).inscription({ inscription: 'XYZ789' })).toBe('Beta');
		expect((resolver as any).inscription({ inscription: '1A2B3C' })).toBe('Gamma');
	});

	it('should return raw value for unmapped string values', () => {
		const fields = defineFields(TestQuest, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			frequency: {
				type: () => QuestFrequency,
				generateFilter: true,
				mapNumericEnum: true,
			},
		});

		@GQLEntityClass(TestQuest, fields)
		class TestQuestUnknownGQL extends GQLEntityBase {}

		const resolver = new TestQuestUnknownGQL.FieldsResolver();

		expect((resolver as any).frequency({ frequency: '99' })).toBe('99');
		expect((resolver as any).frequency({ frequency: 'UNKNOWN' })).toBe('UNKNOWN');
	});

	it('should return null/undefined unchanged for string-valued enums', () => {
		const fields = defineFields(TestQuest, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			frequency: {
				type: () => QuestFrequency,
				generateFilter: true,
				mapNumericEnum: true,
			},
		});

		@GQLEntityClass(TestQuest, fields)
		class TestQuestNullGQL extends GQLEntityBase {}

		const resolver = new TestQuestNullGQL.FieldsResolver();

		expect((resolver as any).frequency({ frequency: null })).toBeNull();
		expect((resolver as any).frequency({})).toBeNull();
	});

	it('should register string-valued enum fields in MapEnumFieldsMap', () => {
		const fields = defineFields(TestQuest, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
			frequency: {
				type: () => QuestFrequency,
				generateFilter: true,
				mapNumericEnum: true,
			},
		});

		@GQLEntityClass(TestQuest, fields)
		class TestQuestRegGQL extends GQLEntityBase {}

		const enumFields = getMapEnumFieldsFor('TestQuest');

		expect('frequency' in enumFields).toBe(true);
		expect(enumFields['frequency']).toBe(QuestFrequency);
	});
});
