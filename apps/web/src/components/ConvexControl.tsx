import type { ThreadId } from "@t3sparks/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BoxIcon, ExternalLinkIcon, LoaderCircleIcon, RocketIcon, SquareTerminalIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  beginConvexAction,
  CONVEX_DEV_TERMINAL_ID,
  CONVEX_TASK_TERMINAL_ID,
  createInitialConvexWorkflowState,
  reduceConvexExit,
  reduceConvexOutput,
  type ConvexAction,
} from "~/convexWorkflow";
import { readNativeApi } from "~/nativeApi";
import { convexQueryKeys, convexStatusQueryOptions } from "~/lib/convexReactQuery";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Separator } from "./ui/separator";

interface ConvexControlProps {
  threadId: ThreadId;
  cwd: string | null;
  terminalIds: string[];
  runningTerminalIds: string[];
  onRunCommand: (input: {
    command: string;
    cwd?: string;
    preferredTerminalId?: string;
    preferNewTerminal?: boolean;
    allowLocalDraftThread?: boolean;
  }) => Promise<string | null>;
  onFocusTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
}

function statusTone(input: {
  hasConvexDependency: boolean;
  isConfigured: boolean;
  devRunning: boolean;
  hasAuthUrl: boolean;
}): { label: string; variant: "outline" | "secondary" } {
  if (input.hasAuthUrl) return { label: "Authorize", variant: "secondary" };
  if (input.devRunning) return { label: "Live", variant: "secondary" };
  if (input.isConfigured) return { label: "Ready", variant: "outline" };
  if (input.hasConvexDependency) return { label: "Set up", variant: "outline" };
  return { label: "Install", variant: "outline" };
}

export default function ConvexControl({
  threadId,
  cwd,
  terminalIds,
  runningTerminalIds,
  onRunCommand,
  onFocusTerminal,
  onCloseTerminal,
}: ConvexControlProps) {
  const api = readNativeApi();
  const queryClient = useQueryClient();
  const [workflow, setWorkflow] = useState(() => createInitialConvexWorkflowState());
  const { data: status } = useQuery(convexStatusQueryOptions(cwd));

  const devTerminalExists = terminalIds.includes(CONVEX_DEV_TERMINAL_ID);
  const taskTerminalExists = terminalIds.includes(CONVEX_TASK_TERMINAL_ID);
  const devRunning = runningTerminalIds.includes(CONVEX_DEV_TERMINAL_ID);
  const taskRunning = runningTerminalIds.includes(CONVEX_TASK_TERMINAL_ID);
  const busy = taskRunning || ["installing", "starting-dev", "deploying"].includes(workflow.phase);

  useEffect(() => {
    setWorkflow(createInitialConvexWorkflowState());
  }, [threadId, cwd]);

  useEffect(() => {
    if (!api) return;
    return api.terminal.onEvent((event) => {
      if (event.threadId !== threadId) return;
      if (event.terminalId !== CONVEX_DEV_TERMINAL_ID && event.terminalId !== CONVEX_TASK_TERMINAL_ID) {
        return;
      }

      if (event.type === "output") {
        setWorkflow((current) =>
          reduceConvexOutput(current, { terminalId: event.terminalId, data: event.data }),
        );
        return;
      }

      if (event.type === "error") {
        setWorkflow({
          phase: "error",
          activeAction: null,
          authUrl: null,
          message: "Convex command failed.",
          lastError: event.message,
        });
        return;
      }

      if (event.type === "exited") {
        setWorkflow((current) =>
          reduceConvexExit(current, {
            terminalId: event.terminalId,
            exitCode: event.exitCode,
            exitSignal: event.exitSignal,
          }),
        );
        void queryClient.invalidateQueries({ queryKey: convexQueryKeys.status(cwd) });
      }
    });
  }, [api, cwd, queryClient, threadId]);

  const tone = useMemo(
    () =>
      statusTone({
        hasConvexDependency: status?.hasConvexDependency ?? false,
        isConfigured: status?.isConfigured ?? false,
        devRunning,
        hasAuthUrl: workflow.authUrl !== null,
      }),
    [devRunning, status?.hasConvexDependency, status?.isConfigured, workflow.authUrl],
  );

  const disabledReason = !cwd
    ? "Open a project to use Convex."
    : status && !status.hasPackageJson
      ? "Convex requires a JavaScript workspace with a package.json."
      : null;

  const runAction = async (action: ConvexAction) => {
    if (!status || !cwd) return;
    const command =
      action === "install"
        ? status.installCommand
        : action === "deploy"
          ? status.deployCommand
          : status.devCommand;
    if (!command) return;
    setWorkflow(beginConvexAction(action));
    const terminalId = await onRunCommand({
      command,
      cwd,
      preferredTerminalId: action === "dev" ? CONVEX_DEV_TERMINAL_ID : CONVEX_TASK_TERMINAL_ID,
      preferNewTerminal: action !== "dev",
      allowLocalDraftThread: true,
    });
    if (!terminalId) {
      setWorkflow({
        phase: "error",
        activeAction: null,
        authUrl: null,
        message: "Unable to start Convex command.",
        lastError: "The terminal command could not be started.",
      });
      return;
    }
    onFocusTerminal(terminalId);
  };

  const openAuthUrl = () => {
    const authUrl = workflow.authUrl;
    if (!authUrl || !api) return;
    void api.shell.openExternal(authUrl);
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
            size="sm"
            type="button"
            title={disabledReason ?? "Convex actions"}
            disabled={disabledReason !== null}
          />
        }
      >
        <BoxIcon />
        <span className="sr-only sm:not-sr-only">Convex</span>
        <Badge variant={tone.variant} className="ml-1 hidden text-[10px] sm:inline-flex">
          {tone.label}
        </Badge>
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" className="w-[min(92vw,22rem)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Convex</div>
            <div className="text-muted-foreground text-xs">
              Runs `npm install convex`, `npx convex dev`, and `npx convex deploy`
            </div>
          </div>
          {busy ? <LoaderCircleIcon className="text-muted-foreground size-4 animate-spin" /> : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Badge variant={status?.hasConvexDependency ? "secondary" : "outline"}>
            {status?.hasConvexDependency ? "Package installed" : "Package missing"}
          </Badge>
          <Badge variant={status?.hasConvexDirectory ? "secondary" : "outline"}>
            {status?.hasConvexDirectory ? "convex/ present" : "No convex/ yet"}
          </Badge>
          <Badge variant={status?.hasEnvLocal ? "secondary" : "outline"}>
            {status?.hasEnvLocal ? ".env.local present" : "No .env.local yet"}
          </Badge>
        </div>

        {(workflow.message || workflow.lastError) && (
          <div className="bg-muted/45 mt-3 rounded-lg px-3 py-2 text-xs">
            {workflow.message ? <div>{workflow.message}</div> : null}
            {workflow.lastError ? (
              <div className="text-rose-600 mt-1 dark:text-rose-300">{workflow.lastError}</div>
            ) : null}
          </div>
        )}

        <Separator className="my-3" />

        <div className="grid gap-2">
          {!status?.hasConvexDependency ? (
            <Button
              type="button"
              size="sm"
              className="justify-start"
              disabled={busy || disabledReason !== null}
              onClick={() => void runAction("install")}
            >
              <BoxIcon />
              Install Convex
            </Button>
          ) : null}

          {!devRunning ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="justify-start"
              disabled={busy || disabledReason !== null}
              onClick={() => void runAction("dev")}
            >
              <SquareTerminalIcon />
              {status?.isConfigured ? "Run Convex Dev" : "Set Up with Convex Dev"}
            </Button>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="justify-start"
            disabled={busy || disabledReason !== null || !status?.hasConvexDependency}
            onClick={() => void runAction("deploy")}
          >
            <RocketIcon />
            Deploy Convex
          </Button>

          {workflow.authUrl ? (
            <Button type="button" size="sm" variant="outline" className="justify-start" onClick={openAuthUrl}>
              <ExternalLinkIcon />
              Open Authorization
            </Button>
          ) : null}

          {devTerminalExists ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="justify-start"
              onClick={() => onFocusTerminal(CONVEX_DEV_TERMINAL_ID)}
            >
              <SquareTerminalIcon />
              View Dev Logs
            </Button>
          ) : null}

          {taskTerminalExists ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="justify-start"
              onClick={() => onFocusTerminal(CONVEX_TASK_TERMINAL_ID)}
            >
              <SquareTerminalIcon />
              View Task Logs
            </Button>
          ) : null}

          {devRunning ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="justify-start"
              onClick={() => onCloseTerminal(CONVEX_DEV_TERMINAL_ID)}
            >
              Stop Convex Dev
            </Button>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
