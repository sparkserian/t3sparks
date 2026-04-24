# T3 Sparks Feature Port — Status

This document tracks the port of features from the pre-fork snapshot
(`t3 experiments`) onto the rebased `features/t3sparks` branch.

## Completed on `features/t3sparks`

1. **Branding (minimal).** User-visible product name → "T3 Sparks".
   Internal `@t3tools/*` workspace names, `com.t3tools.*` bundle IDs, and
   `T3CODE_*` env vars are left untouched to keep upstream merges clean.
   Commit: `65493307`.
2. **Project Notes.** Per-project note sheet, top-bar toggle in `ChatHeader`,
   localStorage-backed via `apps/web/src/projectNotes.ts`. Commit: `56750a64`.
3. **Custom Instructions.** Library CRUD (Dialog) + per-thread selection,
   selected instruction bodies prepended to outgoing user prompt. Stored in
   `ClientSettings.customInstructions` (contracts) + localStorage thread
   selection (`apps/web/src/selectedCustomInstructions.ts`). Commit: `d6dd94bd`.
5. **Convex controls.** Full stack port:
   - `packages/contracts/src/convex.ts` — ConvexStatusInput/Result + error.
   - `WsConvexStatusRpc` registered under `WS_METHODS.convexStatus`; surfaced
     on `EnvironmentApi` as `convex.status`.
   - `apps/server/src/convex/{Services,Layers}/Convex.ts` — detects
     package.json, convex dep, `convex/` dir, `.env.local`, and derives
     package-manager-aware install/dev/deploy commands.
   - `apps/web/src/convexWorkflow.ts` reducer + tests.
   - `apps/web/src/components/ConvexControl.tsx` composer popover wired into
     `ChatComposer`. `ChatView` exposes `focusTerminal` + `runConvexCommand`
     helpers that route actions into the `convex-dev` / `convex-task`
     terminal IDs. Commit: `11ee68ef`.

## Already present upstream (no port required)

4. **Terminal drawer.** `apps/web/src/components/ThreadTerminalDrawer.tsx`
   already exists in upstream and is larger (1353 LOC) than the snapshot
   reference (968 LOC). Upstream version is authoritative.
6. **Desktop self-update.** `apps/desktop/src/updateMachine.ts`,
   `updateState.ts`, `updateChannels.ts` + `apps/web/src/components/desktopUpdate.logic.ts`
   + `apps/web/src/lib/desktopUpdateReactQuery.ts` all present upstream.
8. **Release scripts & multi-platform.** `.github/workflows/release.yml`
   already builds mac / linux / win via matrix.

## Deferred (next session)

7. **GitHub Copilot CLI provider.** The largest port; needs its own session.
   Current upstream has drifted substantially from the snapshot:
   - `ProviderKind` is `"codex" | "claudeAgent" | "cursor" | "opencode"` in
     upstream — the snapshot also has `"githubCopilot"` but all supporting
     infrastructure (model slugs, provider options, adapter registry, model
     picker, provider trait pickers) is new.
   - `packages/shared/src/model.ts` has diverged entirely. Upstream uses
     `ProviderOptionDescriptor`/`ProviderOptionSelection` capability model;
     snapshot uses static `MODEL_OPTIONS_BY_PROVIDER` tables. Copilot helpers
     (`fromGitHubCopilotModelId`, `toGitHubCopilotModelId`,
     `GITHUB_COPILOT_MODEL_PREFIX`) must be re-expressed in the new model.
   - Adapter is 1253 LOC and depends on `@agentclientprotocol/sdk` (new
     dependency not currently in upstream) plus snapshot Effect service tags.
   - Needs full exhaustive-switch audit across ~51 files that reference
     `ProviderKind`, once widened.

   Plan (full session):
   1. Contracts: widen `ProviderKind` with `"githubCopilot"`; add
      `CopilotModelSelection` to `ModelSelection` union; add provider
      options (binaryPath, auth) to `provider.ts`.
   2. Add `@agentclientprotocol/sdk` to `apps/server/package.json`.
   3. Port `packages/shared/src/model.ts` Copilot helpers as additions
      compatible with the current capability model.
   4. Port pure server files: `copilotBinary.ts`, `copilotAdapter.logic.ts`
      (≈320 LOC combined, no Effect layer dependencies).
   5. Port `apps/server/src/provider/Layers/CopilotAdapter.ts` — reshape to
      match current `OpenCodeAdapter.ts` / `CursorAdapter.ts` service tag
      pattern. Most ACP stream handling logic should survive.
   6. Add `CopilotProvider.ts` layer (model after `OpenCodeProvider.ts`).
   7. Register in `ProviderAdapterRegistry.ts`.
   8. Port `apps/web/src/components/copilotProviderStatus.ts` + test.
   9. Extend model picker + provider switcher + `DEFAULT_MODEL_BY_PROVIDER`
      to include Copilot.
   10. Walk every exhaustive `switch (providerKind)` and add the new case.
   11. Typecheck web + server + contracts + desktop; run `bun run test` for
       targeted test files.

## Sync playbook

See `sync-workflow.md`. After each upstream pull:
1. `git fetch upstream && git checkout main && git merge --ff-only upstream/main && git push origin main`
2. `git checkout features/t3sparks && git rebase main`
3. Resolve conflicts feature-by-feature; lint + typecheck + test.
4. `git push --force-with-lease origin features/t3sparks`.
