import type { StorybookConfig } from '@storybook/react-vite';

const config = {
  stories: ['../stories/**/*.stories.{ts,tsx}', '../src/**/*.stories.{ts,tsx}'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
} satisfies StorybookConfig;

export default config;
