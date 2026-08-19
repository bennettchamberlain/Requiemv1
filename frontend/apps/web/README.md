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
      Mem["/memory<br/>+ /memory/people · places · events · things<br/>· knowledge · content · tags · questions · reflections"]
      Search["/search"]
      Saved["/saved-searches"]
      Shared["/shared/:token"]
      Chat["/chat/:id?"]
      Feed["/feed/:id? · /feed/summaries/:id"]
      Brief["/today/:id? · /brief/:id?"]
      Insights["/insights · /insights/:id"]
      Stats["/stats · /forecast"]
    end
    subgraph Records["Records & detail"]
      People["/people · /people/:id"]
      Places["/places · /places/:id"]
      Events["/events/:id"]
      Items["/items/:id"]
      Content["/content/:id"]
      Concepts["/concepts/:id"]
      Comms["/communications/:id"]
      Notes["/notes · /notes/:id?"]
      Tags["/tags"]
      Files["/files"]
      Inventory["/inventory"]
    end
    subgraph Plan["Planning"]
      PlanR["/plan"]
      Schedule["/schedule"]
    end
    subgraph Ops["Connections & system"]
      Connect["/connect · /device-connect"]
      Connections["/connections · /connections/:id"]
      Providers["/providers/:id"]
      Sources["/sources/:half?"]
      Import["/import"]
      Jobs["/jobs"]
      Prompts["/prompts"]
      Settings["/settings/*"]
      System["/system · /server"]
      OAuthCb["/oauth/callback · /openid/callback"]
    end

    Root --> Public
    Root --> Memory
    Root --> Records
    Root --> Plan
    Root --> Ops
```

> The route list moves fast — `src/App.tsx` is the source of truth; this diagram
> is a map of the shape, not a guaranteed-complete index.

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
