/**
 * Explicit (programmatic) orStrategy argument vs pagination-carried orStrategy.
 *
 * Rule (spec 2026-08-20): when `orStrategy` is EXPRESSLY passed to the query
 * building (`buildQueryAndBindingsFor({ orStrategy })`), it is applied IGNORING
 * any strategy carried on pagination — both the ROOT pagination and CHILD field
 * paginations. A warning is logged whenever a pagination-carried strategy is
 * overridden this way, to highlight that the request asked for a strategy but
 * backend code forces a different one.
 *
 * SQL-text assertions only — binding-value assertions false-pass on dropped
 * clauses (see inline-filter-position-parity.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { setGlobalConfig } from '../../src';
import { GQLtoSQLMapper } from '../../src/queries/gql-to-sql-mapper';
import { Book } from '../fixtures/middle-earth-schema';
import { createMockMetadataProvider } from '../fixtures/test-data';
import '../setup';

describe('explicit orStrategy argument vs pagination.orStrategy', () => {
	let mapper: GQLtoSQLMapper;

	const build = (opts: any) => mapper.buildQueryAndBindingsFor(opts);

	// root _or with a relation key — strategy visibly changes the root SQL
	// shape ('union all' branches vs flattened '(c1) or (exists ...)')
	const rootOrWithRelation = {
		_or: [{ title_eq: 'A' }, { author: { name_eq: 'Bilbo' } }],
	};

	beforeEach(() => {
		mapper = new GQLtoSQLMapper(createMockMetadataProvider());
	});

	afterEach(() => {
		setGlobalConfig({ orStrategy: 'union-all' });
		process.env.D3GOP_LOG_TYPE = 'disabled';
	});

	describe('explicit argument wins over root pagination', () => {
		it('explicit "union-all" beats pagination.orStrategy "or"', () => {
			const { querySQL } = build({
				fields: { id: {}, title: {} },
				entity: Book,
				customFields: {},
				filter: rootOrWithRelation,
				pagination: { orStrategy: 'or' },
				orStrategy: 'union-all',
			});

			expect(querySQL.toLowerCase()).toContain('union all');
		});

		it('explicit "or" beats pagination.orStrategy "union-all"', () => {
			const { querySQL } = build({
				fields: { id: {}, title: {} },
				entity: Book,
				customFields: {},
				filter: rootOrWithRelation,
				pagination: { orStrategy: 'union-all' },
				orStrategy: 'or',
			});

			expect(querySQL.toLowerCase()).not.toContain('union all');
			expect(querySQL.toLowerCase()).toContain(' or ');
		});

		it('explicit "or" applies when no pagination strategy is present', () => {
			const { querySQL } = build({
				fields: { id: {}, title: {} },
				entity: Book,
				customFields: {},
				filter: rootOrWithRelation,
				orStrategy: 'or',
			});

			expect(querySQL.toLowerCase()).not.toContain('union all');
			expect(querySQL.toLowerCase()).toContain(' or ');
		});
	});

	describe('override warning', () => {
		const spyWarn = () => {
			const warnSpy = mock(() => {});
			const origWarn = console.warn;
			console.warn = warnSpy as any;
			process.env.D3GOP_LOG_TYPE = 'orStrategy';
			return () => {
				console.warn = origWarn;
				process.env.D3GOP_LOG_TYPE = 'disabled';
				return warnSpy;
			};
		};

		it('warns when root pagination.orStrategy is overridden by the explicit argument', () => {
			const restore = spyWarn();
			try {
				build({
					fields: { id: {}, title: {} },
					entity: Book,
					customFields: {},
					filter: rootOrWithRelation,
					pagination: { orStrategy: 'or' },
					orStrategy: 'union-all',
				});
			} finally {
				var warnSpy = restore();
			}

			expect(warnSpy).toHaveBeenCalledTimes(1);
			const msg = warnSpy.mock.calls[0].join(' ');
			// highlights both the request's strategy and the forced one
			expect(msg).toContain('pagination.orStrategy');
			expect(msg).toContain('"or"');
			expect(msg).toContain('"union-all"');
		});

		it('does NOT warn when no pagination strategy is present', () => {
			const restore = spyWarn();
			try {
				build({
					fields: { id: {}, title: {} },
					entity: Book,
					customFields: {},
					filter: rootOrWithRelation,
					orStrategy: 'or',
				});
			} finally {
				var warnSpy = restore();
			}

			expect(warnSpy).not.toHaveBeenCalled();
		});

		it('does NOT warn when explicit and pagination strategies agree', () => {
			const restore = spyWarn();
			try {
				build({
					fields: { id: {}, title: {} },
					entity: Book,
					customFields: {},
					filter: rootOrWithRelation,
					pagination: { orStrategy: 'or' },
					orStrategy: 'or',
				});
			} finally {
				var warnSpy = restore();
			}

			expect(warnSpy).not.toHaveBeenCalled();
		});
	});
});
