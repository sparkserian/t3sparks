# Release Checklist

This repo now supports the same command flow you described:

- `npm version patch`
- `git push origin main --follow-tags`
- `npm run publish:mac-arm64`
- `npm run publish:win`
- optional: `npm run publish:linux`

Each `publish:*` script uploads to the same GitHub Release for the current version.

How the publish step runs:

- native target on the matching OS: builds locally with `electron-builder` and uploads directly
- non-native target from the wrong OS: pushes the tag and uses GitHub Actions on the correct runner

This is necessary because the packaged app includes native modules such as `node-pty`, and `node-gyp` cannot cross-compile them from macOS to Windows or Linux.

## GitHub setup

Put these in [`.env.local`](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3code/.env.local):

```env
GH_RELEASE_OWNER=owner
GH_RELEASE_REPO=repo
GH_TOKEN=your_token
```

Optional compatibility vars are also supported:

```env
T3SPARKS_DESKTOP_UPDATE_REPOSITORY=owner/repo
T3SPARKS_DESKTOP_UPDATE_GITHUB_TOKEN=your_token
```

Your local [`.env.local`](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3code/.env.local) is ignored by git.

## Release steps

Use these commands:

```bash
npm version patch
git push origin main --follow-tags
npm run publish:mac-arm64
npm run publish:win
npm run publish:linux
```

What each one does:

- `npm version patch`
  - bumps the root version
  - syncs:
    - [apps/desktop/package.json](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3code/apps/desktop/package.json)
    - [apps/server/package.json](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3code/apps/server/package.json)
    - [apps/web/package.json](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3code/apps/web/package.json)
    - [packages/contracts/package.json](/Users/williamawuku/Downloads/Emerald%20Chain%20Hub/t3code/packages/contracts/package.json)
  - creates the release commit and local git tag

- `git push origin main --follow-tags`
  - pushes the release commit
  - pushes the matching version tag like `v0.0.9`

- `npm run publish:mac-arm64`
  - on Apple Silicon Mac: builds locally, packages macOS `dmg` and `zip`, and uploads them
  - on other hosts: falls back to GitHub Actions on macOS

- `npm run publish:win`
  - on Windows: builds locally, packages Windows `nsis`, and uploads it
  - on macOS/Linux: falls back to GitHub Actions on Windows

- `npm run publish:linux`
  - on Linux: builds locally, packages Linux `AppImage`, `deb`, and `rpm`, and uploads them
  - on macOS/Windows: falls back to GitHub Actions on Linux

## Notes

- Run `npm version patch` from a clean git working tree.
- Do not bump the version again between Mac and Windows.
- macOS auto-update needs both the `dmg` and the `zip`.
- Windows auto-update uses the `nsis` target.
- Linux releases publish `AppImage`, `deb`, and `rpm`.
- Linux auto-update still expects the `AppImage` build.
- `publish:*` requires `GH_TOKEN` with release upload access.
- Publish macOS from a Mac for the fastest path.
- Publish Windows from Windows or let the script fall back to CI.
- Publish Linux from Linux or let the script fall back to CI.

## Optional signing

If you later want signed builds, the desktop builder still supports:

- macOS signing and notarization through Apple secrets
- Windows signing through Azure Trusted Signing secrets

If those secrets are missing, the local publish builds unsigned artifacts instead.
