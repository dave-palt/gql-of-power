import type { EntityMetadata, MetadataProvider } from '@dav3/gql-of-power';
import { AllEntityMetadata } from 'src/schema/entities';
import { knexInstance as knex, sql } from './sql';

export class SimpleMetadataProvider implements MetadataProvider {
	client = 'pg';
	constructor() {}

	exists(entityName: string): boolean {
		return entityName in AllEntityMetadata;
	}
	getMetadata<T, K extends EntityMetadata<T>>(entityName: string) {
		// Simple mapping for Middle-earth entities
		return AllEntityMetadata[entityName as keyof typeof AllEntityMetadata] as K;
	}
	async executeQuery(rawSQL: string, ...params: any[]) {
		const time = 'Executing SQL';
		console.time(time);
		const bindSQL = knex.raw(rawSQL, params).toString();
		console.timeLog(time, bindSQL);
		const res = await sql`${sql.unsafe(bindSQL)}`;
		console.timeEnd(time);
		return res;
	}
}
