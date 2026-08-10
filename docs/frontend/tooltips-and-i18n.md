# Tooltips and i18n (web frontend)

> **Private & Confidential — Property of Lifescope Inc. Do not distribute.**

Two conventions that travel together: every icon-only control gets a tooltip, and
the tooltip text comes from a translation key.

## Tooltips

Use `IconButton` from `@ci/shadcn` for icon-only buttons. It is the house wrapper
around the Radix tooltip and the shadcn `Button`:

```tsx
import { IconButton } from '@ci/shadcn';
import { Trash } from '@ci/shadcn/icons';
import { useTranslation } from 'react-i18next';

const { t } = useTranslation();

<IconButton label={t('NOTES_DELETE')} variant="ghost" onClick={onDelete}>
  <Trash />
</IconButton>;
```

`label` is required and feeds **both** the tooltip and `aria-label`, so the hover
affordance and the screen-reader name cannot drift apart. Do not pass `aria-label`
alongside it. Everything else (`variant`, `className`, `disabled`, `asChild`,
`data-testid`) forwards to `Button`; `size` defaults to `icon`.

| Prop | Use it for |
|---|---|
| `tooltip` | Tooltip text that should differ from the accessible name (e.g. a long explanation of *why* a control is disabled) |
| `side` / `align` | Placement, when the default would collide with a panel edge |
| `delayDuration` | Hover delay; defaults to 600ms |

A disabled `Button` gets `pointer-events: none` from `buttonVariants`, which would
swallow the hover. `IconButton` anchors the tooltip to a wrapper span when
`disabled` is set, so the tooltip still explains why the control is off.

**Controls that are not a shadcn `Button`** — `Toggle`, `ToggleGroup.Item`,
`Tabs.Trigger`, `Avatar`, raw `<button>`, badges, status dots — keep their own
element and get the `Tooltip` primitive instead:

```tsx
import { Tooltip } from '@ci/shadcn';

<Tooltip delayDuration={600}>
  <Tooltip.Content>{t('ENTITY_EDIT_TOGGLE')}</Tooltip.Content>
  <Tooltip.Trigger asChild>
    <Toggle aria-label={t('ENTITY_EDIT_TOGGLE')} pressed={editMode} onPressedChange={setEditMode}>
      <Pencil />
    </Toggle>
  </Tooltip.Trigger>
</Tooltip>;
```

The exported `Tooltip` wraps its own provider, so a surrounding `Tooltip.Provider`
is only needed to share one `delayDuration` across a cluster of controls — see
[`Map/Controls.tsx`](../../frontend/apps/web/src/components/Map/Controls.tsx).

**Never use the raw `title` attribute.** It is unstyled, slow to appear, invisible
on touch, and it renders *in addition to* a Radix tooltip when both are present.

## i18n

The mechanism mirrors CI-Hub so translator tooling and key conventions stay shared
across the two apps: i18next + react-i18next, one `translation` namespace, flat
`SCREAMING_SNAKE_CASE` keys, `en.json` as the Crowdin source.

- Strings: [`frontend/packages/common/i18n/translations/en.json`](../../frontend/packages/common/i18n/translations/en.json)
- Init: [`frontend/apps/web/src/lib/i18n.ts`](../../frontend/apps/web/src/lib/i18n.ts), called from `main.tsx` and from the vitest setup
- Crowdin: [`crowdin.yml`](../../crowdin.yml) at the repo root

```tsx
const { t } = useTranslation();

t('COMMON_CLOSE');
t('UPLOAD_REMOVE_FILE', { name: file.name }); // {{name}} interpolation
```

Key naming follows Hub: a domain prefix, then the specific action —
`SETTINGS_API_KEY_DELETE`, `CHAT_THREAD_NEW`, `MEMORY_VIEW_GALLERY`. Strings shared
across surfaces live under `COMMON_`.

**Do not add keys for user data.** A filename, a person's name, a colour preset, a
thread title — those are values, not copy, and go straight into `Tooltip.Content`:

```tsx
<Tooltip.Content>{media.title}</Tooltip.Content>
```

### Differences from Hub, and what is not done yet

Hub ships 30 locales and fetches them over HTTP, so it blocks first paint on an
async load. CI-Server ships only `en`, bundled, and initialises synchronously —
which is why `t()` resolves during the first render and inside tests without any
provider wrapper.

Only tooltip and icon-button strings are keyed today. The rest of the app's copy —
headings, buttons with visible labels, empty states, toasts — is still hardcoded
English. Internationalising it is a separate, whole-app migration; adding keys
piecemeal buys indirection without ever making the app translatable.

When a second locale lands, add `i18next-http-backend` with
`partialBundledLanguages: true` and serve the JSON from the API, matching
[Hub's provider](../../../CI-Hub/packages/frontend/src/components/providers/i18n/i18n-provider.tsx).
