import { ThreadId, type ContextMenuItem } from "@t3sparks/contracts";
import {
  Outlet,
  createRootRouteWithContext,
  type ErrorComponentProps,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";

import { APP_DISPLAY_NAME } from "../branding";
import { Button } from "../components/ui/button";
import {
  AnchoredToastProvider,
  ToastProvider,
  toastManager,
} from "../components/ui/toast";
import {
  serverConfigQueryOptions,
  serverQueryKeys,
} from "../lib/serverReactQuery";
import {
  openResolvedLinkTarget,
  resolveLinkTarget,
  stripPathLineColumnSuffix,
  type ResolvedLinkTarget,
} from "../linkTargets";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
import { useDesktopUpdateNotifications } from "../hooks/useDesktopUpdateNotifications";
import { useTerminalStateStore } from "../terminalStateStore";
import { preferredTerminalEditor } from "../terminal-links";
import { terminalRunningSubprocessFromEvent } from "../terminalActivity";
import { onServerConfigUpdated, onServerWelcome } from "../wsNativeApi";
import { providerQueryKeys } from "../lib/providerReactQuery";
import { collectActiveTerminalThreadIds } from "../lib/terminalStateCleanup";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
  }),
});

function RootRouteView() {
  useDesktopUpdateNotifications();

  if (!readNativeApi()) {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Connecting to {APP_DISPLAY_NAME} server...
          </p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <EventRouter />
        <GlobalLinkHandlers />
        <DesktopProjectBootstrap />
        <Outlet />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function RootRouteErrorView({ error, reset }: ErrorComponentProps) {
  const message = errorMessage(error);
  const details = errorDetails(error);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-red-500)_16%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Something went wrong.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Reload app
          </Button>
        </div>

        <details className="group mt-5 overflow-hidden rounded-lg border border-border/70 bg-background/55">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="group-open:hidden">Show error details</span>
            <span className="hidden group-open:inline">Hide error details</span>
          </summary>
          <pre className="max-h-56 overflow-auto border-t border-border/70 bg-background/80 px-3 py-2 text-xs text-foreground/85">
            {details}
          </pre>
        </details>
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "An unexpected router error occurred.";
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "No additional error details are available.";
  }
}

function EventRouter() {
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const setProjectExpanded = useStore((store) => store.setProjectExpanded);
  const removeOrphanedTerminalStates = useTerminalStateStore(
    (store) => store.removeOrphanedTerminalStates,
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const pathnameRef = useRef(pathname);
  const lastConfigIssuesSignatureRef = useRef<string | null>(null);
  const lastProviderStatusesSignatureRef = useRef<string | null>(null);
  const handledBootstrapThreadIdRef = useRef<string | null>(null);

  pathnameRef.current = pathname;

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    let disposed = false;
    let latestSequence = 0;
    let syncing = false;
    let pending = false;

    const flushSnapshotSync = async (): Promise<void> => {
      const snapshot = await api.orchestration.getSnapshot();
      if (disposed) return;
      latestSequence = Math.max(latestSequence, snapshot.snapshotSequence);
      syncServerReadModel(snapshot);
      const draftThreadIds = Object.keys(
        useComposerDraftStore.getState().draftThreadsByThreadId,
      ) as ThreadId[];
      const activeThreadIds = collectActiveTerminalThreadIds({
        snapshotThreads: snapshot.threads,
        draftThreadIds,
      });
      removeOrphanedTerminalStates(activeThreadIds);
      if (pending) {
        pending = false;
        await flushSnapshotSync();
      }
    };

    const syncSnapshot = async () => {
      if (syncing) {
        pending = true;
        return;
      }
      syncing = true;
      pending = false;
      try {
        await flushSnapshotSync();
      } catch {
        // Keep prior state and wait for next domain event to trigger a resync.
      }
      syncing = false;
    };

    void syncSnapshot().catch(() => undefined);

    const unsubDomainEvent = api.orchestration.onDomainEvent((event) => {
      if (event.sequence <= latestSequence) {
        return;
      }
      latestSequence = event.sequence;
      if (
        event.type === "thread.turn-diff-completed" ||
        event.type === "thread.reverted"
      ) {
        void queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
      }
      void syncSnapshot();
    });
    const unsubTerminalEvent = api.terminal.onEvent((event) => {
      const hasRunningSubprocess = terminalRunningSubprocessFromEvent(event);
      if (hasRunningSubprocess === null) {
        return;
      }
      useTerminalStateStore
        .getState()
        .setTerminalActivity(
          ThreadId.makeUnsafe(event.threadId),
          event.terminalId,
          hasRunningSubprocess,
        );
    });
    const unsubWelcome = onServerWelcome((payload) => {
      void (async () => {
        await syncSnapshot();
        if (disposed) {
          return;
        }

        if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) {
          return;
        }
        setProjectExpanded(payload.bootstrapProjectId, true);

        if (pathnameRef.current !== "/") {
          return;
        }
        if (handledBootstrapThreadIdRef.current === payload.bootstrapThreadId) {
          return;
        }
        await navigate({
          to: "/$threadId",
          params: { threadId: payload.bootstrapThreadId },
          replace: true,
        });
        handledBootstrapThreadIdRef.current = payload.bootstrapThreadId;
      })().catch(() => undefined);
    });
    const unsubServerConfigUpdated = onServerConfigUpdated((payload) => {
      const issuesSignature = JSON.stringify(payload.issues);
      const providerSignature = JSON.stringify(payload.providers);
      const issuesChanged = lastConfigIssuesSignatureRef.current !== issuesSignature;
      const providersChanged = lastProviderStatusesSignatureRef.current !== providerSignature;
      lastConfigIssuesSignatureRef.current = issuesSignature;
      lastProviderStatusesSignatureRef.current = providerSignature;

      if (!issuesChanged && !providersChanged) {
        return;
      }

      void queryClient.invalidateQueries({
        queryKey: serverQueryKeys.config(),
      });
      if (!issuesChanged) {
        return;
      }
      const issue = payload.issues.find((entry) =>
        entry.kind.startsWith("keybindings."),
      );
      if (!issue) {
        toastManager.add({
          type: "success",
          title: "Keybindings updated",
          description: "Keybindings configuration reloaded successfully.",
        });
        return;
      }

      toastManager.add({
        type: "warning",
        title: "Invalid keybindings configuration",
        description: issue.message,
        actionProps: {
          children: "Open keybindings.json",
          onClick: () => {
            void queryClient
              .ensureQueryData(serverConfigQueryOptions())
              .then((config) =>
                api.shell.openInEditor(
                  config.keybindingsConfigPath,
                  preferredTerminalEditor(),
                ),
              )
              .catch((error) => {
                toastManager.add({
                  type: "error",
                  title: "Unable to open keybindings file",
                  description:
                    error instanceof Error
                      ? error.message
                      : "Unknown error opening file.",
                });
              });
          },
        },
      });
    });
    return () => {
      disposed = true;
      unsubDomainEvent();
      unsubTerminalEvent();
      unsubWelcome();
      unsubServerConfigUpdated();
    };
  }, [
    navigate,
    queryClient,
    removeOrphanedTerminalStates,
    setProjectExpanded,
    syncServerReadModel,
  ]);

  return null;
}

type GlobalLinkMenuAction = "open" | "reveal" | "copy-link" | "copy-selection";

function findClosestAnchor(
  target: EventTarget | null,
): HTMLAnchorElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const anchor = target.closest("a[href]");
  return anchor instanceof HTMLAnchorElement ? anchor : null;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    navigator.clipboard?.writeText === undefined
  ) {
    throw new Error("Clipboard API unavailable.");
  }
  await navigator.clipboard.writeText(text);
}

function buildGlobalLinkMenuItems(
  target: ResolvedLinkTarget,
  hasSelection: boolean,
): ReadonlyArray<ContextMenuItem<GlobalLinkMenuAction>> {
  const openLabel =
    target.kind === "external"
      ? "Open Link"
      : target.kind === "internal"
        ? "Open"
        : target.path === stripPathLineColumnSuffix(target.path)
          ? "Open Path"
          : "Open in Editor";

  const items: ContextMenuItem<GlobalLinkMenuAction>[] = [
    {
      id: "open",
      label: openLabel,
    },
  ];

  if (target.kind === "path") {
    items.push({ id: "reveal", label: "Reveal in Folder" });
  }

  items.push({
    id: "copy-link",
    label: target.kind === "path" ? "Copy Path" : "Copy Link",
  });

  if (hasSelection) {
    items.push({ id: "copy-selection", label: "Copy Selection" });
  }

  return items;
}

function GlobalLinkHandlers() {
  const navigate = useNavigate();

  useEffect(() => {
    const api = readNativeApi();
    if (!api) {
      return;
    }

    const openTarget = async (target: ResolvedLinkTarget): Promise<void> => {
      if (target.kind === "internal") {
        await navigate({ to: target.href });
        return;
      }

      await openResolvedLinkTarget(api, target);
    };

    const handleLinkError = (error: unknown, title: string) => {
      toastManager.add({
        type: "error",
        title,
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred.",
      });
    };

    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }

      const anchor = findClosestAnchor(event.target);
      if (!anchor || anchor.hasAttribute("download")) {
        return;
      }

      const target = resolveLinkTarget(
        anchor.getAttribute("href") ?? undefined,
        anchor.dataset.t3sparksCwd,
      );
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void openTarget(target).catch((error) => {
        handleLinkError(
          error,
          target.kind === "external"
            ? "Unable to open link"
            : "Unable to open path",
        );
      });
    };

    const onDocumentContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const anchor = findClosestAnchor(event.target);
      if (!anchor) {
        return;
      }

      const target = resolveLinkTarget(
        anchor.getAttribute("href") ?? undefined,
        anchor.dataset.t3sparksCwd,
      );
      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const selectionText = window.getSelection()?.toString().trim() ?? "";
      const menuItems = buildGlobalLinkMenuItems(
        target,
        selectionText.length > 0,
      );
      void api.contextMenu
        .show(menuItems, { x: event.clientX, y: event.clientY })
        .then((action) => {
          if (!action) {
            return;
          }

          if (action === "open") {
            return openTarget(target).catch((error) => {
              handleLinkError(
                error,
                target.kind === "external"
                  ? "Unable to open link"
                  : "Unable to open path",
              );
            });
          }

          if (action === "reveal" && target.kind === "path") {
            return api.shell
              .showItemInFolder(stripPathLineColumnSuffix(target.path))
              .catch((error) => {
                handleLinkError(error, "Unable to reveal path");
              });
          }

          if (action === "copy-selection") {
            return copyTextToClipboard(selectionText).catch((error) => {
              handleLinkError(error, "Unable to copy selection");
            });
          }

          if (action === "copy-link") {
            const value = target.kind === "path" ? target.path : target.href;
            return copyTextToClipboard(value).catch((error) => {
              handleLinkError(
                error,
                target.kind === "path"
                  ? "Unable to copy path"
                  : "Unable to copy link",
              );
            });
          }
        })
        .catch(() => undefined);
    };

    document.addEventListener("click", onDocumentClick);
    document.addEventListener("contextmenu", onDocumentContextMenu);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("contextmenu", onDocumentContextMenu);
    };
  }, [navigate]);

  return null;
}

function DesktopProjectBootstrap() {
  // Desktop hydration runs through EventRouter project + orchestration sync.
  return null;
}
