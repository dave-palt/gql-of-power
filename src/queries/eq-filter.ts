import { FieldOperations, Operations } from '../operations';
import { MappingsType } from '../types';
import { logger } from '../variables';
import { Alias } from './gql-to-sql-mapper';

export const applyFilterOperation = ({
	fieldOperation,
	filterValue,
	latestAlias,
	fieldName,
	mapping,
}: {
	fieldOperation: (string & keyof typeof Operations) | (string & keyof typeof FieldOperations);
	fieldName: string;
	filterValue: string | number | boolean | bigint;
	latestAlias: Alias;
	mapping: MappingsType;
}) => {
	const filterFieldWithAlias = `${latestAlias.toString()}.${fieldName}`;
	const filterParameterName = `${latestAlias.nextValue()}_${fieldName}`;

	const where = Operations[fieldOperation](
		[filterFieldWithAlias, ':' + filterParameterName],
		['_', filterValue]
	);
	const value = { [filterParameterName]: filterValue };

	logger.log(fieldName, 'applyFilterOperation where', where, 'values', value);
	mapping.where.push(where);
	mapping.values = { ...mapping.values, ...value };
};
