/**
 * Explicit orStrategy forwarding through the programmatic public entry:
 * GQLQueryManager.getQueryResultsForFields.
 *
 * The mapper's `buildQueryAndBindingsFor({ orStrategy })` hard-override
 * argument must be reachable from the query-manager API, not just by
 * constructing a mapper directly. Precedence unchanged: the forwarded explicit
 * argument beats root pagination.orStrategy (mapper-level behavior covered in
 * or-strategy-explicit-override.test.ts / or-strategy-explicit-vs-child.test.ts).
 *
 * SQL-text assertions only.
 */
import { describe, expect, it, mock } from 'bun:test';
import { GQLQueryManager } from '../../src/query-manager';
import { Person } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('query-manager forwards explicit orStrategy', () => {
	const filterWithOr = { _or: [{ name_eq: 'Frodo Baggins' }, { race_eq: 'Elf' }] };

	it('explicit orStrategy param beats root pagination.orStrategy', async () => {
		const provider = createMockMetadataProvider();
		const captured: string[] = [];
		const wrappingProvider = {
			...provider,
			executeQuery: mock(async (sql: string) => {
				captured.push(sql);
				return [];
			}),
		};
		const manager = new GQLQueryManager();

		await manager.getQueryResultsForFields(
			wrappingProvider as any,
			Person,
			{ id: {}, name: {}, race: {} },
			filterWithOr as any,
			{ orStrategy: 'union-all' } as any, // root pagination says union-all…
			undefined,
			'or' // …explicit argument forces 'or' — must win
		);

		expect(captured.length).toBeGreaterThan(0);
		const sql = captured[0].toLowerCase();
		expect(sql).not.toContain('union all');
		expect(sql).toContain(') or (');
	});

	it('pagination.orStrategy still respected when no explicit argument passed', async () => {
		const provider = createMockMetadataProvider();
		const captured: string[] = [];
		const wrappingProvider = {
			...provider,
			executeQuery: mock(async (sql: string) => {
				captured.push(sql);
				return [];
			}),
		};
		const manager = new GQLQueryManager();

		await manager.getQueryResultsForFields(
			wrappingProvider as any,
			Person,
			{ id: {}, name: {}, race: {} },
			filterWithOr as any,
			{ orStrategy: 'or' } as any
			// no entityNameOverride / explicit argument — pagination value applies
		);

		expect(captured.length).toBeGreaterThan(0);
		const sql = captured[0].toLowerCase();
		expect(sql).not.toContain('union all');
		expect(sql).toContain(') or (');
	});
});
