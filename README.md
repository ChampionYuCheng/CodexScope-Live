# CodexScope Live

English | [简体中文](README.zh-CN.md)

[![LINUX DO](https://img.shields.io/badge/LINUX-DO-FFB003?style=flat-square)](https://linux.do)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

CodexScope Live is a local-first dashboard for understanding Codex usage from local session logs. It turns token usage, quota status, model mix, session activity, request distribution, cache hits, and estimated cost into a desktop-friendly view.

![CodexScope Live dashboard](assets/codexscope-dashboard-24h.png)

## Attribution

This repository is a local derivative and personal adaptation of the open-source **CodexScope** project. The original project was created and published by **[JUk1-GH](https://github.com/JUk1-GH)**.

- Original repository: [JUk1-GH/CodexScope](https://github.com/JUk1-GH/CodexScope)
- Original license: [MIT](LICENSE)

The original attribution and license are retained. This repository is an independent personal version and is not the upstream project.

## What it does

CodexScope Live reads the usage metadata already present in local Codex JSONL session logs. It does not connect to a Codex account, upload prompts, or run a hosted backend.

The project has two modes:

| Mode | Best for | How it works |
| --- | --- | --- |
| Static preview | Quickly viewing the interface | Open `index.html`; bundled sample data is used when no local export exists. |
| Local live dashboard | Watching local usage while Codex is running | A small Rust server serves the page, watches the session directory, regenerates local exports, and sends refresh events through Server-Sent Events (SSE). |

## Features

- Cumulative input, cached, output, and reasoning token trends
- Absolute and logarithmic chart views
- Presets for the last 24 hours, today, 7 days, 30 days, and all history
- Custom date ranges backed by the raw local event catalog
- Request and token distribution charts
- Quota and risk status from local `rate_limits` events when available
- Session and model rankings with local search filters
- Estimated cost by model and token type, with USD and optional CNY display
- Live refresh toggle, connection status, manual refresh, and scroll-position recovery
- Local-only data generation from `~/.codex/sessions`
- Responsive desktop-focused interface with no hosted telemetry

## Quick start

### Preview the dashboard

No toolchain is required to preview the bundled sample data:

1. Download or clone this repository.
2. Open `index.html` in a browser.

When opened with `file://`, the page works as a static preview. Live refresh is unavailable in this mode.

### Run the live dashboard on Windows

The Windows launcher starts the local Rust server at `http://127.0.0.1:4173/`:

~~~text
windows/open-dashboard.cmd
~~~

Double-click the script, or run it from a terminal. The launcher uses a local `codexscope-live.exe` when one is available. Otherwise, it falls back to `cargo run`.

For a source checkout, install:

- Rust and Cargo, for the local live server
- Go, unless a prebuilt Go data generator is available

The Rust server polls the local Codex session directory, whose default location is:

- macOS/Linux: `~/.codex/sessions`
- Windows: `%USERPROFILE%/.codex/sessions`

When a JSONL session changes, the server invokes the existing Go generator and sends an SSE event to connected browsers. Enable live mode in the dashboard to reload the data automatically.

### Run the live server manually

From the repository root:

~~~powershell
cargo run --manifest-path ./live-server/Cargo.toml -- --root . --port 4173
~~~

Useful options:

~~~text
--root <path>          Dashboard root directory; defaults to the current directory
--sessions <path>      Codex session directory; defaults to the platform home directory
--generator <path>     Explicit path to a prebuilt data generator
--port <number>        Local HTTP port; defaults to 4173
--interval-ms <number> Polling interval; defaults to 1000 ms
~~~

If neither a prebuilt generator nor Go is available, the server can still serve the dashboard, but it cannot create fresh local exports.

## Generate local data manually

The Go generator reads local session logs and writes the browser data files next to `index.html`:

~~~powershell
go run ./generate_codex_data.go --root "$env:USERPROFILE/.codex/sessions"
~~~

On macOS or Linux:

~~~bash
go run ./generate_codex_data.go --root "$HOME/.codex/sessions"
~~~

The generated files are:

- `data.js`: precomputed dashboard views for common date ranges
- `data.raw.js`: compact catalogs and raw event rows used for custom ranges
- `.codexscope-cache.json`: incremental parsing cache

These files can contain private project names, session IDs, timestamps, usage patterns, and quota metadata. They are ignored by `.gitignore`; review them before sharing any export or screenshot.

## Development

### Requirements

- Node.js and npm, for the frontend build and visual verification
- Rust and Cargo, for the live server
- Go, for local data generation and release generator builds
- Playwright, installed by `npm install`, for responsive verification

### Install and verify

~~~bash
npm install
npm run build:frontend
npm run check:live
npm run verify
~~~

Build the Rust live server binary with:

~~~bash
npm run build:live
~~~

The release binary is written to `live-server/target/release/`. On Windows, the launcher also looks for `codexscope-live.exe` in the repository root or in that release directory.

The existing release script builds the platform packages and precompiled Go generator:

~~~bash
npm run release:local
~~~

The current release script does not bundle the Rust live server. Use the source-checkout instructions above for the live dashboard, or extend the release packaging step before distributing a live-enabled package.

## Data flow

1. Codex writes local JSONL session logs under the platform-specific session directory.
2. `generate_codex_data.go` extracts usage metadata such as token counts, model names, session IDs, timing, failures, and rate-limit metadata.
3. The generator writes precomputed views to `data.js` and compact raw data to `data.raw.js`.
4. The browser loads sample data first, then overrides it with local exports when those files exist.
5. In live mode, the Rust server detects changed JSONL files, regenerates the export, and notifies the browser through SSE.
6. Charts, filters, rankings, quota status, and cost estimates are calculated in the browser.

The generator does not export prompt text, assistant messages, tool output, or file contents.

## Cost estimates

The cost card is an estimate, not an official bill. It uses local token counts and model-pricing rules exported by the generator. USD is the source currency; CNY is a display conversion only.

When available, the dashboard retrieves the USD/CNY rate from the Frankfurter API using the ECB provider. If the request fails, it uses a bundled reference rate and marks the conversion as an offline fallback. Actual ChatGPT or Codex billing, credits, and quota status should be checked through the official account or billing page.

## Project structure

- `index.html`: dashboard shell and controls
- `styles.css`: layout and visual styling
- `app.ts`: TypeScript source for charts, filters, rankings, quota display, and cost estimates
- `app.js`: compiled browser script
- `live.js`: browser-side SSE client and live-refresh controls
- `live-server/`: Rust local server for static files, session monitoring, and SSE notifications
- `generate_codex_data.go`: local usage-data generator
- `data.sample.js`: bundled sample data
- `macos/open-dashboard.command`: macOS data-generation launcher
- `windows/open-dashboard.cmd`: Windows live-server launcher
- `scripts/build-release.sh`: platform release-package builder
- `verify_responsive.js`: Playwright layout and interaction audit
- `assets/`: screenshots and static assets

## Limitations

- Live monitoring is local polling, not a Codex API stream; the default interval is 1 second.
- Live mode requires the Rust server and a usable Go generator or prebuilt generator.
- Quota and risk information is only available when the local session logs contain the relevant `rate_limits` metadata.
- Cost values are estimates and should not be treated as billing records.
- The server binds to loopback (`127.0.0.1`) and is intended for local use only.

## License

MIT. See [LICENSE](LICENSE).
