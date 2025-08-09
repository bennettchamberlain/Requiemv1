import type { Preview } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';

import '../src/styles/index.css';

const preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      test: 'todo',
    },
  },
} satisfies Preview;

export const decorators = [
  (Story: any) => (
    <MemoryRouter>
      <Story />
    </MemoryRouter>
  ),
];

export default preview;
