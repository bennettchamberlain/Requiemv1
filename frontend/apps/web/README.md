# Companion Intelligence — Dashboard Frontend

This frontend application serves as the SPA webpage view of the Digital Memory backend.

## Getting started

See the [parent README](../../../README.md) for instructions on how to get all the prerequisites installed.

You can boot the frontend development server with:

```
yarn dev
```

## Storybook

You can run a Storybook server and view components in isolation provided that you've composed stories for them.

```
yarn storybook
```

Aggregate stories can be composed [here](./stories/). You should prefer to co-locate component stories with their associated component file.
The naming convention is `MyComponent.stories.tsx` for a component named `MyComponent.tsx`.
