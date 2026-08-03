import { useMutation } from '@apollo/client';

import { PERSON_FRAGMENT } from '@/components/entities/grid/PersonGridItem';
import { gql, useFragment } from '@/graphql';

import type { MemoryEntityOf } from '../../useEntityService';

import { EntityDetailScaffold } from './EntityDetailScaffold';

const UPDATE_PERSON = gql(`
  mutation UpdatePersonDetail($input: UpdatePersonInput!) {
    updatePerson(input: $input) {
      success
      person {
        id
        name
        description
        firstName
        lastName
        birthDate
        avatarUrl
      }
    }
  }
`);

interface Props {
  entity: MemoryEntityOf<'PersonType'>;
}

export function PersonDetails({ entity }: Props) {
  const data = useFragment(PERSON_FRAGMENT, entity);
  const [updatePerson] = useMutation(UPDATE_PERSON);

  return (
    <EntityDetailScaffold
      entity={entity}
      title={data.name || 'Person'}
      subtitle="Person"
      taggable
      editFields={[
        { key: 'name', label: 'Name', value: data.name ?? '' },
        { key: 'firstName', label: 'First name', value: data.firstName ?? '' },
        { key: 'lastName', label: 'Last name', value: data.lastName ?? '' },
        { key: 'birthDate', label: 'Birthday (YYYY-MM-DD)', value: data.birthDate ?? '' },
        { key: 'avatarUrl', label: 'Avatar URL', value: data.avatarUrl ?? '' },
        { key: 'description', label: 'Description', value: data.description ?? '', multiline: true },
      ]}
      onSave={async (values) => {
        await updatePerson({
          variables: {
            input: {
              id: entity.id,
              name: values.name,
              description: values.description,
              firstName: values.firstName,
              lastName: values.lastName,
              birthDate: values.birthDate,
              avatarUrl: values.avatarUrl,
            },
          },
        });
      }}
      rawData={data}
    />
  );
}
