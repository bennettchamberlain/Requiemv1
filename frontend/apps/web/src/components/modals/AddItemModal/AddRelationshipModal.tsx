import { useState, type FormEvent } from 'react';

import { useMutation } from '@apollo/client';
import { Button, Dialog, Input, Textarea, Label } from '@ci/shadcn';

import { SearchModal } from '@/components/modals/SearchModal';
import { gql } from '@/graphql';

const CREATE_RELATIONSHIP = gql(`
  mutation CreateRelationship($input: CreateRelationshipInput!) {
    createRelationship(input: $input) {
      success
      relationship {
        id
      }
    }
  }
`);

interface Props {
  open?: boolean;
  onClose?: (open?: boolean) => void;
}

export function AddPersonModal({ open, onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [createRelationship, { loading }] = useMutation(CREATE_RELATIONSHIP);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      await createRelationship({
        variables: {
          input: {
            fromEntityId: '',
            toEntityId: '',
            type: '',
          },
        },
      });

      // Reset form and close modal on success
      setName('');
      setDescription('');
      onClose?.(false);
    } catch (error) {
      console.error('Failed to create person:', error);
    }
  };

  const handleCancel = () => {
    onClose?.(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <Dialog.Content className="sm:max-w-md">
        <Dialog.Header>
          <Dialog.Title>Add Relationship</Dialog.Title>
        </Dialog.Header>

        <SearchModal open={open} onClose={handleCancel}></SearchModal>
      </Dialog.Content>
    </Dialog>
  );
}
