You are finishing an automatic merge of an official T3 Code release into `personal/release`,
the branch behind **T3 Code Personal**, a personal fork. The merge is in progress in this
checkout. `FIX_REASON` in the environment says what is wrong:

- `conflicts`: `git merge` stopped with conflicts. The conflicting files are listed in
  `$RUNNER_TEMP/conflicted.txt`.
- `checks`: the merge completed but type-checking fails. The errors are in
  `$RUNNER_TEMP/check.log`.

Your job is to make the merged code correct, keeping **both** sides:

1. Keep every upstream change. Upstream is the official project; when it restructures or
   renames code, adopt the new structure.
2. Keep every personal customization working on top of it. They are described in
   `docs/operations/personal-fork-handoff.md` and are all behind settings in
   **Settings → Personal customizations** (`packages/contracts/src/settings.ts`,
   `apps/web/src/components/settings/CustomizationsSettings.tsx`). When upstream rewrote the
   code a customization touched, re-apply the customization's intent to the new code rather
   than restoring the old code. Never drop a customization or its setting to make a conflict go
   away, and keep upstream behavior unchanged when a customization is turned off.
3. Match the surrounding code style. Keep fork-only comments short.

Rules:

- Resolve every conflict marker in the listed files.
- Do not modify anything under `.github/workflows`.
- Do not commit, push, abort the merge, or change git configuration; the workflow commits.
- Do not edit `pnpm-lock.yaml` by hand. If `package.json` files conflicted, resolve them, then run
  `vp install`.

When you are done, verify, and keep fixing until all of these pass:

```sh
vp install
vp run --filter @t3tools/contracts typecheck
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/desktop typecheck
```

Finish with a short summary of how you resolved each file.
