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

- **Usage** shows an **AI credits** bar with the percentage GitHub reports for a token-billed allowance and a future reset date when provided. Legacy premium-request counters are not labeled as AI credits. T3 Code uses only the official SDK quota snapshot, which can be cached; it is not a live billing balance. T3 Code never estimates credit counts itself. When GitHub reports no quota, the Usage page links to your [Copilot settings on GitHub](https://github.com/settings/copilot) instead.
- Your organization may allow use past the allowance, billed to the organization. T3 Code does not change that setting.
- Copilot never writes commit messages, pull request text, branch names or thread titles. Those background requests would spend credits without a prompt from you. On a Work thread, T3 Code does not send them to your other providers either, so write commit messages and pull request text yourself or switch the thread to Personal.

## Auto routing

Copilot Auto routing requires **Allow metered providers** in Auto routing settings because AI credits can incur overage charges. Manual selection remains available without this opt-in.

The **Account** switch in the model picker keeps Copilot and your other subscriptions apart. It belongs to the thread, and you can flip it at any time, for example when your AI credits run out.

- **Work** uses Copilot. Auto picks a Copilot model for each turn, sizing unclear requests on the lightest Copilot model. Only your message is sent for that, and it spends a small amount of AI credits and can add a few seconds before the turn starts. T3 Code never moves a Work turn to Claude or Codex, even when the AI-credit bar reaches 100%.
- **Personal** uses Claude and Codex, and Auto never picks Copilot. To keep Auto within one of them, set **Settings → Auto routing → Personal Auto providers → Selected provider only**, pick a model from that provider, then choose **Return to Auto**. Auto may change models within that provider instance, but fallback, escalation and AI classification stay there. This is an environment setting; the default remains **Claude and Codex**.

Selecting a model yourself moves the switch to that model's side and pins it. Choose **Return to Auto** to let Auto route again.

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
