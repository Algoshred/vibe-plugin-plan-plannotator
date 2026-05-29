# @vibecontrols/vibe-plugin-plan-plannotator

Plannotator plan provider for the [VibeControls](https://vibecontrols.com)
agent. Wraps the upstream [plannotator](https://plannotator.ai) CLI:

- Installs the `plannotator` binary on demand (sha256-pinned).
- Spawns a per-session plannotator HTTP server on a dedicated port.
- Reverse-proxies the local UI at `/plan/:sessionId/*`, stripping
  iframe-blocking headers so the agent's vibetunnels URL can embed it.
- Configures AI-agent hooks (Claude Code, OpenCode, Codex, Pi, Gemini)
  so completed plans land in plannotator automatically.
- Registers with the agent's `ServiceRegistry` under the `"plan"` type
  so the meta plugin [`@vibecontrols/vibe-plugin-plan`](https://github.com/algoshred/vibe-plugin-plan)
  can dispatch to it.

## Install

```bash
vibe plugin install @vibecontrols/vibe-plugin-plan
vibe plugin install @vibecontrols/vibe-plugin-plan-plannotator
vibe plan-plannotator install               # downloads the binary
```

Or set `VIBE_PLANNOTATOR_AUTOINSTALL=1` to auto-install on first plan
request (not recommended for shared agents).

## REST API

Mounted under `/api/plan-plannotator` on the agent (plus `/plan/:sessionId/*`
as the reverse proxy).

| Method | Path                              | Description                                      |
| ------ | --------------------------------- | ------------------------------------------------ |
| `GET`  | `/status`                         | Binary install status + running sessions         |
| `POST` | `/install`                        | Run the sha256-pinned installer                  |
| `GET`  | `/prereqs`                        | Same as `/status` (matches meta-plugin contract) |
| `POST` | `/prereqs/install`                | Alias of `/install`                              |
| `POST` | `/stop?sessionId=`                | Stop a specific session, or all sessions         |
| `GET`  | `/agents/supported`               | Detect installed AI agents + hook status         |
| `POST` | `/agents/:agent/configure-hook`   | Write the plannotator hook for an agent          |
| `POST` | `/agents/:agent/unconfigure-hook` | Remove the hook                                  |

`:agent` is one of `claude`, `opencode`, `codex`, `pi`, `gemini`.

## CLI

```bash
vibe plan-plannotator status
vibe plan-plannotator install
vibe plan-plannotator stop [--session <id>]
vibe plan-plannotator agents list
vibe plan-plannotator agents configure <agent>
vibe plan-plannotator agents unconfigure <agent>
```

## Configuration

Environment variables (all optional):

| Name                                | Default  | Meaning                                                          |
| ----------------------------------- | -------- | ---------------------------------------------------------------- |
| `PLANNOTATOR_PORT`                  | `19432`  | Preferred port for plannotator. Falls back to a scan of +10.     |
| `VIBE_PLANNOTATOR_AUTOINSTALL`      | unset    | If `1`, auto-install the binary on first session start.          |
| `VIBE_PLANNOTATOR_INSTALL_UNPINNED` | unset    | If `1`, bypass the sha256 pin on `install.sh` (NOT recommended). |
| `VIBE_PLANNOTATOR_IDLE_MS`          | `900000` | Kill a session after this many ms of inactivity.                 |
| `VIBE_PLANNOTATOR_IDLE_SCAN_MS`     | `60000`  | Idle watchdog scan interval.                                     |

## Per-agent hook setup

- **Claude Code**: writes a `PreToolUse` hook matched to `ExitPlanMode` in `~/.claude/hooks.json`.
- **OpenCode**: adds `@plannotator/opencode` to the `plugin` array in `~/.config/opencode/opencode.json`.
- **Codex CLI**: appends a `[hooks.plannotator]` block bracketed by marker comments in `~/.codex/config.toml`.
- **Pi**: drops `~/.pi/hooks/before_agent_start.d/vibe-plan-plannotator.sh`.
- **Gemini CLI**: drops `~/.gemini/hooks/vibe-plan-plannotator.sh`.

All hooks are idempotent (re-running configure does not duplicate) and
refuse to write outside `$HOME`.

## Troubleshooting

- **Port 19432 in use**: set `PLANNOTATOR_PORT` to another port. The
  provider scans the next 10 if the preferred port is busy.
- **Iframe blocked**: confirm the agent's reverse proxy mounts cleanly
  by hitting `${tunnelUrl}/plan/` — expect a 404 placeholder, not a 502.
- **Hung session**: `vibe plan-plannotator stop --session <id>` (or the
  15 min idle watchdog will reap it).

## Development

```bash
bun install
bun run sanity   # format:check + lint + type:check + test + build
```

<!-- VIBECONTROLS_OSS_FOOTER_START -->

---

## About VibeControls

**VibeControls** is the agentic engineering mission control for AI-native teams. Vibe-plugins extend the VibeControls agent with new providers, tools, sessions, tunnels, storage backends, and security stages.

- Website: <https://vibecontrols.com>
- Documentation: <https://docs.vibecontrols.com>
- Plugin SDK: <https://github.com/algoshred/vibecontrols-plugin-sdk>
- All plugins: <https://github.com/algoshred?q=vibe-plugin-&type=all>

## Credits

This plugin builds on the following upstream open-source projects. All trademarks and copyrights remain with their respective owners.

- **Plannotator** — <https://github.com/backnotprop/plannotator>

## License

Released under the [MIT License](./LICENSE).

Copyright (c) 2026 Burdenoff Consultancy Services Private Limited, Algoshred Technologies Private Limited, and all its sister companies.

Maintainer: **Vignesh T.V** — <https://github.com/tvvignesh>

**Note**: this plugin is open source under MIT. The `@vibecontrols/agent` runtime that loads and orchestrates plugins is **closed source** and proprietary to Burdenoff Consultancy Services Pvt. Ltd. If you want a fully self-hostable agent, please open an issue or contact the maintainer.

<!-- VIBECONTROLS_OSS_FOOTER_END -->
