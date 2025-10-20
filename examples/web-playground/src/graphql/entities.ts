import { createGQLTypes } from '@dav3/gql-of-power';
import { Battle, Fellowship, Person, Ring } from 'src/schema/entities';
import { BattleFields, FellowshipFields, PersonFields, RingFields } from 'src/schema/fields';

// Create GQL types for each entity
export const PersonGQL = createGQLTypes(Person, PersonFields);
export const RingGQL = createGQLTypes(Ring, RingFields);
export const FellowshipGQL = createGQLTypes(Fellowship, FellowshipFields);
export const BattleGQL = createGQLTypes(Battle, BattleFields);

export const AllEntitiesGQL = [PersonGQL, RingGQL, FellowshipGQL, BattleGQL] as const;
