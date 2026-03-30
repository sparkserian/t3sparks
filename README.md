# T3 Sparks

T3 Sparks is a desktop-first coding workspace for CLI agents. It wraps local agent runtimes in a persistent project/thread UI, adds desktop packaging and auto-updates, and layers in workflow features that are not present in the upstream fork.

This fork currently supports:

- Codex
- Claude Code
- Gemini CLI
- Desktop releases for macOS arm64, Windows x64, and Linux x64 AppImage
- Project onboarding and a configurable project home
- Custom instructions, custom model slugs, and service-tier preferences
- Archived threads and archived-thread management
- Local backup/export and restore
- Desktop auto-update checks against GitHub Releases
- Convex helper/status integration

## Install

The easiest path is the packaged desktop app:

- Releases: https://github.com/sparkserian/t3sparks/releases

Packaged builds are published for:

- macOS arm64
- Windows x64
- Linux x64 AppImage

If you are using the desktop app, you still need to install and authenticate the agent CLI you want to use locally.

## Provider Support

T3 Sparks runs local provider tooling on your machine. Install whichever providers you plan to use:

- Codex CLI
- Claude Code / Claude agent tooling
- Gemini CLI

The app surfaces provider availability in its runtime config and settings UI, and preserves provider-specific session state per thread.

## What The App Does

T3 Sparks is organized around projects and threads:

- A project maps to a local working directory.
- A thread keeps conversation history, provider session state, diffs, and metadata.
- Threads can be archived without deleting them.
- Projects remain visible even when their active thread list changes.

Key workflow features currently in this fork:

- Desktop shell integration for opening links, files, folders, and revealing items in Finder/Explorer/file manager
- Native context menus for thread/project actions plus desktop text/link context menus
- Project home onboarding for first-run setup
- Custom instructions stored in app settings
- Archived thread restore/delete controls from Settings
- Timestamp format preferences for chat, plan, and diff timestamps
- Backup export and restore for projects, threads, messages, and app settings
- Convex status helpers for Convex-based projects
- Git worktree and stacked-action support already used elsewhere in the app

## Settings

The Settings screen currently includes:

- Appearance theme
- Time format preference
- Codex binary/home path settings
- Custom model lists for supported providers
- Assistant streaming toggle
- Model-switch summary toggle
- Delete confirmation behavior
- Archived thread management
- Backup export and restore

The desktop build also exposes:

- Keybindings file opening
- App update status, download progress, and restart/install actions

## Auto Updates

Packaged production desktop builds check GitHub Releases for updates.

Current updater behavior:

- Checks happen after startup and on a background poll interval
- When a newer release is found, the app starts downloading it in the background
- When the download completes, the app prompts the user to restart and install
- Retry flows remain available for failed downloads or failed installs

Platform notes:

- macOS uses the generated `latest-mac.yml`
- Windows uses `latest.yml`
- Linux uses `latest-linux.yml`
- Linux auto-updates require running the AppImage build
- Development mode and unpackaged runs do not use the auto-updater

## Development

### Requirements

- Bun `^1.3.9`
- Node `^24.13.1`

### Workspace Layout

- `apps/web`: React/TanStack desktop UI
- `apps/server`: local backend, provider orchestration, git/project helpers
- `apps/desktop`: Electron shell, desktop bridge, updater, packaging entrypoints
- `apps/marketing`: marketing site
- `packages/contracts`: shared schemas, IPC, websocket, and orchestration contracts
- `packages/shared`: shared utilities/services

### Common Commands

```bash
bun install
bun run dev
```

Useful variants:

```bash
bun run dev:desktop
bun run dev:web
bun run dev:server
bun run build
bun run typecheck
bun run test
```

Desktop packaging:

```bash
bun run dist:desktop:dmg:arm64
bun run dist:desktop:win
bun run dist:desktop:linux
```

Release helpers:

```bash
bun run publish:mac-arm64
bun run publish:win
bun run publish:linux
```

## Building Releases

Desktop release publishing uses:

- `scripts/build-desktop-artifact.ts` for artifact packaging
- `scripts/publish-release.mjs` for local/Actions release orchestration
- `.github/workflows/release.yml` for Windows/Linux CI publishing

GitHub release publishing expects credentials/config in `.env.local`, including the GitHub repository target and token used for release uploads.

## Notes

- This project is evolving quickly and packaged releases may change frequently.
- The upstream repository is `pingdotgg/t3code`, but this fork has substantial desktop, provider, onboarding, backup, and workflow changes on top.
- If you need support or want to track releases, use the GitHub repository and release page linked above.
