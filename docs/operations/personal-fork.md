# Personal fork development

The customized branch is `personal/main`; `main` tracks the official repository.

## Omarchy laptop

```sh
git clone https://github.com/mattxslv/t3code.git
cd t3code
git switch personal/main
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

## Pull updates

```sh
git switch personal/main
git pull --ff-only origin personal/main
```

Appearance preferences are local to each device. The reversed layout and bright-gray explorer
divider are the fork defaults; choose usage accounts separately on each device.

## Integrate official updates

With a clean working tree:

```sh
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
git switch personal/main
git merge main
vp run check:changed main
git push origin personal/main
```

Resolve conflicts and verify on Windows and Linux before pushing the customized branch. The
official CI uses custom runner infrastructure; inherited release workflows are not a ready-made
fork release pipeline. Development builds and local packaging instructions are described in
[Development](development.md#desktop-artifacts). No signed release or custom update feed is
configured by these UI changes.
