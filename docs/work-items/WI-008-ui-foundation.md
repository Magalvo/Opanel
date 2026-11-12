# WI-008 — UI foundation: Tailwind, shadcn/ui and the app shell

- Status: Done
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: WI-002, WI-007
- Work-spec: [WS-008](../work-specs/WS-008-ui-foundation.md)

## Outcome

The app has its visual foundation: a styling system, a themed component library, and the
empty frame every signed-in screen will live in. Later work-tracks add screens into this
frame instead of each inventing layout, colours and spacing.

## Acceptance criteria

- [x] Tailwind CSS and shadcn/ui are installed; shared components live in
      `src/components/ui`.
- [x] The theme is defined once as CSS variables: neutral greys with a blue accent, in a
      light and a dark variant.
- [x] The app follows the operating system's light/dark setting by default, offers a
      toggle (light, dark, system), and remembers the choice across reloads without a
      flash of the wrong theme.
- [x] The default density is compact (14px base text).
- [x] The app shell has a collapsible left sidebar and a slim top bar, with the page
      content in a `main` region. On narrow screens the sidebar becomes an overlay.
- [x] The shell contains no dead links or fake navigation: only what works today.
- [x] The home page renders inside the shell and still shows the "Opanel" heading.
- [x] Automated accessibility checks (axe) pass on the home page in both themes.
- [x] Vendored shadcn/ui components pass the project's lint, type-check and format rules
      without blanket exemptions.
- [x] The full five-command quality gate passes.

## Notes

No sign-in, user menu, project list or real navigation: those arrive with WT-02 and WT-03.
