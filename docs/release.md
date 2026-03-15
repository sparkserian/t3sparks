# Release Checklist

This repo now uses a minimal desktop release flow:

- macOS `arm64` DMG
- Windows `x64` installer
- one GitHub Release per version tag

It does not publish the CLI to npm.
It does not build Linux artifacts.
It does not auto-commit version bumps back to `main`.

## What the workflow does

- Trigger: `workflow_dispatch`
- Runs:
  - lint
  - typecheck
- Builds:
  - macOS `arm64` DMG
  - Windows `x64` NSIS installer
- Publishes one GitHub Release with the produced files
- Includes updater metadata such as `*.blockmap`, `latest.yml`, and the macOS `.zip`

Workflow file:

- [release.yml](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3sparks/.github/workflows/release.yml)

## GitHub setup

Set these in your local runtime environment when you want desktop update checks to target your repo:

```env
T3SPARKS_DESKTOP_UPDATE_REPOSITORY=owner/repo
T3SPARKS_DESKTOP_UPDATE_GITHUB_TOKEN=your_token
GH_TOKEN=your_token
```

Your local [`.env.local`](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3sparks/.env.local) is ignored by git.

## Release steps

Use these commands:

```bash
npm version patch
npm run publish:mac-arm64
npm run publish:win
```

What each one does:

- `npm version patch`
  - bumps the root version
  - syncs:
    - [apps/desktop/package.json](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3sparks/apps/desktop/package.json)
    - [apps/server/package.json](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3sparks/apps/server/package.json)
    - [apps/web/package.json](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3sparks/apps/web/package.json)
    - [packages/contracts/package.json](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3sparks/packages/contracts/package.json)
  - creates the release commit and local git tag

- `npm run publish:mac-arm64`
  - pushes `main`
  - pushes the version tag
  - starts the GitHub Actions release workflow for macOS ARM64
  - waits for it to finish
  - uploads the macOS release assets to GitHub Releases

- `npm run publish:win`
  - starts the same workflow for Windows
  - waits for it to finish
  - uploads the Windows release assets to the same GitHub Release

## Notes

- Run `npm version patch` from a clean git working tree.
- `publish:mac-arm64` and `publish:win` require:
  - `gh` installed
  - GitHub CLI authenticated, or `GH_TOKEN` available from [`.env.local`](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3sparks/.env.local)
- The scripts use [release.yml](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3sparks/.github/workflows/release.yml) under the hood.

## Optional manual trigger

You can still run the workflow from the GitHub Actions UI and choose:

```text
version: 0.0.6
platform: mac-arm64 or win
```

## Optional signing

If you later want signed builds, the workflow still supports:

- macOS signing and notarization through Apple secrets
- Windows signing through Azure Trusted Signing secrets

If those secrets are missing, the workflow builds unsigned artifacts instead.
