# T3 Sparks ↔ Upstream Sync Workflow

T3 Sparks is a fork of [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) (now published as `@t3tools/monorepo`). We want to:

1. Stay current with upstream.
2. Carry a small, well-defined set of T3 Sparks-only features.
3. Resolve merge conflicts deterministically (including agent-driven resolution).

To make all three possible at once, this fork uses a **two-branch model**.

## Branches

| Branch                                                        | Role                                                                                             | Update rule                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `main`                                                        | Clean mirror of `upstream/main`. Never carries T3 Sparks-only commits.                           | Only moves via `git merge --ff-only upstream/main`. |
| `features/t3sparks`                                           | Long-lived branch carrying all T3 Sparks additions on top of `main`. Releases are cut from here. | **Rebased** onto `main` after every upstream sync.  |
| `backup/pre-resync-<date>` / `backup/pre-resync-<date>-stash` | Safety snapshots taken before destructive operations.                                            | Never deleted.                                      |

### Why this shape?

- Keeping `main` pristine makes `git log main..features/t3sparks` the exact authoritative delta we own.
- Rebasing (instead of merging) keeps that delta linear and small, so conflict resolution is per-upstream-change rather than compounding.
- An agent (or a human) resolving conflicts only ever has to reason about one feature commit at a time.

## Remotes

```bash
git remote -v
# origin    https://github.com/sparkserian/t3sparks.git (fetch/push)
# upstream  https://github.com/pingdotgg/t3code.git (fetch/push)
```

If `upstream` is missing:

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
```

## Pulling upstream

```bash
git fetch upstream
git checkout main
git merge --ff-only upstream/main     # will fail loudly if main ever drifts — that's the point
git push origin main
```

Then replay features on the new base:

```bash
git checkout features/t3sparks
git fetch origin
git rebase main
# resolve conflicts if any (see below), then:
bun install
bun lint
bun typecheck
bun run test
git push --force-with-lease origin features/t3sparks
```

Note: **never** run `bun test` directly — it must be `bun run test` (Vitest). See `AGENTS.md`.

## Conflict resolution (agent-friendly)

Every feature commit on `features/t3sparks` should:

- Touch as few files as possible.
- Have a commit message of the form `feat(t3sparks): <feature-name> — <what it does>`.
- Include a short "reference" line pointing to the snapshot at
  `/Users/williamawuku/Downloads/my-dev-projects/t3 experiments` when the feature was originally implemented there.

When a rebase conflict happens, the resolver (human or agent) should:

1. Read the offending feature commit message to understand intent.
2. Open the reference snapshot for the affected files as a ground-truth implementation.
3. Re-apply the feature onto the new upstream code, preserving _intent_, not byte-for-byte diffs. Upstream may have refactored the surrounding code; follow upstream's new shape.
4. Re-run lint / typecheck / test before continuing the rebase.

If a feature commit needs a significant rewrite to fit new upstream code, amend it in place (`git commit --amend` or `git rebase -i`) — don't add a "fixup" commit on top. The goal is always: one clean commit per feature.

## Releases

Releases (desktop builds + update feed) are cut from **`features/t3sparks`**, never from `main`. Tag names follow upstream's `v<x>.<y>.<z>` scheme with a `-sparks` suffix to avoid colliding with upstream tags:

```bash
git checkout features/t3sparks
git tag v0.0.22-sparks.1
git push origin v0.0.22-sparks.1
```

CI workflows in `.github/workflows/release.yml` are configured to trigger on `v*-sparks.*` tag pushes.

## Current T3 Sparks-only features

Tracked in commits on `features/t3sparks` (see `git log main..features/t3sparks`). Intended set:

- GitHub Copilot CLI provider (extends `ProviderKind`).
- Project Notes (top bar).
- Terminal drawer toggle (top bar).
- Custom Instructions (composer).
- Convex controls (composer).
- Desktop self-update UI + IPC.
- Linux release support + publish script.
- Branding strings (product name, app id, update feed).

Internal workspace package names (`@t3tools/*`) are deliberately **not** renamed — preserving them minimizes merge churn against upstream.

## Recovering from a bad sync

```bash
# List safety points:
git ls-remote origin 'refs/tags/backup/*'

# Restore features/t3sparks to a known-good snapshot:
git checkout -B features/t3sparks backup/pre-resync-<date>
git push --force-with-lease origin features/t3sparks
```
