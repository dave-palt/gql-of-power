/**
 * Unit Tests for _exists / _not_exists Filter Feature
 *
 * Tests the SQL generation for existence filters on related entities.
 * _exists generates EXISTS subqueries, _not_exists generates NOT EXISTS.
 * Multiple keys within a single _exists/_not_exists are AND-combined.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import {
	Author,
	Battle,
	Book,
	Fellowship,
	GQLEntityFilterInputFieldType,
	Location,
	Person,
	Region,
} from '../../src/types';
import {
	Author as AuthorEntity,
	Battle as BattleEntity,
	Book as BookEntity,
	Fellowship as FellowshipEntity,
	Person as PersonEntity,
	Region as RegionEntity,
} from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('_exists / _not_exists Filter Feature', () => {
	let mapper: GQLtoSQLMapper;
	let mockProvider: ReturnType<typeof createMockMetadataProvider>;

	beforeEach(() => {
		mockProvider = createMockMetadataProvider();
		mapper = new GQLtoSQLMapper(mockProvider);
	});

	describe('_exists filter', () => {
		it('should generate EXISTS subquery for 1:m relationship', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_exists: {
					books: { title: 'The Hobbit' },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: AuthorEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('exists');
			expect(result.querySQL).toContain('books');
			expect(result.querySQL.toLowerCase()).toContain('title');
			expect(result.bindings).toBeDefined();
		});

		it('should generate EXISTS subquery for m:1 relationship', () => {
			const fields = { id: {}, title: {} };
			const filter = {
				_exists: {
					author: { name: 'Tolkien' },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: BookEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('exists');
			expect(result.querySQL).toContain('authors');
			expect(result.querySQL.toLowerCase()).toContain('name');
		});

		it('should generate EXISTS subquery for m:m relationship', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_exists: {
					battles: { outcome: 'Victory' },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: PersonEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('exists');
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL.toLowerCase()).toContain('outcome');
		});

		it('should AND-combine multiple keys in _exists', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_exists: {
					battles: { outcome: 'Victory' },
					books: { title: 'The Hobbit' },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: PersonEntity,
				customFields: {},
				filter: filter as any,
			});

			const sql = result.querySQL.toLowerCase();
			const existsCount = (sql.match(/exists/g) || []).length;
			expect(existsCount).toBeGreaterThanOrEqual(2);
			expect(result.querySQL).toContain('battles');
			expect(result.querySQL).toContain('books');
		});

		it('should support field operators inside _exists filter', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_exists: {
					members: { age_gt: 80 },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: FellowshipEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('exists');
			expect(result.querySQL.toLowerCase()).toContain('age');
			expect(result.querySQL).toContain('>');
		});

		it('should support nested relationship filters inside _exists', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_exists: {
					location: { Region: { name: 'Gondor' } },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: BattleEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('exists');
		});

		it('should compose with _and', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_and: [{ _exists: { battles: { outcome: 'Victory' } } }, { race: 'Hobbit' }],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: PersonEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('exists');
			expect(result.querySQL.toLowerCase()).toContain('race');
		});

		it('should compose with _or', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_or: [
					{ _exists: { battles: { outcome: 'Victory' } } },
					{ _exists: { books: { title: 'The Hobbit' } } },
				],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: PersonEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('exists');
			expect(result.querySQL.toLowerCase()).toContain('union all');
		});
	});

	describe('_not_exists filter', () => {
		it('should generate NOT EXISTS subquery', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_not_exists: {
					books: { title: 'The Silmarillion' },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: AuthorEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('not exists');
			expect(result.querySQL).toContain('books');
		});

		it('should AND-combine multiple NOT EXISTS clauses', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_not_exists: {
					battles: { outcome: 'Defeat' },
					books: { title: 'Unknown' },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: PersonEntity,
				customFields: {},
				filter: filter as any,
			});

			const sql = result.querySQL.toLowerCase();
			const notExistsCount = (sql.match(/not exists/g) || []).length;
			expect(notExistsCount).toBeGreaterThanOrEqual(2);
		});

		it('should compose _exists and _not_exists in _and', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_and: [
					{ _exists: { books: { title: 'The Hobbit' } } },
					{ _not_exists: { battles: { outcome: 'Defeat' } } },
				],
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: PersonEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL.toLowerCase()).toContain('exists');
			expect(result.querySQL.toLowerCase()).toContain('not exists');
		});
	});

	describe('_exists edge cases', () => {
		it('should handle _exists with empty filter value gracefully', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_exists: {},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: PersonEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toBeDefined();
			expect(result.bindings).toBeDefined();
		});

		it('should handle _not_exists with empty filter value gracefully', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_not_exists: {},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: PersonEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toBeDefined();
			expect(result.bindings).toBeDefined();
		});

		it('should skip unknown relationship keys in _exists', () => {
			const fields = { id: {}, name: {} };
			const filter = {
				_exists: {
					nonexistentRelation: { name: 'test' },
				},
			};

			const result = mapper.buildQueryAndBindingsFor({
				fields,
				entity: PersonEntity,
				customFields: {},
				filter: filter as any,
			});

			expect(result.querySQL).toBeDefined();
			expect(result.bindings).toBeDefined();
		});
	});
});
