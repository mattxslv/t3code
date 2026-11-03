# GitHub Copilot

T3 Code can run the official [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) through its Agent Client Protocol mode (`copilot --acp`). Copilot uses the login on the machine that runs the T3 Code server, so a company-managed Copilot Business or Enterprise seat works without an API key.

## Set up Copilot

1. Install the Copilot CLI on that machine and check it runs with `copilot --version`.
2. Run `copilot login` in a terminal on that machine and sign in with the account that holds your Copilot seat.
3. Open **Settings → Providers**, enable GitHub Copilot, and refresh the provider.

If `copilot` is not on the server's `PATH`, set **Binary path** to the executable.

The provider reads your sign-in, plan, models and AI-credit quota through the official [Copilot SDK](https://github.com/github/copilot-sdk), which talks to the CLI you installed. Those reads never start a chat session or send a prompt. If `GH_TOKEN`, `GITHUB_TOKEN` or `COPILOT_GITHUB_TOKEN` is set in the server's environment, the Copilot CLI uses that token instead of your stored login.

## Models

The model picker lists **Copilot CLI default** first. That option keeps the model set in the Copilot CLI. The other entries are the models GitHub reports for your account. Models your organization's policy disables are left out, so the list changes when an administrator changes model policy. Each model offers the reasoning efforts Copilot reports for it.

**Copilot Auto** lets GitHub pick the model on its side.

## AI credits and billing

Copilot chat in T3 Code draws on the same AI-credit allowance as the Copilot CLI, VS Code and github.com. Credits are charged per model on input, output and cached tokens.

- **Usage** shows an **AI credits** bar with the percentage GitHub reports for your allowance and the reset date. T3 Code never estimates credit counts itself. When GitHub reports no quota, the Usage page links to your [Copilot settings on GitHub](https://github.com/settings/copilot) instead.
- Your organization may allow use past the allowance, billed to the organization. T3 Code does not change that setting.
- Copilot never writes commit messages, pull request text, branch names or thread titles, and it never classifies requests for Auto. Those background requests would spend credits without a prompt from you.

## Auto routing

Auto treats Copilot as a metered provider. Auto picks Copilot only after you turn on **Allow metered providers** in **Settings → Auto routing**. Once the AI-credit bar reaches 100%, Auto stops picking Copilot until the allowance resets.

When you select a Copilot model yourself, the thread stays on that model and Auto does not move it to another model or provider. To let Auto route that thread again, select a Claude or Codex model and choose **Return to Auto**.

**Copilot CLI default** and **Copilot Auto** never take part in Auto, because their model is decided outside T3 Code. Models whose family Auto does not recognise, such as `gpt-5.3-codex`, are skipped unless you give them a tier in **Model tiers**. To keep a single Copilot model out of Auto, hide it there.

## Permission modes

T3 Code launches Copilot without `--allow-all-tools`, `--allow-all` or autopilot, so every tool request Copilot sends goes through the thread's [permission mode](./permission-modes.md), the same way as other ACP agents.

Stopping a turn cancels the prompt and any background agents Copilot started for it.

## Sub-agents

When Copilot hands work to a sub-agent, it opens in its own thread under the parent.

## Not supported yet

- Commit messages, pull request text, branch names and thread titles. Pick another provider for those.
- Copilot's own `autopilot` mode and `allow_all` option.
- Copilot cloud sessions and remote control.

See [provider setup](./install.md#providers) and [ACP agents](./providers-acp.md).
