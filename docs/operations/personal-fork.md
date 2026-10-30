# Personal fork development

The customized branch is `personal/release`, built on the latest official release tag (currently
`v0.1.3`) so the app matches the released T3 Code. `personal/main` is the older port onto
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

## Installed Windows app

Packaged builds are branded **T3 Code Personal** (app ID `com.mattxslv.t3code.personal`) and
install beside the official T3 Code: `%LOCALAPPDATA%\Programs\t3code-personal`, Electron profile
`%APPDATA%\t3code-personal`, state in `~/.t3-personal`. Local builds have no update feed, so the
app never replaces itself with an official release. Requires Rust and VS Build Tools (C++).

```sh
vp run dist:desktop:win:x64
release/T3-Code-Personal-<version>-x64.exe
```

Reinstall over the existing copy after pulling or committing changes. Day-to-day work happens in
the dev server, which uses `.t3/personal-dev` and is separate from both installed apps.

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
Unknown paths never fall back to uploading file contents. The paperclip remains an explicit
attachment action. Local paths require a local agent; remote agents need uploaded attachments.

## Integrate official updates

Follow official releases, not upstream `main`. With a clean working tree, replacing `v0.1.4`
with the new release tag:

```sh
git fetch upstream --tags
git switch personal/release
git merge v0.1.4
vp run check:changed v0.1.4
git push origin personal/release
```

Resolve conflicts and verify on Windows and Linux before pushing the customized branch. The
official CI uses custom runner infrastructure; inherited release workflows are not a ready-made
fork release pipeline. Development builds and local packaging instructions are described in
[Development](development.md#desktop-artifacts). No signed release or custom update feed is
configured by these UI changes.
