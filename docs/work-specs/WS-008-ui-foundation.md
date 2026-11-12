# WS-008 — UI foundation: Tailwind, shadcn/ui and the app shell

- Status: Done (approved by the owner on 2026-11-12)
- Work-item: [WI-008](../work-items/WI-008-ui-foundation.md)
- Canonical docs: `AGENTS.md` sections 2 and 3

## Decisions taken with the owner (2026-11-12)

| Topic       | Decision                                            |
| ----------- | --------------------------------------------------- |
| Colour mode | Light and dark, following the system, with a toggle |
| Palette     | Neutral grey with a blue accent                     |
| App shell   | Collapsible left sidebar plus slim top bar          |
| Density     | Compact                                             |

## Approach

### Tailwind CSS 4

Installed as the docs shipped with the installed Next.js describe: `tailwindcss` and
`@tailwindcss/postcss`, a `postcss.config.mjs`, and `@import "tailwindcss"` in
`src/app/globals.css`. Tailwind 4 is configured in CSS; there is no `tailwind.config`.

`prettier-plugin-tailwindcss` sorts class names, so class order never shows up in review.

### shadcn/ui

shadcn/ui is not a package: its CLI copies component source into the repository, where it
becomes our code. `components.json` records the settings (style "new-york", neutral base
colour, CSS variables, `@/components/ui`).

Components added in this item, and nothing more: `button`, `dropdown-menu`, `sidebar`
(which brings `sheet`, `tooltip`, `separator`, `skeleton`, `input` and a `use-mobile`
hook). The shadcn `sidebar` is used rather than a hand-built one because it already
handles collapsing, the mobile overlay, keyboard shortcut and ARIA wiring.

Copied components must pass our lint, type and format rules. Where the upstream source
does not, it is fixed by hand in the file, and no directory-wide lint exemption is added.
The fixes are listed in this spec's implementation record.

### Theme

- `globals.css` defines the shadcn colour tokens as CSS variables under `:root` (light)
  and `.dark`. Greys are the neutral scale; `--primary`, `--ring` and the sidebar accent
  are blue. Exact values are chosen during implementation to pass WCAG AA contrast, and
  are verified by the axe tests.
- `next-themes` applies the `dark` class on `<html>`, defaults to the system setting,
  stores an explicit choice in `localStorage`, and injects the small script that prevents
  a flash of the wrong theme.
- A theme toggle in the top bar offers Light, Dark and System.

### Density and font

`html { font-size: 14px }`, so every `rem`-based Tailwind and shadcn size scales down
together. The typeface is the operating system's UI font stack: no font download, no
build-time network dependency, no layout shift.

### App shell and routes

```
src/app/layout.tsx          root: <html>, theme provider, globals.css
src/app/(app)/layout.tsx    the shell: sidebar + top bar + <main>
src/app/(app)/page.tsx      the home page (moved from src/app/page.tsx)
```

`(app)` is a route group: it adds the shell without changing URLs, so `/` stays `/`.
Future signed-in pages go inside it; sign-in pages (WT-02) will sit outside it.

Shell contents today:

- **Sidebar:** the "Opanel" brand at the top; an empty navigation area. No placeholder
  links.
- **Top bar:** the sidebar toggle on the left, the theme toggle on the right.
- **Main:** the page.

The sidebar's open/collapsed state is remembered in a cookie (built into the shadcn
component).

## Versions

| Package                             | Version                                              | Kind          |
| ----------------------------------- | ---------------------------------------------------- | ------------- |
| `tailwindcss`                       | 4.3.5                                                | dev           |
| `@tailwindcss/postcss`              | 4.3.5                                                | dev           |
| `prettier-plugin-tailwindcss`       | 0.8.1                                                | dev           |
| `shadcn` (CLI, run with `pnpm dlx`) | 4.23.0                                               | not installed |
| `next-themes`                       | 0.4.6                                                | dependency    |
| `lucide-react`                      | 1.72.0                                               | dependency    |
| `class-variance-authority`          | 0.7.1                                                | dependency    |
| `clsx`                              | 2.1.1                                                | dependency    |
| `tailwind-merge`                    | 3.7.0                                                | dependency    |
| `tw-animate-css`                    | 1.4.0                                                | dev           |
| Radix UI packages                   | as the shadcn CLI installs them, then pinned exactly | dependency    |
| `@axe-core/playwright`              | 4.14.0                                               | dev           |

## Files

| Path                                       | Change                                               |
| ------------------------------------------ | ---------------------------------------------------- |
| `package.json`, lockfile                   | modify                                               |
| `postcss.config.mjs`                       | create                                               |
| `.prettierrc.json`                         | modify: add the Tailwind plugin                      |
| `components.json`                          | create (shadcn settings)                             |
| `src/app/globals.css`                      | create: Tailwind import, theme tokens, base styles   |
| `src/lib/utils.ts`                         | create: `cn()` class-name helper (shadcn)            |
| `src/components/ui/*`                      | create: the vendored components listed above         |
| `src/hooks/use-mobile.ts`                  | create (shadcn)                                      |
| `src/components/theme-provider.tsx`        | create                                               |
| `src/components/theme-toggle.tsx`          | create, with `theme-toggle.test.tsx` (written first) |
| `src/components/app-shell/app-shell.tsx`   | create, with `app-shell.test.tsx` (written first)    |
| `src/components/app-shell/app-sidebar.tsx` | create                                               |
| `src/app/layout.tsx`                       | modify: import CSS, wrap in theme provider           |
| `src/app/(app)/layout.tsx`                 | create                                               |
| `src/app/(app)/page.tsx`, `page.test.tsx`  | moved from `src/app/`                                |
| `tests/e2e/shell.spec.ts`                  | create (written first)                               |
| `tests/e2e/accessibility.spec.ts`          | create (written first)                               |
| `vitest.setup.ts`                          | modify: `matchMedia` stub for jsdom                  |

`AGENTS.md` section 3 gains `src/hooks/` in the directory layout.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level        | Test                                                                                                  | Covers criterion        |
| --- | ------------ | ----------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | unit         | the shell renders a navigation landmark, a banner (top bar) and a `main` containing its children      | shell structure         |
| 2   | unit         | the sidebar shows the brand and contains no links                                                     | no dead links           |
| 3   | unit         | the theme toggle offers Light, Dark and System and calls the theme setter with the chosen value       | toggle                  |
| 4   | unit         | the existing home page test still passes after the move                                               | heading kept            |
| 5   | e2e          | with the system set to dark, `/` loads with the `dark` class on `<html>`; with light, without it      | follows system          |
| 6   | e2e          | choosing Dark in the toggle applies it; it is still applied after a reload                            | remembered              |
| 7   | e2e          | the sidebar toggle collapses and expands the sidebar; the state survives a reload                     | collapsible             |
| 8   | e2e          | at a phone viewport the sidebar is hidden, opens as an overlay, and the page has no horizontal scroll | narrow screens          |
| 9   | e2e          | computed root font size is 14px                                                                       | compact                 |
| 10  | e2e          | axe finds no violations on `/` in light and in dark mode                                              | accessibility, contrast |
| 11  | e2e          | the existing home and API tests still pass                                                            | nothing regressed       |
| 12  | manual, once | screenshots of `/` in light and dark, desktop and phone, reviewed by eye for layout and contrast      | it actually looks right |
| 13  | gate         | the five gate commands                                                                                | gate                    |

## Resolved questions

Decided with the owner on 2026-11-12: the system font stack is used; a narrowly scoped
lint adjustment for `src/components/ui/` was allowed as a fallback. It was not needed.

## Deviations from the approved spec

1. **shadcn's current CLI differs from what the spec assumed.** Version 4 has no
   "new-york" style; it asks for a base library and a preset. Chosen: base `radix`,
   preset `nova`, neutral base colour (`components.json` records `radix-nova`). Radix
   comes as the single `radix-ui` package, pinned at 1.8.1.
2. **The CLI's output was corrected in four places:**
   - it wrote `import { cn } from "cn"` in the components and in `src/lib/utils.ts`, and
     installed an unrelated npm package named `cn`. The imports now point at
     `@/lib/utils`, which holds the usual `clsx` + `tailwind-merge` helper, and the `cn`
     package is removed;
   - it added the `shadcn` CLI itself as a runtime dependency, only so `globals.css`
     could import one stylesheet from it. That stylesheet is copied to
     `src/styles/shadcn.css` instead and the dependency removed;
   - it added the Geist font through `next/font/google` in the root layout. Reverted, per
     the system-font decision;
   - it wrote `^` version ranges. All are pinned exactly.
3. **Lint fixes made by hand in copied code** (no rule was relaxed):
   - `src/hooks/use-mobile.ts` rewritten around `useSyncExternalStore`, replacing a
     `setState` call inside an effect that the React lint rules reject;
   - `src/components/ui/sidebar.tsx`: a ternary used as a statement became `if`/`else`,
     three template literals got explicit `String()` conversions, the cookie gained
     `SameSite=Lax`, and the "Toggle Sidebar" label became "Toggle sidebar";
   - import and export order auto-fixed in all eight component files.
4. **The shell does not use shadcn's `SidebarInset`.** That component renders `<main>`
   around everything, which would put the top bar inside `main`. The shell renders
   `<header>` and `<main>` as siblings so each is a proper landmark.
5. **`reuseExistingServer` is now always `false` in `playwright.config.ts`**, changing
   WS-007. While verifying this item, a leftover server on port 3100 was silently reused
   and two runs tested an old build. Now a busy port fails the run with "address already
   in use" instead.
6. **Extra dev dependency:** `@testing-library/user-event` 14.6.10, to drive the dropdown
   menu in the theme toggle's unit tests.
7. **Network:** the CLI downloads from `ui.shadcn.com`, which the development
   environment blocked. The owner approved a personal environment that allows that host.

## Implementation record

- Red: the two new unit test files failed on missing modules; the new end-to-end specs
  were written before the components existed.
- Green: 61 Vitest tests (51 unit, 10 integration) and 11 end-to-end tests pass.
- The accessibility test was shown to bite: lowering the contrast of the muted text
  colour in the light theme failed it with `color-contrast`; restored.
- Screenshots of `/` in light and dark, at 1280x720 and 390x844, were reviewed: sidebar,
  top bar and content render correctly in both themes, and the phone layout shows the
  sidebar as an overlay.
- All five gate commands pass.

## Risks and open questions

1. **System font stack rather than a bundled typeface** (such as Inter or Geist). It looks
   slightly different per operating system but costs nothing and cannot break a build.
   **Owner: agree, or do you want a specific typeface?**
2. **The shell is reachable without signing in** until WT-02 adds authentication, because
   there is nothing to sign in to yet. It shows no data.
3. The shadcn CLI may write files or settings beyond those listed (for example it can
   edit `globals.css`). Anything unexpected is reviewed, kept only if needed, and
   recorded.
4. If vendored components need more than small lint fixes, the fallback is a narrowly
   scoped rule adjustment for `src/components/ui/` only, recorded here with the reason.
   **Owner: is that fallback acceptable without a new approval round?**
