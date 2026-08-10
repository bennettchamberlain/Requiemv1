import type { Preview, StoryContext, StoryFn } from '@storybook/react';
import { MemoryRouter } from 'react-router-dom';

import { FeaturesProvider } from '@/common/feature';
import { AuthProvider } from '@/hooks';
import { initI18n } from '@/lib/i18n';

import '../src/styles/index.css';

// Without this, react-i18next hands back a no-op `t` that returns the key, so
// every story renders raw KEY strings as tooltip text and accessible names —
// which the a11y addon then audits.
initI18n();

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
  (story: StoryFn, context: StoryContext) => (
    <MemoryRouter>
      <AuthProvider args={[]}>
        <FeaturesProvider args={[]}>{story(context.args, context)}</FeaturesProvider>
      </AuthProvider>
    </MemoryRouter>
  ),
];

export default preview;
