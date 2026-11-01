# Personal fork development

The customized branch is `personal/release`, built on the latest official release tag so the app
matches the released T3 Code. `personal/main` is the older port onto
unreleased upstream `main`; `main` tracks the official repository.

## Omarchy laptop

```sh
git clone https://github.com/mattxslv/t3code.git
cd t3code
git switch personal/release
git remote add upstream https://github.com/pingdotgg/t3code.git
```

Install Vite+ using the instructions in the root README, then install dependencies and start:

```sh
vp i
vp run dev --home-dir .t3/personal-dev --no-seed
```

Use the local URL printed by the dev runner. Authenticate Codex and Claude Code on the laptop
using their own login commands; credentials are not copied through Git.

For Electron development on Arch Linux, install the host prerequisites:

```sh
sudo pacman -S rust base-devel libsecret pkgconf imagemagick
vp run dev:desktop --home-dir .t3/personal-dev --no-seed
```

The development home is separate from an installed T3 Code instance. Do not point development
servers at the live `~/.t3/userdata` directory.

## Installed app (Windows and Omarchy)

Releases are branded **T3 Code Personal** (app ID `com.mattxslv.t3code.personal`) and run beside
the official T3 Code, with their own profile and state in `~/.t3-personal`. They are published as
[releases of this fork](https://github.com/mattxslv/t3code/releases) and update themselves from
there, like the official app.

First install only:

- **Windows:** download `T3-Code-Personal-<version>-x64.exe` from the latest release and run it.
- **Omarchy:** AppImages need FUSE 2.

  ```sh
  sudo pacman -S --needed fuse2
  mkdir -p ~/Applications && cd ~/Applications
  gh release download --repo mattxslv/t3code --pattern '*.AppImage' --clobber
  chmod +x T3-Code-Personal-*.AppImage && ./T3-Code-Personal-*.AppImage
  ```

  The app adds its own launcher entry on first start. Keep the AppImage where it is so updates
  can replace it.

### AI Innov launcher (Claude on Google Vertex)

A second launcher, **T3 Code AI Innov**, opens the same installed app with Claude billed to a
Google Vertex project instead of the personal Claude subscription. The normal **T3 Code
Personal** launcher stays on the personal account. On Windows this is the desktop shortcut that
runs `C:\Users\matth\Scripts\t3-ai-innov.ps1`; on Omarchy it is set up by a script.

The Vertex project ID is not stored in this public repository; ask the owner for it.

```sh
yay -S --needed google-cloud-cli
gcloud auth application-default login
gcloud auth application-default set-quota-project <project-id>
scripts/personal/install-ai-innov-launcher.sh <project-id>   # optional 2nd arg: region, default global
```

The script adds **T3 Code AI Innov** to the app launcher (`~/.local/share/applications`) and two
commands in `~/.local/bin`: `t3-ai-innov` (the app) and `claude-ai-innov` (the Claude CLI). Both
set `CLAUDE_CODE_USE_VERTEX=1`, `ANTHROPIC_VERTEX_PROJECT_ID` and `CLOUD_ML_REGION`, and unset any
Anthropic key, token or base URL. Re-run it to change the project.

The app runs one instance, and a running copy keeps the account it started with: quit T3 Code
Personal from the tray before opening AI Innov, and the other way round. Only Opus 5.5 and
Sonnet 5 are available on the project, so in **Settings → Auto routing** hide the models it
lacks and give Sonnet 5 a tier (Settings → Auto routing → model tiers).

Versions map official `x.y.z` to `x.y.(z*100+n)`: official `0.1.5` becomes `0.1.500`, and later
fork-only builds on it become `0.1.501`, `0.1.502`, and so on.

## Pull updates

```sh
git switch personal/release
git pull --ff-only origin personal/release
```

Appearance preferences are local to each device. The reversed layout and bright-gray explorer
divider are the fork defaults; choose usage accounts separately on each device.

Use **Settings → Personal customizations** to enable or disable fork features. File paste and
drop use path references by default. Full paths from native files require the desktop app;
in a browser, paste paths copied with **Copy as path** (Windows) or local file URIs (Linux).
Images without a file on disk, such as clipboard screenshots, are attached normally; other
unknown paths never fall back to uploading file contents. The paperclip remains an explicit
attachment action. Local paths require a local agent; remote agents need uploaded attachments.

## Integrate official updates

This is automatic. The **Personal sync** workflow checks for a new official release about every
five hours, merges it into `personal/release`, type-checks it, and starts **Personal release**,
which builds Windows and Linux and publishes a release. Installed apps then offer the update.
`.github/workflows` always keeps this fork's version during the merge; inherited upstream
workflows stay disabled.

When the merge conflicts or fails type-checking, the workflow hands it to Claude Code with the
instructions in `.github/personal-merge-fix.md`. A fix ships only when no conflict markers remain
and all three type-checks pass. Claude signs in with the `CLAUDE_CODE_OAUTH_TOKEN` repository
secret (**Settings → Secrets and variables → Actions**), a token from `claude setup-token` that
uses the Claude subscription. The token lasts one year and does not renew itself; replace the
secret with a new `claude setup-token` before it expires (the current one was created 2026-10-31).

What happens when Claude does not produce a passing fix:

- **Out of usage** (or failed before starting): nothing is pushed and the run ends with a warning;
  the next run, about five hours later, tries again. After 48 hours it alerts.
- **Token expired, invalid or missing:** alerts at once.
- **Claude finished but the checks still fail:** alerts at once, and later runs do not call Claude
  again for that release. Run **Personal sync** by hand from the Actions tab to retry.

An alert is a failed run (GitHub emails you) whose summary, titled "Update to official vX.Y.Z
needs attention", lists the conflicting files or type errors (it also opens an issue if issues
are enabled on the fork). Each release alerts once; later runs only warn. To finish it by hand,
replacing `v0.1.6`:

```sh
git fetch upstream --tags
git switch personal/release
git merge v0.1.6
# resolve conflicts, keeping the fork's features and look
git push origin personal/release
```

Pushing to `personal/release` builds a new release, as does any other change pushed there.
Run either workflow by hand from the Actions tab. Local packaging for testing is described in
[Development](development.md#desktop-artifacts); local builds have no update feed unless
`T3CODE_DESKTOP_UPDATE_REPOSITORY` is set.
