import type { CreateNoteDto } from '@ci/domains/notes/types';

import { JOHN_SMITH } from './users';

type SeedNote = RequiredFields<CreateNoteDto, 'id'> & {
  userId: string;
};

export const NOTES: SeedNote[] = [
  {
    id: '019ba22d-b4a0-74a6-8b3b-c7ad1dbc4ed4',
    title: 'Reminder to get groceries tonight',
    content: "Don't forget to pick up ingredients for turkey burgers tonight's dinner.",
    userId: JOHN_SMITH.id,
  },
];
