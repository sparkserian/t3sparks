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

## Already present upstream (no port required)

4. **Terminal drawer.** `apps/web/src/components/ThreadTerminalDrawer.tsx`
   already exists in upstream and is larger (1353 LOC) than the snapshot
   reference (968 LOC). Upstream version is authoritative.
6. **Desktop self-update.** `apps/desktop/src/updateMachine.ts`,
   `updateState.ts`, `updateChannels.ts` + `apps/web/src/components/desktopUpdate.logic.ts`
   + `apps/web/src/lib/desktopUpdateReactQuery.ts` all present upstream.
8. **Release scripts & multi-platform.** `.github/workflows/release.yml`
   already builds mac / linux / win via matrix.

## Deferred (need dedicated sessions)

5. **Convex controls.** Requires backend nativeApi integration: Convex
   status queries (`convexStatusQueryOptions`), React Query cache
   (`convexQueryKeys`), terminal event protocol wiring, and per-thread
   terminal id allocation. The snapshot version depends on a `readNativeApi`
   surface that has drifted heavily in current upstream. Needs a dedicated
   port session that:
   - Adds Convex status detection to `apps/server/src/environment/*` or
     native api.
   - Adds `apps/web/src/lib/convexReactQuery.ts` tanstack-query helpers.
   - Ports `apps/web/src/convexWorkflow.ts` + tests.
   - Ports `apps/web/src/components/ConvexControl.tsx` and wires into the
     composer footer next to `CustomInstructionsControl`.

7. **GitHub Copilot CLI provider.** This is the largest port (~1400 LOC of
   server-side adapter code). Needs a dedicated session to avoid a half-done
   provider that breaks builds. Plan:
   - `packages/contracts`: extend `ProviderKind` with `"copilotCli"`, add
     `CopilotModelSelection`, update `ModelSelection` union, add Copilot
     entries to `server settings patches` / runtime config.
   - `apps/server/src/provider/Layers/copilotBinary.ts`: port binary
     discovery + version probing.
   - `apps/server/src/provider/Layers/copilotAdapter.logic.ts`: port event
     parsing / state reducer.
   - `apps/server/src/provider/Layers/CopilotAdapter.ts`: adapt to current
     upstream `ProviderAdapter`/`ProviderCommandReactor` Effect APIs. The
     snapshot's version (1253 LOC) predates the current Effect-based layer
     model so significant rewrite is expected — do not copy verbatim.
   - Register the adapter in `ProviderAdapterRegistry`.
   - `apps/web/src/components/copilotProviderStatus.ts`: port status logic.
   - Add Copilot to model picker / provider switcher / default model
     configuration.
   - Full e2e smoke test (login flow, streaming turn, interruption).

## Sync playbook

See `sync-workflow.md`. After each upstream pull:
1. `git fetch upstream && git checkout main && git merge --ff-only upstream/main && git push origin main`
2. `git checkout features/t3sparks && git rebase main`
3. Resolve conflicts feature-by-feature; lint + typecheck + test.
4. `git push --force-with-lease origin features/t3sparks`.
