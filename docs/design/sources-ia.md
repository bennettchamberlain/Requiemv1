# Sources — the information architecture of "get my data in"

## The problem

Getting data into Companion had three destinations for one intention.

| Surface | What it was | How you found it |
|---|---|---|
| `/connections` | A grid of provider groups, and the line `Total Connections: 0` | Avatar menu → Connections |
| `/connect` | A gallery of things you *could* connect: browser extensions, Capture, one card that links to `/import`, and the service-integration grid | The `+` add menu, or the `+` button on `/connections` |
| `/import` | The archive wizard (Pick → Export → Sync) plus Inbox and History tabs | A single card on `/connect` |

Three problems compounded:

1. **The entry point was in the wrong menu.** `Connections` lived in the account
   dropdown — next to Settings, Theme and Log out. That is a menu people open to
   *change a setting*, not to *add data*. The primary sidebar carried Feed,
   Schedule, Memory, Chat, Saved Searches, Stats and Notes, and nothing about
   where any of it comes from.

2. **The first screen was a dead end.** A new user's `/connections` was a title
   and `Total Connections: 0`. The one screen guaranteed to be seen by everyone,
   exactly once, at the moment they have no idea what to do, said nothing about
   what to do.

3. **The split was invisible to the user.** `/connections` (what is connected),
   `/connect` (what you could connect) and `/import` (archives) are three
   implementation facts. The user has one question — *how do I get my stuff in?*
   — and it has exactly two real answers: connect a live service, or import an
   export you already have.

## The decision

**One nav entry, one page, two paths.**

```
Sidebar → Sources → /sources
                      ├── /sources/connect   live services, extensions, Capture, connected accounts
                      └── /sources/import    the archive wizard + Inbox + History
```

### Why "Sources" and not "Connect" or "Data"

The sidebar is a list of nouns — Feed, Memory, Notes, Stats. *Sources* fits, and
it names the thing rather than one of the two verbs. Calling the entry "Connect"
would have made the archive half feel like a sub-mode of connecting, which is
backwards: for most people a Google Takeout is the larger contribution to their
memory. "Data" is true of every page in the app.

### Why two paths and not two routes

The two halves are addressable (`/sources/connect`, `/sources/import`) so that
redirects, onboarding, and any deep link can land someone in the right half —
but they render inside **one page**, under one heading, with one switch that is
always on screen. The switch is not a tab strip; it is two tiles that each say
what that path is for and how long it takes. Someone who lands on the wrong half
can see the other one without going back.

`/sources` itself redirects to `/sources/connect`. Connecting is the
lower-effort path and the right default for a first visit; an export is
something you usually already have in hand and came here deliberately to add.

### Why the empty state is the switch, made loud

Rather than a separate first-run screen, the same two tiles render in a
**first-run** density when the appliance has no connections and no import runs:
bigger, with what each path is best for, how long it takes, and an explicit
button. When there is data, the same component renders compact with counts.

The page carries **no heading and no standfirst**. The breadcrumb already reads
"Companion › Sources › Connect", the rail entry is labelled Sources, and the
tiles say what each path is for — a title plus an introductory paragraph on top
of that was the third and fourth restatement of the same thing, and it pushed
the only actionable content on the screen below the fold. The tiles are the
first thing you see.

One component, two densities. The empty state cannot drift from the navigation,
because it *is* the navigation — and the screen a new user sees is the screen
that explains the only decision they have to make.

The distinction the tiles draw is the one people actually get wrong:

- **Connect a service** — a minute of work, and it keeps syncing. Gets you
  *from now on*, plus whatever recent history the API exposes.
- **Import an export** — you request it from the service, wait hours or days,
  then drop the file in. Gets you *your whole history*.

Most people should do both, and the empty state says so.

### What happened to `/connections`

The connected-accounts grid did not deserve a route. It is a status list, and it
belongs at the top of the connect half — above the gallery of what you could add
next — where it answers "what have I already done" in the place you go to do
more. The connection *detail* page keeps its own URL (`/connections/:id`); it is
a real object with real state, linked from the grid.

## Redirects

Old routes are kept as redirects, so bookmarks, docs and in-app links keep
working:

| Old | New |
|---|---|
| `/connect` | `/sources/connect` |
| `/connections` | `/sources/connect` |
| `/import` | `/sources/import` |
| `/connections/:id` | unchanged — connection detail |

## Feature flag

`/import` was gated behind `import.page`, and a flag-gated route in this app is
not merely blocked when off — it is never registered, so it 404s. `/sources` is
**not** gated: the connect half must always exist. Only the import half is. With
`import.page` off, the import tile is not rendered, `/sources/import` redirects
to `/sources/connect`, and the page reads as a single path rather than offering
one that leads nowhere. This matches how onboarding already treats it —
`buildOnboardingStepKeys` only pushes `import-archives` when the flag is on.

## What was deliberately left alone

- **Onboarding.** `connect-source` and `import-archives` remain separate steps
  hosting the same `ServiceIntegrationsSection` and `ImportSurface` components.
  Onboarding is a linear script with its own stepper; the two-path switch is a
  navigation device for a page you return to, and it would be a second answer to
  "where am I" inside a flow that already has one.
- **`ImportSurface`.** Untouched. `/sources/import` hosts the same
  `variant="page"` surface `/import` did, with the same Import/Inbox/History
  tabs.
- **Mobile.** The mobile bottom bar has five slots and no header; `/sources` is
  reached from System, which is where the mobile layout already collects
  appliance-level destinations.
