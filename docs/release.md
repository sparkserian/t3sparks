# Release Checklist

This repo now supports the same local release flow you described:

- `npm version patch`
- `git push origin main --follow-tags`
- `npm run publish:mac-arm64`
- `npm run publish:win`
- optional: `npm run publish:linux`

Each `publish:*` script builds locally with `electron-builder` and uploads directly to the same GitHub Release for the current version.

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
  - builds the desktop app locally
  - packages macOS `dmg` and `zip`
  - uploads them and the updater metadata to GitHub Releases

- `npm run publish:win`
  - builds the desktop app locally
  - packages Windows `nsis`
  - uploads it and the updater metadata to the same GitHub Release

- `npm run publish:linux`
  - builds the desktop app locally
  - packages Linux `AppImage`
  - uploads it to the same GitHub Release

## Notes

- Run `npm version patch` from a clean git working tree.
- Do not bump the version again between Mac and Windows.
- macOS auto-update needs both the `dmg` and the `zip`.
- Windows auto-update uses the `nsis` target.
- `publish:*` requires `GH_TOKEN` with release upload access.
- Publish macOS from a Mac for the most reliable result.
- Publish Windows from Windows or CI for the most reliable result.

## Optional signing

If you later want signed builds, the desktop builder still supports:

- macOS signing and notarization through Apple secrets
- Windows signing through Azure Trusted Signing secrets

If those secrets are missing, the local publish builds unsigned artifacts instead.
