# All Chat — Props-Interface Sweep (EDD-props-interface-sweep)

| | |
|---|---|
| **Status** | Complete |
| **Date** | 2026-08-18 |
| **Scope** | Convert `$props()` destructures in `web/src` from inline object-literal types (or no types) to named `Props`/`PageProps`/`LayoutProps` types |
| **Author** | Gregory McQuillan |
| **License** | This document is CC BY-SA 4.0 — see [docs/LICENSE](LICENSE). Source code elsewhere in this repo is licensed separately (root [LICENSE](../LICENSE), [shared/contract/LICENSE](../shared/contract/LICENSE)). |
| **Builds on** | [2026-08-18-dock-overlay-split.edd.md](2026-08-18-dock-overlay-split.edd.md) — the component extraction that produced most of the files in scope here. |

## 1. Overview

Every Svelte 5 component/route file in `web/src` that calls `$props()` types
the destructure inline — either as an anonymous object-literal type
(`let { x }: { x: T } = $props();`) or, for three route files and the root
layout, not at all. Editors show hover help on prop *names* but not on a
named *type*, and multi-prop signatures (`DockHeader.svelte` has 11 props)
read as one undifferentiated blob at the top of the file.

This doc designs converting each of these to a named type declared just above
the destructure — `interface Props` for hand-written component props,
SvelteKit's generated `PageProps`/`LayoutProps` for route `data`/`children`
props — with no behavior change.

## 2. Goals / Non-goals

### Goals

- Every `$props()` call site in `web/src` types its destructure via a named
  type, not an inline object literal or no type at all.
- Component props use a module-local `interface Props`. Route props use
  SvelteKit's generated `PageProps`/`LayoutProps` from `./$types`.
- Zero behavior change — this is a type-annotation-only refactor.

### Non-goals

- Renaming or restructuring props themselves (order, optionality, defaults)
  — only how they're typed.
- Introducing a shared `lib/types` directory for prop shapes — none of the 11
  files' prop shapes are reused across files (aside from `ChatSession`, which
  is already a named import), so there's nothing to centralize.
- Reformatting destructure line-wrapping beyond what the type-annotation move
  requires — a file that already wraps one prop per line keeps wrapping one
  prop per line.

## 3. Survey

11 files call `$props()` in `web/src`; confirmed zero existing
`interface Props`/`type Props` anywhere in the codebase and no `lib/types`
directory — this is a fresh convention, not a rename of an existing one.

| File | Current style | Notes |
|---|---|---|
| `lib/components/feed/PlatformIcon.svelte` | inline object type | 1 prop |
| `lib/components/feed/AvatarDisc.svelte` | inline object type | 1 prop |
| `lib/components/feed/BadgeStrip.svelte` | inline object type | 1 prop |
| `lib/components/feed/MessageFeed.svelte` | inline object type | 6 props, 1 optional w/ default |
| `lib/components/feed/ComposeForm.svelte` | inline object type | 2 props |
| `lib/components/feed/ProfileSwitcher.svelte` | inline object type | 6 props incl. callback `onswitch` |
| `lib/components/feed/DockHeader.svelte` | inline object type | 11 props, 4 `$bindable()` |
| `routes/+layout.svelte` | untyped | `children` — implicit `Snippet` |
| `routes/login/+page.svelte` | untyped | `{ data }` — no `PageProps` |
| `routes/admin/+page.svelte` | untyped | `{ data }` — no `PageProps` |
| `routes/profiles/+page.svelte` | untyped | `{ data }` — no `PageProps` |

`routes/+page.svelte` and `routes/overlay/+page.svelte` take no props — out
of scope.

`MessageFeed.svelte`/`ComposeForm.svelte` already import `ChatSession` by
name from `$lib/chat/session.svelte` (`export type ChatSession =
ReturnType<typeof createChatSession>`, `session.svelte.ts:225`) and reference
it inline; their new `Props` interfaces reuse that name rather than
re-deriving the session shape.

## 4. Design decisions

1. **Component prop files** (7 files under `lib/components/feed/`): declare
   `interface Props { ... }` immediately above `let {...}: Props =
   $props();`, in the same `<script lang="ts">` block. One `interface` per
   component, always named `Props` — module-local, never exported, so no
   per-component prefix (`PlatformIconProps`, etc.) is needed.
2. **`$bindable()` props** (`DockHeader.svelte`): bindability is a
   destructure-time concern (`= $bindable()`), not a type-level one — `Props`
   declares `showIcons: boolean` etc. the same as a non-bindable prop; only
   the destructuring RHS carries `$bindable()`.
3. **Route `+page.svelte` files with `{ data }`** (`login`, `admin`,
   `profiles`): use SvelteKit's generated `PageProps` from `./$types` instead
   of a hand-written `Props` interface. Confirmed available
   (`@sveltejs/kit ^2.63.0`; `.svelte-kit/types/**/$types.d.ts` already
   generates `PageProps` for these routes) — the framework-idiomatic
   equivalent of "named type over inline" for route data, so the sweep uses
   it rather than inventing a parallel hand-rolled type.
4. **`routes/+layout.svelte`** (`children`): same treatment — generated
   `LayoutProps` covers `children` typed as `Snippet` automatically, no
   manual `import type { Snippet } from 'svelte'` needed.
5. Callback props (`onswitch: (target: Profile) => void`) stay as inline
   function-type members of `Props` — not worth a separate named alias for a
   single-use signature.
6. Destructure formatting is preserved as-is (one prop per line where it
   already wraps that way) — only the trailing type annotation moves from an
   inline object literal to the named type. No collapsing multi-line
   destructures onto one line.

## 5. Before/after samples

**Simple single-prop component** (`PlatformIcon.svelte`):
```ts
// before
let { platform }: { platform: Platform } = $props();

// after
interface Props {
  platform: Platform;
}
let { platform }: Props = $props();
```

**Multi-prop + callback** (`ProfileSwitcher.svelte`):
```ts
// before
let {
  profileId,
  profileName,
  profileList,
  profileListError,
  profileSwitchError,
  onswitch
}: {
  profileId: string | undefined;
  profileName: string;
  profileList: Profile[];
  profileListError: string | undefined;
  profileSwitchError: string | undefined;
  onswitch: (target: Profile) => void;
} = $props();

// after
interface Props {
  profileId: string | undefined;
  profileName: string;
  profileList: Profile[];
  profileListError: string | undefined;
  profileSwitchError: string | undefined;
  onswitch: (target: Profile) => void;
}
let {
  profileId,
  profileName,
  profileList,
  profileListError,
  profileSwitchError,
  onswitch
}: Props = $props();
```

**Bindable props** (`DockHeader.svelte`):
```ts
// before
let {
  profileId,
  profileName,
  profileList,
  profileListError,
  profileSwitchError,
  onswitch,
  statuses,
  showIcons = $bindable(),
  showAvatars = $bindable(),
  showTimestamps = $bindable(),
  theme = $bindable()
}: {
  profileId: string | undefined;
  profileName: string | undefined;
  profileList: Profile[];
  profileListError: string | undefined;
  profileSwitchError: string | undefined;
  onswitch: (target: Profile) => void;
  statuses: Record<string, StatusEvent>;
  showIcons: boolean;
  showAvatars: boolean;
  showTimestamps: boolean;
  theme: Theme;
} = $props();

// after
interface Props {
  profileId: string | undefined;
  profileName: string | undefined;
  profileList: Profile[];
  profileListError: string | undefined;
  profileSwitchError: string | undefined;
  onswitch: (target: Profile) => void;
  statuses: Record<string, StatusEvent>;
  showIcons: boolean;
  showAvatars: boolean;
  showTimestamps: boolean;
  theme: Theme;
}
let {
  profileId,
  profileName,
  profileList,
  profileListError,
  profileSwitchError,
  onswitch,
  statuses,
  showIcons = $bindable(),
  showAvatars = $bindable(),
  showTimestamps = $bindable(),
  theme = $bindable()
}: Props = $props();
```

**Route page with `data`** (`routes/login/+page.svelte`):
```ts
// before
let { data } = $props();

// after
import type { PageProps } from './$types';

let { data }: PageProps = $props();
```

**Layout** (`routes/+layout.svelte`):
```ts
// before
let { children } = $props();

// after
import type { LayoutProps } from './$types';

let { children }: LayoutProps = $props();
```

## 6. Suggested atomic step order

Two passes, each its own commit, `npm run check` green after each:

1. **Components pass** — all 7 files under `lib/components/feed/` in one
   commit: `PlatformIcon.svelte`, `AvatarDisc.svelte`, `BadgeStrip.svelte`,
   `ComposeForm.svelte`, `MessageFeed.svelte`, `ProfileSwitcher.svelte`,
   `DockHeader.svelte` (bindable props — most complex, still the same
   mechanical pattern as the rest). Grouped since it's one mechanical change
   across a single directory — avoids 7 near-identical review turns.
2. **Routes pass** — all 4 route/layout files in one commit:
   `routes/login/+page.svelte`, `routes/admin/+page.svelte`,
   `routes/profiles/+page.svelte` → `PageProps`; `routes/+layout.svelte` →
   `LayoutProps`. Split from the components pass since it's a materially
   different convention (generated SvelteKit types, not a hand-written
   `Props` interface).

## 7. Verification

- After each pass: `cd web && npm run check` (svelte-check) stays green —
  primary signal, since the change is type-annotation-only.
- `npm run build` after both passes as a final sanity check.
- No manual/browser verification needed — zero behavioral surface area.

## 8. Open questions

- None outstanding — naming (`Props` vs. per-component prefix) and the
  route-file convention (`PageProps`/`LayoutProps` vs. hand-written type)
  were resolved during planning.
