#!/usr/bin/env bash
# Adds "T3 Code AI Innov" to the Omarchy/Linux app launcher: T3 Code Personal with Claude on a
# Google Vertex project instead of the personal Claude subscription. Also adds `claude-ai-innov`
# for the Claude CLI. The normal "T3 Code Personal" launcher stays on the personal account.
#
# Usage: scripts/personal/install-ai-innov-launcher.sh <vertex-project-id> [region]
set -euo pipefail

project="${1:-}"
region="${2:-global}"
if [[ -z "$project" ]]; then
  echo "usage: $0 <vertex-project-id> [region]" >&2
  exit 2
fi

bin_dir="$HOME/.local/bin"
apps_dir="$HOME/.local/share/applications"
mkdir -p "$bin_dir" "$apps_dir"

# Shared environment: Vertex on, any Anthropic key or proxy off so they cannot take precedence.
env_block="export CLAUDE_CODE_USE_VERTEX=1
export ANTHROPIC_VERTEX_PROJECT_ID='$project'
export CLOUD_ML_REGION='$region'
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL"

cat >"$bin_dir/t3-ai-innov" <<EOF
#!/usr/bin/env bash
# Written by scripts/personal/install-ai-innov-launcher.sh. Re-run that script to change it.
$env_block

notify() { command -v notify-send >/dev/null && notify-send "T3 Code AI Innov" "\$1"; echo "\$1" >&2; }

# The app keeps one window; a running copy keeps the account it started with.
if pgrep -f 'T3-Code-Personal.*\.AppImage' >/dev/null || pgrep -x 't3code-personal' >/dev/null; then
  notify "T3 Code Personal is already open. Quit it (tray icon → Quit), then open AI Innov again."
  exit 1
fi

# Updates replace the AppImage under a new version name, so pick the newest one.
appimage=\$(ls -t "\$HOME"/Applications/T3-Code-Personal-*.AppImage 2>/dev/null | head -n1 || true)
if [[ -z "\$appimage" ]]; then
  notify "No T3-Code-Personal AppImage in ~/Applications. Install it first (docs/operations/personal-fork.md)."
  exit 1
fi
exec "\$appimage" "\$@"
EOF

cat >"$bin_dir/claude-ai-innov" <<EOF
#!/usr/bin/env bash
# Written by scripts/personal/install-ai-innov-launcher.sh. Claude Code CLI on the Vertex project.
$env_block
exec claude "\$@"
EOF

chmod +x "$bin_dir/t3-ai-innov" "$bin_dir/claude-ai-innov"

# Reuse the icon the app installs for its own launcher entry, when present.
icon="t3code-personal"
existing=$(grep -l '^Name=T3 Code Personal' "$apps_dir"/*.desktop 2>/dev/null | head -n1 || true)
if [[ -n "$existing" ]]; then
  icon=$(sed -n 's/^Icon=//p' "$existing" | head -n1)
  icon="${icon:-t3code-personal}"
fi

cat >"$apps_dir/t3-code-ai-innov.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=T3 Code AI Innov
Comment=T3 Code Personal with Claude on Google Vertex ($project)
Exec=$bin_dir/t3-ai-innov %U
Icon=$icon
Terminal=false
Categories=Development;
EOF

command -v update-desktop-database >/dev/null && update-desktop-database "$apps_dir" >/dev/null 2>&1 || true

echo "Installed:"
echo "  launcher   T3 Code AI Innov  ($apps_dir/t3-code-ai-innov.desktop)"
echo "  commands   $bin_dir/t3-ai-innov, $bin_dir/claude-ai-innov"
if ! command -v gcloud >/dev/null; then
  echo "Next: install the Google Cloud CLI (yay -S google-cloud-cli)."
fi
echo "Sign in to Google once: gcloud auth application-default login"
echo "                        gcloud auth application-default set-quota-project $project"
