# Personal fork handoff

Updated: 2026-10-30. Repository: https://github.com/mattxslv/t3code. Working branch:
`personal/release` (based on the `v0.1.5` release). Official upstream: https://github.com/pingdotgg/t3code.

## Current behavior

- **Settings → Personal customizations** groups the fork features, with a master switch
  and individual controls. Preferences persist per device; disabling features retains choices.
- Reversed outer layout is the default, with navigation on the right and workspace on the
  left. The explorer sits left of opened files. Both placements can be changed in settings.
- Panel controls are grouped at the top-left. Project/environment details open beneath
  the details button, including when the editor owns the title bar.
- Composer usage shows the selected Codex or Claude provider by default. It reuses existing
  usage subscriptions and account selection without adding polling or combining accounts.
  Session percentage and reset countdown sit beside/in the bar. Codex is gray; Claude is
  dark brown. There is no duplicate provider logo, and missing reset text is hidden at 100%.
  The tooltip shows only weekly remaining allowance, a progress bar, and reset information.
  Provider identity and connection/stale status remain in the accessible button label.
  Clicking opens Usage → Limits. Unknown allowances are never invented.
- Explorer divider color supports presets and custom HEX. The release explorer has a fixed
  width, so the color applies to its border; there is no resize handle.
- **Classic composer controls** (on by default) keep the pre-0.1.5 composer: model, effort,
  and access menus on the left with chevrons and the effort gauge icon, access always shown,
  full model names, and usage, attach, and send on the right. Off restores the release
  composer with the usage bar before send. The flag reaches `TraitsPicker` as the
  `classicTrigger` prop because `TraitsPicker` is in `composerDraftStore`'s import graph;
  importing `useSettings` there creates a cycle through `lib/utils`.
- With word wrap disabled, overflowing source previews have a synchronized bottom horizontal
  scrollbar, including editable and read-only previews.
- Composer paste/drop defaults to local path references rather than file uploads. Desktop
  resolves native file paths; browsers require a copied absolute path or file URI. Path-less
  images (clipboard screenshots) upload as attachments; other files without a path produce an
  explanation rather than silently uploading. Local path insertion is
  blocked for remote environments. The paperclip still explicitly attaches files.

## Important files

- `packages/contracts/src/settings.ts`: persisted customization defaults and schema.
- `apps/web/src/components/settings/CustomizationsSettings.tsx`: settings group.
- `apps/web/src/components/settings/settingsSearch.ts`: searchable settings entries.
- `apps/web/src/components/chat/ComposerUsageIndicators.tsx`: composer bar and weekly tooltip.
- `apps/web/src/components/chat/composerUsageIndicators.logic.ts`: account/window selection.
- `apps/web/src/state/composerUsage.ts`: existing usage state normalization.
- `apps/web/src/components/chat/composerFilePaths.ts`: safe path parsing/resolution.
- `apps/web/src/components/chat/ChatComposer.tsx`: path paste/drop interception.
- `apps/web/src/components/chat/ThreadDetailsCard.tsx`: toolbar-anchored project popover.
- `apps/web/src/components/chat/ChatCanvas.tsx`: avoids reserving inline card space in left mode.
- `apps/web/src/components/files/FileHorizontalScrollbar.tsx`: native scrollbar synchronization.
- `apps/web/src/components/files/FilePreviewPanel.tsx`: explorer placement and divider color.
- `apps/web/src/index.css`: scoped toolbar positioning, usage colors, scrollbar styling.
- `apps/web/src/routeTree.gen.ts`: generated settings route, committed with its route source.

## Development and validation

See [personal fork development](personal-fork.md) for Windows/Omarchy setup, pulling updates,
desktop prerequisites, and upstream synchronization. Use Node/Vite+ versions from the repo.
Run `vp i`, then `vp run dev --home-dir .t3/personal-dev --no-seed`.
Never run development against the installed application's live `~/.t3/userdata`.
Credentials, installed dependencies, and device preferences are not distributed through Git.

Focused coverage includes settings persistence/master switch, path parsing, scrollbar
synchronization, account/window logic, and details popover behavior. Before pushing, run
`vp run check:changed`. On this Windows checkout its ignored-file cache scan has previously
stalled; if it does again, stop only that invocation and run targeted checks instead.
Do not kill processes by name or stop the user's running application.

Useful focused commands:

```sh
vp test run packages/contracts/src/settings.test.ts apps/web/src/components/chat/composerFilePaths.test.ts apps/web/src/components/chat/composerUsageIndicators.logic.test.ts apps/web/src/components/settings/CustomizationsSettings.browser.test.tsx apps/web/src/components/files/FileHorizontalScrollbar.browser.test.tsx apps/web/src/components/chat/ThreadDetailsCard.browser.test.tsx
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/web build
```

Handoff validation: all 48 tests across the six files above passed, as did web type-check,
changed-source lint, changed-file formatting, and the production web build. The combined
`check:changed` helper stalled again and was stopped; it did not complete successfully.

## Remaining validation and limitations

- Verify on Omarchy: native Linux file-manager copy/drop, Electron path resolution, narrow
  windows, keyboard resizing, and light-theme contrast of the dark Claude bar.
- The web browser cannot recover arbitrary local filesystem paths from a `File`; non-image files
  without a backing path need the paperclip or attachment mode.
- Latest tooltip/color changes were format/lint checked; no visual browser capture was made.
- Releases come from `.github/workflows/personal-release.yml` (unsigned Windows and Linux builds)
  and update installed apps; see [personal fork development](personal-fork.md). Inherited
  upstream workflows are disabled.
- Keep changes focused when merging upstream; the composer footer, composer control triggers
  (`ComposerControlsBar`, `ProviderModelPicker`, `TraitsPicker`, `ComposerFooterControls`),
  canvas, and generated route tree are likely conflict points. No dependency additions were needed.
