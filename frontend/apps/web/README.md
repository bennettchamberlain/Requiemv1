# Companion Intelligence — Dashboard Frontend

This frontend application serves as the SPA webpage view of the Digital Memory backend.

## Getting started

See the [parent README](../../../README.md) for instructions on how to get all the prerequisites installed.

You can boot the frontend development server with:

```
yarn dev
```

> In normal local development you don't run this directly — `make dev` from the
> repo root starts `web` (and `api`) via overmind behind Caddy. Run `yarn dev`
> on its own only when you want the Vite server in isolation.

## Pages & routes

The SPA is a React + Vite + Apollo app; routes are declared in `src/App.tsx` and
each maps to a page under `src/pages/`.

```mermaid
flowchart TB
    Root["/"]
    subgraph Public["Logged-out"]
      Login["/login"]
      Signup["/signup"]
      Onboarding["/onboarding"]
    end
    subgraph Memory["Memory & retrieval"]
      Mem["/memory"]
      Search["/search"]
      Saved["/saved-searches"]
      Chat["/chat/:id?"]
      Feed["/feed/:id?"]
      Insights["/insights"]
      InsightDetail["/insights/:id"]
    end
    subgraph Records["Records & detail"]
      People["/people/:id"]
      Places["/places/:id"]
      Events["/events/:id"]
      Items["/items/:id"]
      Content["/content/:id"]
      Concepts["/concepts/:id"]
      Comms["/communications/:id"]
      Notes["/notes/:id?"]
      Files["/files"]
      Inventory["/inventory"]
    end
    subgraph Ops["Connections & system"]
      Connect["/connect"]
      Connections["/connections"]
      ConnectionDetail["/connections/:id"]
      Providers["/providers/:id"]
      Jobs["/jobs"]
      Settings["/settings/* (appearance · api-keys · oauth)"]
      System["/system"]
      OAuthCb["/oauth/callback · /openid/callback"]
    end

    Root --> Public
    Root --> Memory
    Root --> Records
    Root --> Ops
```

## Screenshots

UI screenshots for the docs are captured against a running, seeded stack and
committed under `docs/images/`. See the
[screenshot capture guide](../../../docs/screenshots.md) for the screen list,
viewport, and naming conventions.

## Storybook

You can run a Storybook server and view components in isolation provided that you've composed stories for them.

```
yarn storybook
```

Aggregate stories can be composed [here](./stories/). You should prefer to co-locate component stories with their associated component file.
The naming convention is `MyComponent.stories.tsx` for a component named `MyComponent.tsx`.
