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
4. **Convex controls.** Full stack port:
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

5. **GitHub Copilot CLI provider (scaffold).** Provider discovery,
   contracts, and UI wiring shipped; ACP streaming runtime deferred.
   - `packages/contracts`: widened `ProviderKind` with `"githubCopilot"`;
     added `GithubCopilotModelSelection`, `GithubCopilotSettings`
     (enabled/binaryPath/customModels) + patch, plumbed into
     `ServerSettings.providers` + `ModelSelectionPatch`;
     `DEFAULT_MODEL_BY_PROVIDER.githubCopilot = "auto"`,
     `PROVIDER_DISPLAY_NAMES.githubCopilot = "GitHub Copilot"`.
   - `apps/server`:
     `provider/Services/GithubCopilot{Provider,Adapter}.ts` service tags;
     `provider/Layers/GithubCopilotProvider.ts` — settings-driven snapshot
     layer (enabled / disabled / configured) using `makeManagedServerProvider`;
     `provider/Layers/GithubCopilotAdapter.ts` — scaffold adapter whose
     runtime paths (`startSession`, `sendTurn`, `respondToRequest`,
     `respondToUserInput`, `interruptTurn`) return `ProviderAdapterRequestError`
     with a clear "not yet ported" detail while `stopSession`,
     `listSessions`, `hasSession`, `readThread`, and `rollbackThread` behave
     as a no-session adapter; wired into `builtInProviderCatalog.ts`,
     `ProviderRegistry.ts`, `ProviderAdapterRegistry.ts`,
     `RoutingTextGeneration.ts` (Copilot text-gen fallbacks to Codex),
     `providerStatusCache.ts`, `serverSettings.ts PROVIDER_ORDER`, and
     `server.ts` runtime layer composition.
   - `apps/web`: exhaustive switches updated in `modelSelection.ts`,
     `providerIconUtils.ts`, `ChatComposer.tsx`, `ProviderModelPicker.browser.tsx`,
     `KeybindingsToast.browser.tsx`, and `SettingsPanels.tsx`.
   - Follow-up session: port ACP runtime (model after `CursorAdapter.ts` +
     `CursorAcpSupport.ts`, swap `buildCursorAcpSpawnInput` for
     `copilot --acp --stdio` and Copilot's auth method id); port
     `copilotProviderStatus.ts` status projection; richer binary resolver
     (walk node_modules for `@github/copilot-sdk` platform package).

## Already present upstream (no port required)

4. **Terminal drawer.** `apps/web/src/components/ThreadTerminalDrawer.tsx`
   already exists in upstream and is larger (1353 LOC) than the snapshot
   reference (968 LOC). Upstream version is authoritative.
5. **Desktop self-update.** `apps/desktop/src/updateMachine.ts`,
   `updateState.ts`, `updateChannels.ts` + `apps/web/src/components/desktopUpdate.logic.ts`
   - `apps/web/src/lib/desktopUpdateReactQuery.ts` all present upstream.
6. **Release scripts & multi-platform.** `.github/workflows/release.yml`
   already builds mac / linux / win via matrix.

## Deferred (next session)

7. **GitHub Copilot CLI — ACP streaming runtime.** Scaffold has shipped
   (see #5 above); replace the scaffold adapter runtime with a real ACP
   session implementation. Template: `apps/server/src/provider/Layers/CursorAdapter.ts`
   + `apps/server/src/provider/acp/CursorAcpSupport.ts` — swap spawn command
   to `copilot --acp --stdio`, adapt auth method id, reuse shared ACP
   stream plumbing.

## Sync playbook

See `sync-workflow.md`. After each upstream pull:

1. `git fetch upstream && git checkout main && git merge --ff-only upstream/main && git push origin main`
2. `git checkout features/t3sparks && git rebase main`
3. Resolve conflicts feature-by-feature; lint + typecheck + test.
4. `git push --force-with-lease origin features/t3sparks`.
