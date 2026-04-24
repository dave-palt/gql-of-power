import { beforeEach, describe, expect, it } from 'bun:test';
import {
	clearMapEnumFields,
	defineFields,
	GQLEntityBase,
	GQLEntityClass,
	setGlobalConfig,
} from '../../src/entities/gql-entity';
import { GQLQueryManager } from '../../src/query-manager';
import { EntityMetadata, EntityProperty, FieldSelection, ReferenceType } from '../../src/types';
import '../setup';

enum WeaponStatus {
	Worthy = 913710000,
	Corrupted = 913710001,
	Shattered = 913710002,
}

class TestBearer {
	id!: number;
	name!: string;
	weaponId!: number;
	realmId!: number;
}

class TestWeapon {
	id!: number;
	weaponName!: string;
	power!: number;
	status!: number;
}

class TestRealm {
	id!: number;
	realmName!: string;
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
		weaponId: createProperty('number', 'weaponId', ['weapon_id']),
		realmId: createProperty('number', 'realmId', ['realm_id']),
	},
};

const TestWeaponMetadata: EntityMetadata<TestWeapon> = {
	name: 'TestWeapon',
	tableName: 'test_weapons',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		weaponName: createProperty('string', 'weaponName', ['weapon_name']),
		power: createProperty('number', 'power', ['power_level']),
		status: createProperty('number', 'status', ['status']),
	},
};

const TestRealmMetadata: EntityMetadata<TestRealm> = {
	name: 'TestRealm',
	tableName: 'test_realms',
	primaryKeys: ['id'],
	properties: {
		id: createProperty('number', 'id', ['id']),
		realmName: createProperty('string', 'realmName', ['realm_name']),
	},
};

setGlobalConfig({ gqlTypesSuffix: '' });

function createMockProvider() {
	return {
		client: 'pg',
		exists: (name: string) =>
			name === 'TestBearer' || name === 'TestWeapon' || name === 'TestRealm',
		getMetadata: <T, K>(entityName: string): K => {
			if (entityName === 'TestBearer') return TestBearerMetadata as K;
			if (entityName === 'TestWeapon') return TestWeaponMetadata as K;
			if (entityName === 'TestRealm') return TestRealmMetadata as K;
			throw new Error(`Unknown entity: ${entityName}`);
		},
		rawQuery: (sql: string, bindings?: any) => sql,
		executeQuery: async () => [],
	};
}

function setupEntities(weaponExtra: Record<string, any> = {}) {
	const weaponFields = defineFields(TestWeapon, {
		id: { type: () => String, generateFilter: true },
		weaponName: { type: () => String, generateFilter: true },
		power: { type: () => String, generateFilter: true },
		...weaponExtra,
	});

	@GQLEntityClass(TestWeapon, weaponFields)
	class TestWeaponGQL extends GQLEntityBase {}

	const realmFields = defineFields(TestRealm, {
		id: { type: () => String, generateFilter: true },
		realmName: { type: () => String, generateFilter: true },
	});

	@GQLEntityClass(TestRealm, realmFields)
	class TestRealmGQL extends GQLEntityBase {}

	const bearerFields = defineFields(TestBearer, {
		id: { type: () => String, generateFilter: true },
		name: { type: () => String, generateFilter: true },
	});

	@GQLEntityClass(TestBearer, bearerFields, {
		customFields: {
			weapon: {
				type: () => TestWeaponGQL,
				options: { nullable: true },
				generateFilter: true,
				mapping: {
					refEntity: TestWeapon,
					refFields: 'id',
					fields: 'weaponId',
				},
			},
			realm: {
				type: () => TestRealmGQL,
				options: { nullable: true },
				generateFilter: true,
				mapping: {
					refEntity: TestRealm,
					refFields: 'id',
					fields: 'realmId',
				},
			},
		},
	})
	class TestBearerGQL extends GQLEntityBase {}

	return { TestBearerGQL };
}

describe('mapped custom field filter — basic', () => {
	let queryManager: GQLQueryManager;
	let capturedSQL: string;

	beforeEach(() => {
		clearMapEnumFields();
		queryManager = new GQLQueryManager();
		capturedSQL = '';
	});

	it('should generate EXISTS subquery for mapped custom field filter', async () => {
		setupEntities();

		const provider = {
			...createMockProvider(),
			executeQuery: async (sql: string) => {
				capturedSQL = sql;
				return [];
			},
		};

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {} } as FieldSelection<TestBearer>;
		const filter = { Weapon: { weaponName_eq: 'Glamdring' } };

		await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(capturedSQL).toContain('exists');
		expect(capturedSQL).toContain('test_weapons');
		expect(capturedSQL).toContain('weapon_id');
	});

	it('should not generate filter when generateFilter is absent', async () => {
		const weaponFields = defineFields(TestWeapon, {
			id: { type: () => String, generateFilter: true },
			weaponName: { type: () => String, generateFilter: true },
		});

		@GQLEntityClass(TestWeapon, weaponFields)
		class TestWeaponNoFilterGQL extends GQLEntityBase {}

		const bearerFields = defineFields(TestBearer, {
			id: { type: () => String, generateFilter: true },
			name: { type: () => String, generateFilter: true },
		});

		@GQLEntityClass(TestBearer, bearerFields, {
			customFields: {
				weapon: {
					type: () => TestWeaponNoFilterGQL,
					options: { nullable: true },
					mapping: {
						refEntity: TestWeapon,
						refFields: 'id',
						fields: 'weaponId',
					},
				},
			},
		})
		class TestBearerNoFilterGQL extends GQLEntityBase {}

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {} } as FieldSelection<TestBearer>;
		const filter = { name_eq: 'Frodo' };

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			createMockProvider(),
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
	});
});

describe('mapped custom field filter — _or combos', () => {
	let queryManager: GQLQueryManager;
	let capturedSQL: string;

	beforeEach(() => {
		clearMapEnumFields();
		queryManager = new GQLQueryManager();
		capturedSQL = '';
	});

	it('should handle _or with two mapped custom field filters', async () => {
		setupEntities();

		const provider = {
			...createMockProvider(),
			executeQuery: async (sql: string) => {
				capturedSQL = sql;
				return [];
			},
		};

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {} } as FieldSelection<TestBearer>;
		const filter = {
			_or: [{ Weapon: { weaponName_eq: 'Glamdring' } }, { Weapon: { weaponName_eq: 'Sting' } }],
		};

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
		expect(capturedSQL).toContain('exists');
		expect(capturedSQL).toContain('union all');
	});

	it('should handle _or mixing mapped custom field + regular field', async () => {
		setupEntities();

		const provider = {
			...createMockProvider(),
			executeQuery: async (sql: string) => {
				capturedSQL = sql;
				return [];
			},
		};

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {} } as FieldSelection<TestBearer>;
		const filter = {
			_or: [{ name_eq: 'Frodo' }, { Weapon: { weaponName_eq: 'Glamdring' } }],
		};

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
		expect(capturedSQL).toContain('exists');
		expect(capturedSQL).toContain('bearer_name');
	});

	it('should handle _or with two different mapped custom fields', async () => {
		setupEntities();

		const provider = {
			...createMockProvider(),
			executeQuery: async (sql: string) => {
				capturedSQL = sql;
				return [];
			},
		};

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {} } as FieldSelection<TestBearer>;
		const filter = {
			_or: [{ Weapon: { weaponName_eq: 'Glamdring' } }, { Realm: { realmName_eq: 'Gondor' } }],
		};

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
		expect(capturedSQL).toContain('exists');
		expect(capturedSQL).toContain('test_weapons');
		expect(capturedSQL).toContain('test_realms');
	});
});

describe('mapped custom field filter — _and combos', () => {
	let queryManager: GQLQueryManager;
	let capturedSQL: string;

	beforeEach(() => {
		clearMapEnumFields();
		queryManager = new GQLQueryManager();
		capturedSQL = '';
	});

	it('should handle _and with mapped custom field + regular field', async () => {
		setupEntities();

		const provider = {
			...createMockProvider(),
			executeQuery: async (sql: string) => {
				capturedSQL = sql;
				return [];
			},
		};

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {} } as FieldSelection<TestBearer>;
		const filter = {
			_and: [{ name_eq: 'Frodo' }, { Weapon: { weaponName_eq: 'Sting' } }],
		};

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
		expect(capturedSQL).toContain('exists');
		expect(capturedSQL).toContain('bearer_name');
	});

	it('should handle _and with two different mapped custom fields', async () => {
		setupEntities();

		const provider = {
			...createMockProvider(),
			executeQuery: async (sql: string) => {
				capturedSQL = sql;
				return [];
			},
		};

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {} } as FieldSelection<TestBearer>;
		const filter = {
			_and: [{ Weapon: { weaponName_eq: 'Glamdring' } }, { Realm: { realmName_eq: 'Gondor' } }],
		};

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
		expect(capturedSQL).toContain('test_weapons');
		expect(capturedSQL).toContain('test_realms');
	});
});

describe('mapped custom field filter — nested _or inside _and', () => {
	let queryManager: GQLQueryManager;
	let capturedSQL: string;

	beforeEach(() => {
		clearMapEnumFields();
		queryManager = new GQLQueryManager();
		capturedSQL = '';
	});

	it('should handle _and containing _or with mapped custom fields', async () => {
		setupEntities();

		const provider = {
			...createMockProvider(),
			executeQuery: async (sql: string) => {
				capturedSQL = sql;
				return [];
			},
		};

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {} } as FieldSelection<TestBearer>;
		const filter = {
			_and: [
				{ name_eq: 'Frodo' },
				{
					_or: [{ Weapon: { weaponName_eq: 'Glamdring' } }, { Weapon: { weaponName_eq: 'Sting' } }],
				},
			],
		};

		const result = await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		expect(Array.isArray(result)).toBe(true);
		expect(capturedSQL).toContain('exists');
	});
});

describe('mapped custom field filter — enum conversion in nested contexts', () => {
	let queryManager: GQLQueryManager;

	beforeEach(() => {
		clearMapEnumFields();
		queryManager = new GQLQueryManager();
	});

	it('should convert enum in direct mapped field filter', async () => {
		setupEntities({
			status: { type: () => WeaponStatus, generateFilter: true, mapNumericEnum: true },
		});

		let capturedBindings: any = {};
		const provider = {
			...createMockProvider(),
			rawQuery: (sql: string, bindings: any) => {
				capturedBindings = bindings;
				return sql;
			},
			executeQuery: async () => [],
		};

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {} } as FieldSelection<TestBearer>;
		const filter = { Weapon: { status_eq: 'Corrupted' } };

		await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		const bindingValues = Object.values(capturedBindings);
		expect(bindingValues).toContain(913710001);
	});

	it('should convert enum inside _or with mapped field', async () => {
		setupEntities({
			status: { type: () => WeaponStatus, generateFilter: true, mapNumericEnum: true },
		});

		let capturedBindings: any = {};
		const provider = {
			...createMockProvider(),
			rawQuery: (sql: string, bindings: any) => {
				capturedBindings = bindings;
				return sql;
			},
			executeQuery: async () => [],
		};

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {} } as FieldSelection<TestBearer>;
		const filter = {
			_or: [{ Weapon: { status_eq: 'Worthy' } }, { Weapon: { status_eq: 'Corrupted' } }],
		};

		await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		const bindingValues = Object.values(capturedBindings);
		expect(bindingValues).toContain(913710000);
		expect(bindingValues).toContain(913710001);
	});

	it('should convert enum inside _and with mapped field', async () => {
		setupEntities({
			status: { type: () => WeaponStatus, generateFilter: true, mapNumericEnum: true },
		});

		let capturedBindings: any = {};
		const provider = {
			...createMockProvider(),
			rawQuery: (sql: string, bindings: any) => {
				capturedBindings = bindings;
				return sql;
			},
			executeQuery: async () => [],
		};

		type GQLResult = TestBearer & { _____name: string };
		const info = { id: {}, name: {} } as FieldSelection<TestBearer>;
		const filter = {
			_and: [{ Weapon: { status_eq: 'Worthy' } }, { Weapon: { power_eq: '100' } }],
		};

		await queryManager.getQueryResultsForFields<GQLResult, TestBearer>(
			provider,
			TestBearer,
			info,
			filter as any
		);

		const bindingValues = Object.values(capturedBindings);
		expect(bindingValues).toContain(913710000);
	});
});
