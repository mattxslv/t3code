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

This is automatic. The **Personal sync** workflow checks for a new official release every six
hours, merges it into `personal/release`, type-checks it, and starts **Personal release**, which
builds Windows and Linux and publishes a release. Installed apps then offer the update.
`.github/workflows` always keeps this fork's version during the merge; inherited upstream
workflows stay disabled.

When the merge conflicts or fails type-checking, nothing is pushed. Instead the **Personal sync**
run fails, and its summary, titled "Update to official vX.Y.Z needs attention", lists the
conflicting files or type errors (it also opens an issue if issues are enabled on the fork). To
finish it, replacing `v0.1.6`:

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
