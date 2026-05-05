import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { graphql, printSchema } from 'graphql';
import 'reflect-metadata';
import { buildSchema, Query, Resolver } from 'type-graphql';

import { setGlobalConfig } from '../../src';
import { createGQLTypes } from '../../src/entities/gql-entity';
import { Author, Book } from '../fixtures/middle-earth-schema';
import '../setup';

setGlobalConfig({ gqlTypesSuffix: '' });

describe('requiresRelations - GQL layer', () => {
	describe('FieldResolver receives data via requiresRelations', () => {
		it('resolve function receives root[as] with relationship data', async () => {
			let receivedRoot: any = null;

			const BookGQL = createGQLTypes(Book, {
				id: { type: () => Number, options: { nullable: false } },
				title: { type: () => String, options: { nullable: true } },
				publishedYear: { type: () => Number, options: { nullable: true } },
			});

			const AuthorGQL = createGQLTypes(
				Author,
				{
					id: { type: () => Number, options: { nullable: false } },
					name: { type: () => String, options: { nullable: true } },
				},
				{
					customFields: {
						latestBook: {
							type: () => BookGQL.GQLEntity,
							options: { nullable: true },
							requiresRelations: {
								books: {
									as: '_latestBooks',
									fields: { id: {}, title: {} },
								},
							},
							resolve: (root: any) => {
								receivedRoot = root;
								return root._latestBooks?.[0] ?? null;
							},
						},
					} as any,
				}
			);

			@Resolver(() => AuthorGQL.GQLEntity)
			class AuthorResolver {
				@Query(() => [AuthorGQL.GQLEntity])
				async authors() {
					return [
						{
							id: 1,
							name: 'Tolkien',
							_latestBooks: [
								{ id: 2, title: 'The Two Towers' },
								{ id: 1, title: 'The Fellowship of the Ring' },
							],
						},
					];
				}
			}

			const { FieldsResolver } = AuthorGQL.buildResolvers() as any;

			const schema = await buildSchema({
				resolvers: [AuthorResolver, FieldsResolver],
				validate: false,
			});

			const result = await graphql({
				schema,
				source: `
					query {
						authors {
							id
							name
							latestBook {
								id
								title
							}
						}
					}
				`,
			});

			expect(result.errors).toBeUndefined();
			expect(result.data?.authors).toHaveLength(1);
			expect(receivedRoot).not.toBeNull();
			if (receivedRoot) {
				expect(receivedRoot._latestBooks).toHaveLength(2);
			}
			expect(result.data?.authors[0].latestBook).toEqual({
				id: 2,
				title: 'The Two Towers',
			});
		});

		it('resolve returns null when required relationship data is empty', async () => {
			const BookGQL = createGQLTypes(Book, {
				id: { type: () => Number, options: { nullable: false } },
				title: { type: () => String, options: { nullable: true } },
			});

			const AuthorGQL = createGQLTypes(
				Author,
				{
					id: { type: () => Number, options: { nullable: false } },
					name: { type: () => String, options: { nullable: true } },
				},
				{
					customFields: {
						latestBook: {
							type: () => BookGQL.GQLEntity,
							options: { nullable: true },
							requiresRelations: {
								books: {
									as: '_latestBooks',
									fields: { id: {}, title: {} },
								},
							},
							resolve: (root: any) => root._latestBooks?.[0] ?? null,
						},
					} as any,
				}
			);

			@Resolver(() => AuthorGQL.GQLEntity)
			class AuthorResolver {
				@Query(() => [AuthorGQL.GQLEntity])
				async authors() {
					return [
						{
							id: 2,
							name: 'Empty Author',
							_latestBooks: [],
						},
					];
				}
			}

			const { FieldsResolver: FR2 } = AuthorGQL.buildResolvers() as any;

			const schema = await buildSchema({
				resolvers: [AuthorResolver, FR2],
				validate: false,
			});

			const result = await graphql({
				schema,
				source: `
					query {
						authors {
							id
							name
							latestBook {
								id
								title
							}
						}
					}
				`,
			});

			expect(result.errors).toBeUndefined();
			expect(result.data?.authors[0].latestBook).toBeNull();
		});
	});

	describe('forwardArgs generates schema with filter/pagination args', () => {
		it('schema accepts filter and pagination args on the custom field', async () => {
			const BookGQL = createGQLTypes(Book, {
				id: { type: () => Number, options: { nullable: false }, generateFilter: true },
				title: { type: () => String, options: { nullable: true }, generateFilter: true },
				publishedYear: {
					type: () => Number,
					options: { nullable: true },
					generateFilter: true,
				},
			});

			const AuthorGQL = createGQLTypes(
				Author,
				{
					id: { type: () => Number, options: { nullable: false } },
					name: { type: () => String, options: { nullable: true } },
					books: {
						type: () => BookGQL.GQLEntity,
						array: true,
						relatedEntityName: () => 'Book',
					},
				} as any,
				{
					customFields: {
						latestBook: {
							type: () => BookGQL.GQLEntity,
							options: { nullable: true },
							requiresRelations: {
								books: {
									as: '_latestBooks',
									useQueryFields: true,
									forwardArgs: true,
								},
							},
							resolve: (root: any) => root._latestBooks?.[0] ?? null,
						},
					} as any,
				}
			);

			const { FieldsResolver: FR3 } = AuthorGQL.buildResolvers() as any;

			@Resolver(() => AuthorGQL.GQLEntity)
			class AuthorResolver {
				@Query(() => [AuthorGQL.GQLEntity])
				async authors() {
					return [
						{
							id: 1,
							name: 'Tolkien',
							_latestBooks: [{ id: 1, title: 'The Hobbit', publishedYear: 1937 }],
						},
					];
				}
			}

			const schema = await buildSchema({
				resolvers: [AuthorResolver, FR3],
				validate: false,
			});

			const sdl = printSchema(schema);

			expect(sdl).toContain('filter');
			expect(sdl).toContain('pagination');

			const result = await graphql({
				schema,
				source: `
					query {
						authors {
							id
							name
							latestBook {
								id
								title
								publishedYear
							}
						}
					}
				`,
			});

			expect(result.errors).toBeUndefined();
			expect(result.data?.authors[0].latestBook).toEqual({
				id: 1,
				title: 'The Hobbit',
				publishedYear: 1937,
			});
		});
	});

	describe('requiresRelations + scalar requires combined', () => {
		it('resolve function can access both scalar requires and requiresRelations data', async () => {
			let receivedRoot: any = null;

			const BookGQL = createGQLTypes(Book, {
				id: { type: () => Number, options: { nullable: false } },
				title: { type: () => String, options: { nullable: true } },
			});

			const AuthorGQL = createGQLTypes(
				Author,
				{
					id: { type: () => Number, options: { nullable: false } },
					name: { type: () => String, options: { nullable: true } },
				},
				{
					customFields: {
						bookSummary: {
							type: () => String,
							options: { nullable: true },
							requires: ['name'] as any,
							requiresRelations: {
								books: {
									as: '_books',
									fields: { id: {}, title: {} },
								},
							},
							resolve: (root: any) => {
								receivedRoot = root;
								const count = root._books?.length ?? 0;
								return `${root.name} has ${count} book(s)`;
							},
						},
					} as any,
				}
			);

			const { FieldsResolver: FR4 } = AuthorGQL.buildResolvers() as any;

			@Resolver(() => AuthorGQL.GQLEntity)
			class AuthorResolver {
				@Query(() => [AuthorGQL.GQLEntity])
				async authors() {
					return [
						{
							id: 1,
							name: 'Tolkien',
							_books: [
								{ id: 1, title: 'The Hobbit' },
								{ id: 2, title: 'LOTR' },
							],
						},
					];
				}
			}

			const schema = await buildSchema({
				resolvers: [AuthorResolver, FR4],
				validate: false,
			});

			const result = await graphql({
				schema,
				source: `
					query {
						authors {
							id
							bookSummary
						}
					}
				`,
			});

			expect(result.errors).toBeUndefined();
			expect(result.data?.authors[0].bookSummary).toBe('Tolkien has 2 book(s)');
			expect(receivedRoot.name).toBe('Tolkien');
			expect(receivedRoot._books).toHaveLength(2);
		});
	});
});
