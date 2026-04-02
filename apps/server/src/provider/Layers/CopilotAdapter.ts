import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { version } from "../../../package.json" with { type: "json" };

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type Client,
} from "@agentclientprotocol/sdk";
import type * as acp from "@agentclientprotocol/sdk";
import {
  ApprovalRequestId,
  EventId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderTurnStartResult,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type ProviderUserInputAnswers,
} from "@t3sparks/contracts";
import { fromGitHubCopilotModelId, toGitHubCopilotModelId } from "@t3sparks/shared/model";
import { Effect, Layer, Queue, Schema, Stream } from "effect";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
} from "../Errors.ts";
import {
  mapCopilotToolKindToItemType,
  mapCopilotToolKindToRequestType,
  planEntriesToSteps,
  selectAutoApproveOptionId,
  selectPermissionOptionId,
  stopReasonToTurnStatus,
  summarizeToolCall,
} from "./copilotAdapter.logic.ts";
import { resolveCopilotBinary } from "./copilotBinary.ts";
import { CopilotAdapter, type CopilotAdapterShape } from "../Services/CopilotAdapter.ts";

const PROVIDER = "githubCopilot" as const;
const DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT = 64 * 1024;
const isProviderAdapterRequestError = Schema.is(ProviderAdapterRequestError);
const isProviderAdapterProcessError = Schema.is(ProviderAdapterProcessError);
const isProviderAdapterSessionNotFoundError = Schema.is(ProviderAdapterSessionNotFoundError);
const isProviderAdapterSessionClosedError = Schema.is(ProviderAdapterSessionClosedError);

interface CopilotResumeCursor {
  readonly sessionId: string;
}

interface PendingApproval {
  readonly options: ReadonlyArray<acp.PermissionOption>;
  readonly resolve: (response: acp.RequestPermissionResponse) => void;
  readonly reject: (error: Error) => void;
  readonly requestType: ReturnType<typeof mapCopilotToolKindToRequestType>;
  readonly turnId: TurnId | null;
}

interface TerminalState {
  readonly id: string;
  readonly process: ChildProcess;
  readonly outputByteLimit: number;
  output: string;
  truncated: boolean;
  exitStatus: acp.TerminalExitStatus | null;
  exitPromise: Promise<acp.WaitForTerminalExitResponse>;
  resolveExit: (result: acp.WaitForTerminalExitResponse) => void;
}

interface ActiveTurnState {
  readonly turnId: TurnId;
  readonly assistantItemIdByMessageId: Map<string, string>;
  readonly reasoningItemIdByMessageId: Map<string, string>;
  readonly toolItemById: Map<string, { itemType: ReturnType<typeof mapCopilotToolKindToItemType> }>;
  readonly items: Array<unknown>;
}

interface CopilotSessionState {
  session: ProviderSession;
  readonly child: ChildProcess;
  readonly connection: ClientSideConnection;
  readonly sessionId: string;
  readonly turns: Array<{
    id: TurnId;
    items: Array<unknown>;
  }>;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly terminals: Map<string, TerminalState>;
  readonly agentCapabilities: acp.AgentCapabilities | null | undefined;
  autoApproveForSession: boolean;
  currentTurn: ActiveTurnState | null;
  currentPrompt: Promise<acp.PromptResponse> | null;
  stopped: boolean;
  finalized: boolean;
  stderrBuffer: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asRuntimeItemId(value: string): ReturnType<typeof RuntimeItemId.makeUnsafe> {
  return RuntimeItemId.makeUnsafe(value);
}

function asRuntimeRequestId(value: ApprovalRequestId): ReturnType<typeof RuntimeRequestId.makeUnsafe> {
  return RuntimeRequestId.makeUnsafe(value);
}

function decodeResumeCursor(value: unknown): CopilotResumeCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const sessionId = "sessionId" in value ? value.sessionId : undefined;
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? { sessionId } : null;
}

function providerEventBase(input: {
  threadId: ThreadId;
  turnId?: TurnId;
  itemId?: string;
  requestId?: ApprovalRequestId;
}): Pick<ProviderRuntimeEvent, "eventId" | "provider" | "threadId" | "createdAt" | "turnId" | "itemId" | "requestId"> {
  return {
    eventId: EventId.makeUnsafe(crypto.randomUUID()),
    provider: PROVIDER,
    threadId: input.threadId,
    createdAt: nowIso(),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.itemId ? { itemId: asRuntimeItemId(input.itemId) } : {}),
    ...(input.requestId ? { requestId: asRuntimeRequestId(input.requestId) } : {}),
  };
}

function toRequestError(method: string, detail: string, cause?: unknown): ProviderAdapterRequestError {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function toProcessError(threadId: ThreadId, detail: string, cause?: unknown): ProviderAdapterProcessError {
  return new ProviderAdapterProcessError({
    provider: PROVIDER,
    threadId,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function toErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }
  return fallback;
}

function appendOutput(existing: string, chunk: string, limit: number): { output: string; truncated: boolean } {
  const next = `${existing}${chunk}`;
  const encoder = new TextEncoder();
  if (encoder.encode(next).length <= limit) {
    return { output: next, truncated: false };
  }

  let output = next;
  while (output.length > 0 && encoder.encode(output).length > limit) {
    output = output.slice(1);
  }
  return { output, truncated: true };
}

function buildToolSummaryInput(input: {
  readonly title?: string | null | undefined;
  readonly locations?: ReadonlyArray<acp.ToolCallLocation> | null | undefined;
  readonly rawInput?: unknown;
  readonly rawOutput?: unknown;
}) {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.locations !== undefined ? { locations: input.locations } : {}),
    ...(input.rawInput !== undefined ? { rawInput: input.rawInput } : {}),
    ...(input.rawOutput !== undefined ? { rawOutput: input.rawOutput } : {}),
  };
}

async function promptBlocksFromInput(input: {
  readonly sendTurn: ProviderSendTurnInput;
  readonly stateDir: string;
}): Promise<Array<acp.ContentBlock>> {
  const blocks: Array<acp.ContentBlock> = [];
  const instructions = input.sendTurn.customInstructions ?? [];
  const prompt = input.sendTurn.input?.trim() ?? "";
  if (instructions.length > 0 || prompt.length > 0) {
    const instructionText =
      instructions.length === 0
        ? prompt
        : [
            "Apply these custom instructions for this turn:",
            ...instructions.map(
              (instruction, index) => `${index + 1}. ${instruction.title}\n${instruction.body}`,
            ),
            "User request:",
            prompt || "Continue with the current task.",
          ].join("\n\n");
    blocks.push({
      type: "text",
      text: instructionText,
    });
  }

  for (const attachment of input.sendTurn.attachments ?? []) {
    if (attachment.type !== "image") {
      continue;
    }
    const attachmentPath = resolveAttachmentPath({
      stateDir: input.stateDir,
      attachment,
    });
    if (!attachmentPath) {
      continue;
    }
    const bytes = await readFile(attachmentPath);
    blocks.push({
      type: "image",
      mimeType: attachment.mimeType,
      data: bytes.toString("base64"),
    });
  }

  return blocks;
}

function createTerminalState(input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string | null | undefined;
  readonly env: Record<string, string>;
  readonly outputByteLimit: number;
}): TerminalState {
  const child = spawn(input.command, [...input.args], {
    ...(input.cwd ? { cwd: input.cwd } : {}),
    env: input.env,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let resolveExit!: (result: acp.WaitForTerminalExitResponse) => void;
  const exitPromise = new Promise<acp.WaitForTerminalExitResponse>((resolve) => {
    resolveExit = resolve;
  });
  const state: TerminalState = {
    id: crypto.randomUUID(),
    process: child,
    outputByteLimit: input.outputByteLimit,
    output: "",
    truncated: false,
    exitStatus: null,
    exitPromise,
    resolveExit,
  };

  const onChunk = (chunk: Buffer | string) => {
    const next = appendOutput(
      state.output,
      typeof chunk === "string" ? chunk : chunk.toString("utf8"),
      state.outputByteLimit,
    );
    state.output = next.output;
    state.truncated = state.truncated || next.truncated;
  };
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);
  child.on("exit", (code, signal) => {
    state.exitStatus = {
      ...(code !== null ? { exitCode: code } : {}),
      ...(signal !== null ? { signal } : {}),
    };
    state.resolveExit({
      ...(code !== null ? { exitCode: code } : {}),
      ...(signal !== null ? { signal } : {}),
    });
  });
  child.on("error", (error) => {
    onChunk(error.message);
    state.exitStatus = { exitCode: 1 };
    state.resolveExit({ exitCode: 1 });
  });

  return state;
}

export function makeCopilotAdapterLive() {
  return Layer.effect(
    CopilotAdapter,
    Effect.gen(function* () {
      const { stateDir } = yield* ServerConfig;
      const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const sessions = new Map<ThreadId, CopilotSessionState>();

      const emit = (event: ProviderRuntimeEvent) => Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);

      const getSessionState = (threadId: ThreadId) => {
        const state = sessions.get(threadId);
        if (!state) {
          throw new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }
        return state;
      };

      const finalizeSession = async (input: {
        readonly threadId: ThreadId;
        readonly reason: string;
        readonly detail?: string;
        readonly exitKind: "graceful" | "error";
      }) => {
        const state = sessions.get(input.threadId);
        if (!state || state.finalized) {
          return;
        }
        state.finalized = true;
        state.stopped = true;
        state.currentPrompt = null;
        state.currentTurn = null;
        for (const pending of state.pendingApprovals.values()) {
          pending.reject(new Error("GitHub Copilot session closed."));
        }
        state.pendingApprovals.clear();
        for (const terminal of state.terminals.values()) {
          terminal.process.kill();
        }
        state.terminals.clear();
        await Effect.runPromise(
          Effect.all(
            [
              emit({
                ...providerEventBase({ threadId: input.threadId }),
                type: "session.state.changed",
                payload: {
                  state: input.exitKind === "error" ? "error" : "stopped",
                  reason: input.reason,
                  ...(input.detail ? { detail: input.detail } : {}),
                },
              }),
              emit({
                ...providerEventBase({ threadId: input.threadId }),
                type: "session.exited",
                payload: {
                  reason: input.reason,
                  exitKind: input.exitKind,
                  recoverable: input.exitKind !== "error",
                },
              }),
            ],
            { concurrency: "unbounded" },
          ),
        );
      };

      const buildClient = (threadId: ThreadId, stateRef: { current: CopilotSessionState | null }): Client => ({
        requestPermission: async (params) => {
          const state = stateRef.current;
          if (!state || state.stopped || !state.currentTurn) {
            return { outcome: { outcome: "cancelled" } };
          }
          if (state.autoApproveForSession || state.session.runtimeMode === "full-access") {
            const optionId = selectAutoApproveOptionId(params.options);
            return optionId
              ? {
                  outcome: {
                    outcome: "selected",
                    optionId,
                  },
                }
              : {
                  outcome: {
                    outcome: "cancelled",
                  },
                };
          }
          const requestId = ApprovalRequestId.makeUnsafe(crypto.randomUUID());
          const detail = summarizeToolCall(
            buildToolSummaryInput({
              title: params.toolCall.title,
              locations: params.toolCall.locations,
              rawInput: params.toolCall.rawInput,
              rawOutput: params.toolCall.rawOutput,
            }),
          );
          const requestType = mapCopilotToolKindToRequestType(params.toolCall.kind);

          await Effect.runPromise(
            emit({
              ...providerEventBase({
                threadId,
                turnId: state.currentTurn.turnId,
                requestId,
              }),
              type: "request.opened",
              payload: {
                requestType,
                ...(detail ? { detail } : {}),
              },
            }),
          );

          return await new Promise<acp.RequestPermissionResponse>((resolve, reject) => {
            state.pendingApprovals.set(requestId, {
              options: params.options,
              resolve,
              reject,
              requestType,
              turnId: state.currentTurn?.turnId ?? null,
            });
          });
        },

        sessionUpdate: async (params) => {
          const state = stateRef.current;
          if (!state || state.stopped || !state.currentTurn) {
            return;
          }
          const turn = state.currentTurn;
          const update = params.update;
          if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
            const messageId = update.messageId ?? `assistant:${turn.turnId}`;
            const itemId = turn.assistantItemIdByMessageId.get(messageId) ?? `assistant:${messageId}`;
            if (!turn.assistantItemIdByMessageId.has(messageId)) {
              turn.assistantItemIdByMessageId.set(messageId, itemId);
              turn.items.push({ itemId, itemType: "assistant_message" });
              await Effect.runPromise(
                emit({
                  ...providerEventBase({ threadId, turnId: turn.turnId, itemId }),
                  type: "item.started",
                  payload: {
                    itemType: "assistant_message",
                    title: "Assistant message",
                  },
                }),
              );
            }
            await Effect.runPromise(
              emit({
                ...providerEventBase({ threadId, turnId: turn.turnId, itemId }),
                type: "content.delta",
                payload: {
                  streamKind: "assistant_text",
                  delta: update.content.text,
                },
              }),
            );
            return;
          }

          if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
            const messageId = update.messageId ?? `reasoning:${turn.turnId}`;
            const itemId = turn.reasoningItemIdByMessageId.get(messageId) ?? `reasoning:${messageId}`;
            if (!turn.reasoningItemIdByMessageId.has(messageId)) {
              turn.reasoningItemIdByMessageId.set(messageId, itemId);
              turn.items.push({ itemId, itemType: "reasoning" });
              await Effect.runPromise(
                emit({
                  ...providerEventBase({ threadId, turnId: turn.turnId, itemId }),
                  type: "item.started",
                  payload: {
                    itemType: "reasoning",
                    title: "Reasoning",
                  },
                }),
              );
            }
            await Effect.runPromise(
              emit({
                ...providerEventBase({ threadId, turnId: turn.turnId, itemId }),
                type: "content.delta",
                payload: {
                  streamKind: "reasoning_text",
                  delta: update.content.text,
                },
              }),
            );
            return;
          }

          if (update.sessionUpdate === "plan") {
            await Effect.runPromise(
              emit({
                ...providerEventBase({ threadId, turnId: turn.turnId }),
                type: "turn.plan.updated",
                payload: {
                  plan: planEntriesToSteps(update.entries),
                },
              }),
            );
            return;
          }

          if (update.sessionUpdate === "tool_call") {
            const itemType = mapCopilotToolKindToItemType(update.kind);
            turn.toolItemById.set(update.toolCallId, { itemType });
            turn.items.push({ itemId: update.toolCallId, itemType });
            await Effect.runPromise(
              emit({
                ...providerEventBase({ threadId, turnId: turn.turnId, itemId: update.toolCallId }),
                type: "item.started",
                payload: {
                  itemType,
                  title: update.title,
                  ...(summarizeToolCall(
                    buildToolSummaryInput({
                      title: update.title,
                      locations: update.locations,
                      rawInput: update.rawInput,
                      rawOutput: update.rawOutput,
                    }),
                  )
                    ? {
                        detail: summarizeToolCall(
                          buildToolSummaryInput({
                            title: update.title,
                            locations: update.locations,
                            rawInput: update.rawInput,
                            rawOutput: update.rawOutput,
                          }),
                        ),
                      }
                    : {}),
                },
              }),
            );
            return;
          }

          if (update.sessionUpdate === "tool_call_update") {
            const known = turn.toolItemById.get(update.toolCallId);
            if ((update.status ?? null) === "completed" || (update.status ?? null) === "failed") {
              await Effect.runPromise(
                emit({
                  ...providerEventBase({ threadId, turnId: turn.turnId, itemId: update.toolCallId }),
                  type: "item.completed",
                  payload: {
                    itemType: known?.itemType ?? "dynamic_tool_call",
                    title: update.title ?? "Tool call",
                    ...(summarizeToolCall(
                      buildToolSummaryInput({
                        title: update.title,
                        locations: update.locations,
                        rawInput: update.rawInput,
                        rawOutput: update.rawOutput,
                      }),
                    )
                      ? {
                          detail: summarizeToolCall(
                            buildToolSummaryInput({
                              title: update.title,
                              locations: update.locations,
                              rawInput: update.rawInput,
                              rawOutput: update.rawOutput,
                            }),
                          ),
                        }
                      : {}),
                  },
                }),
              );
            }
            return;
          }

          if (update.sessionUpdate === "usage_update") {
            await Effect.runPromise(
              emit({
                ...providerEventBase({ threadId, turnId: turn.turnId }),
                type: "thread.token-usage.updated",
                payload: {
                  usage: update,
                },
              }),
            );
          }
        },

        readTextFile: async (params) => {
          const content = await readFile(params.path, "utf8");
          if (!params.line && !params.limit) {
            return { content };
          }
          const lines = content.split(/\r?\n/);
          const startIndex = Math.max(0, (params.line ?? 1) - 1);
          const endIndex =
            typeof params.limit === "number" && params.limit >= 0
              ? startIndex + params.limit
              : lines.length;
          return { content: lines.slice(startIndex, endIndex).join("\n") };
        },

        writeTextFile: async (params) => {
          const directory = params.path.replace(/[/\\][^/\\]+$/, "");
          if (directory.length > 0) {
            await mkdir(directory, { recursive: true });
          }
          await writeFile(params.path, params.content, "utf8");
          return {};
        },

        createTerminal: async (params) => {
          const state = stateRef.current;
          if (!state) {
            throw new Error("GitHub Copilot session is unavailable.");
          }
          const env = Object.fromEntries((params.env ?? []).map((entry) => [entry.name, entry.value]));
          const terminal = createTerminalState({
            command: params.command,
            args: params.args ?? [],
            cwd: params.cwd ?? state.session.cwd,
            env: { ...process.env, ...env } as Record<string, string>,
            outputByteLimit: params.outputByteLimit ?? DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT,
          });
          state.terminals.set(terminal.id, terminal);
          return { terminalId: terminal.id };
        },

        terminalOutput: async (params) => {
          const state = stateRef.current;
          const terminal = state?.terminals.get(params.terminalId);
          if (!terminal) {
            throw RequestError.resourceNotFound(params.terminalId);
          }
          return {
            output: terminal.output,
            truncated: terminal.truncated,
            ...(terminal.exitStatus ? { exitStatus: terminal.exitStatus } : {}),
          };
        },

        waitForTerminalExit: async (params) => {
          const state = stateRef.current;
          const terminal = state?.terminals.get(params.terminalId);
          if (!terminal) {
            throw RequestError.resourceNotFound(params.terminalId);
          }
          return await terminal.exitPromise;
        },

        killTerminal: async (params) => {
          const state = stateRef.current;
          const terminal = state?.terminals.get(params.terminalId);
          if (!terminal) {
            throw RequestError.resourceNotFound(params.terminalId);
          }
          terminal.process.kill();
          return {};
        },

        releaseTerminal: async (params) => {
          const state = stateRef.current;
          const terminal = state?.terminals.get(params.terminalId);
          if (!terminal) {
            throw RequestError.resourceNotFound(params.terminalId);
          }
          terminal.process.kill();
          state!.terminals.delete(params.terminalId);
          return {};
        },
      });

      const startSession: CopilotAdapterShape["startSession"] = (input) =>
        Effect.tryPromise({
          try: async () => {
            const binaryPath = resolveCopilotBinary(
              input.providerOptions?.githubCopilot?.binaryPath,
            );
            const childArgs = ["--acp", "--stdio"];
            const childCommand = binaryPath.endsWith(".js") ? process.execPath : binaryPath;
            const child = spawn(
              childCommand,
              binaryPath.endsWith(".js") ? [binaryPath, ...childArgs] : childArgs,
              {
                ...(input.cwd ? { cwd: input.cwd } : {}),
                env: {
                  ...process.env,
                  ...(input.cwd ? { PWD: input.cwd } : {}),
                },
                stdio: ["pipe", "pipe", "pipe"],
              },
            );
            if (!child.stdin || !child.stdout) {
              throw new Error("GitHub Copilot CLI did not expose stdio pipes.");
            }

            let stderrBuffer = "";
            child.stderr?.setEncoding("utf8");
            child.stderr?.on("data", (chunk) => {
              stderrBuffer = `${stderrBuffer}${chunk}`.slice(-4_000);
            });

            const stateRef: { current: CopilotSessionState | null } = { current: null };
            const stream = ndJsonStream(
              Writable.toWeb(child.stdin),
              Readable.toWeb(child.stdout),
            );
            const connection = new ClientSideConnection(
              () => buildClient(input.threadId, stateRef),
              stream,
            );
            const initialized = await connection.initialize({
              protocolVersion: PROTOCOL_VERSION,
              clientInfo: {
                name: "t3sparks",
                title: "T3 Sparks",
                version,
              },
              clientCapabilities: {
                fs: {
                  readTextFile: true,
                  writeTextFile: true,
                },
                terminal: true,
                auth: {
                  terminal: true,
                },
              },
            });

            const resumeCursor = decodeResumeCursor(input.resumeCursor);
            const sessionCapabilities = initialized.agentCapabilities?.sessionCapabilities;
            const resumed =
              resumeCursor && sessionCapabilities?.resume
                ? await connection.unstable_resumeSession?.({
                    sessionId: resumeCursor.sessionId,
                    cwd: input.cwd ?? process.cwd(),
                    mcpServers: [],
                  })
                : initialized.agentCapabilities?.loadSession && resumeCursor
                  ? await connection.loadSession?.({
                      sessionId: resumeCursor.sessionId,
                      cwd: input.cwd ?? process.cwd(),
                      mcpServers: [],
                    })
                  : null;
            const created =
              resumed ??
              (await connection.newSession({
                cwd: input.cwd ?? process.cwd(),
                mcpServers: [],
              }));
            const resolvedSessionId: string | undefined =
              "sessionId" in created && typeof created.sessionId === "string"
                ? created.sessionId
                : resumeCursor?.sessionId;
            if (!resolvedSessionId) {
              throw new Error("GitHub Copilot session id was not returned.");
            }
            const selectedModelId = toGitHubCopilotModelId(input.model);
            if (selectedModelId && connection.unstable_setSessionModel) {
              await connection.unstable_setSessionModel({
                sessionId: resolvedSessionId,
                modelId: selectedModelId,
              });
            }
            const currentModel =
              selectedModelId ??
              toGitHubCopilotModelId(created.models?.currentModelId ?? null) ??
              null;
            const createdAt = nowIso();
            const session: ProviderSession = {
              provider: PROVIDER,
              status: "ready",
              runtimeMode: input.runtimeMode,
              ...(input.cwd ? { cwd: input.cwd } : {}),
              ...(fromGitHubCopilotModelId(currentModel) ? { model: fromGitHubCopilotModelId(currentModel)! } : {}),
              threadId: input.threadId,
              resumeCursor: {
                sessionId: resolvedSessionId,
              },
              createdAt,
              updatedAt: createdAt,
            };

            const state: CopilotSessionState = {
              session,
              child,
              connection,
              sessionId: resolvedSessionId,
              turns: [],
              pendingApprovals: new Map(),
              terminals: new Map(),
              agentCapabilities: initialized.agentCapabilities,
              autoApproveForSession: input.runtimeMode === "full-access",
              currentTurn: null,
              currentPrompt: null,
              stopped: false,
              finalized: false,
              stderrBuffer,
            };
            stateRef.current = state;
            sessions.set(input.threadId, state);

            child.on("exit", (code, signal) => {
              state.stderrBuffer = stderrBuffer;
              void finalizeSession({
                threadId: input.threadId,
                reason: "process-exit",
                detail: `copilot exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
                exitKind: state.stopped ? "graceful" : "error",
              }).catch(() => undefined);
            });

            connection.closed.then(() => {
              void finalizeSession({
                threadId: input.threadId,
                reason: "connection-closed",
                exitKind: state.stopped ? "graceful" : "error",
              }).catch(() => undefined);
            });

            await Effect.runPromise(
              Effect.all(
                [
                  emit({
                    ...providerEventBase({ threadId: input.threadId }),
                    type: "session.started",
                    payload: {
                      ...(resumeCursor ? { resume: resumeCursor } : {}),
                    },
                  }),
                  emit({
                    ...providerEventBase({ threadId: input.threadId }),
                    type: "thread.started",
                    payload: {
                      providerThreadId: resolvedSessionId,
                    },
                  }),
                  emit({
                    ...providerEventBase({ threadId: input.threadId }),
                    type: "session.state.changed",
                    payload: {
                      state: "ready",
                    },
                  }),
                ],
                { concurrency: "unbounded" },
              ),
            );

            return session;
          },
          catch: (cause) => {
            const detail = toErrorMessage(
              cause,
              "Unable to start GitHub Copilot CLI in ACP mode.",
            );
            return isProviderAdapterProcessError(cause) ||
              isProviderAdapterRequestError(cause) ||
              isProviderAdapterSessionNotFoundError(cause) ||
              isProviderAdapterSessionClosedError(cause)
              ? cause
              : toProcessError(input.threadId, detail, cause);
          },
        });

      const sendTurn: CopilotAdapterShape["sendTurn"] = (input) =>
        Effect.tryPromise({
          try: async () => {
            const state = getSessionState(input.threadId);
            if (state.currentPrompt) {
              throw new ProviderAdapterSessionClosedError({
                provider: PROVIDER,
                threadId: input.threadId,
                cause: new Error("GitHub Copilot turn already running."),
              });
            }

            const nextModelId = toGitHubCopilotModelId(input.model ?? state.session.model);
            if (nextModelId && state.connection.unstable_setSessionModel) {
              await state.connection.unstable_setSessionModel({
                sessionId: state.sessionId,
                modelId: nextModelId,
              });
            }

            const turnId = TurnId.makeUnsafe(crypto.randomUUID());
            const turnState: ActiveTurnState = {
              turnId,
              assistantItemIdByMessageId: new Map(),
              reasoningItemIdByMessageId: new Map(),
              toolItemById: new Map(),
              items: [],
            };
            state.currentTurn = turnState;
            state.turns.push({ id: turnId, items: turnState.items });
            state.session = {
              ...state.session,
              status: "running",
              activeTurnId: turnId,
              ...(nextModelId ? { model: fromGitHubCopilotModelId(nextModelId) ?? state.session.model } : {}),
              updatedAt: nowIso(),
            };

            await Effect.runPromise(
              Effect.all(
                [
                  emit({
                    ...providerEventBase({ threadId: input.threadId }),
                    type: "session.state.changed",
                    payload: {
                      state: "running",
                    },
                  }),
                  emit({
                    ...providerEventBase({ threadId: input.threadId, turnId }),
                    type: "turn.started",
                    payload: {},
                  }),
                ],
                { concurrency: "unbounded" },
              ),
            );

            const promptBlocks = await promptBlocksFromInput({
              sendTurn: input,
              stateDir,
            });
            const promptPromise = state.connection.prompt({
              sessionId: state.sessionId,
              messageId: crypto.randomUUID(),
              prompt: promptBlocks,
            });
            state.currentPrompt = promptPromise;
            void promptPromise
              .then(async (result) => {
                const latestState = sessions.get(input.threadId);
                if (!latestState || latestState.currentPrompt !== promptPromise) {
                  return;
                }

                const nextState = stopReasonToTurnStatus(result.stopReason);
                for (const itemId of turnState.assistantItemIdByMessageId.values()) {
                  await Effect.runPromise(
                    emit({
                      ...providerEventBase({ threadId: input.threadId, turnId, itemId }),
                      type: "item.completed",
                      payload: {
                        itemType: "assistant_message",
                        title: "Assistant message",
                      },
                    }),
                  );
                }
                for (const itemId of turnState.reasoningItemIdByMessageId.values()) {
                  await Effect.runPromise(
                    emit({
                      ...providerEventBase({ threadId: input.threadId, turnId, itemId }),
                      type: "item.completed",
                      payload: {
                        itemType: "reasoning",
                        title: "Reasoning",
                      },
                    }),
                  );
                }

                latestState.pendingApprovals.clear();
                latestState.currentPrompt = null;
                latestState.currentTurn = null;
                latestState.session = {
                  ...latestState.session,
                  status: nextState === "failed" ? "error" : "ready",
                  activeTurnId: undefined,
                  updatedAt: nowIso(),
                };

                await Effect.runPromise(
                  Effect.all(
                    [
                      emit({
                        ...providerEventBase({ threadId: input.threadId, turnId }),
                        type: "turn.completed",
                        payload: {
                          state: nextState,
                          stopReason: result.stopReason,
                          ...(result.usage ? { usage: result.usage } : {}),
                        },
                      }),
                      emit({
                        ...providerEventBase({ threadId: input.threadId }),
                        type: "session.state.changed",
                        payload: {
                          state: nextState === "failed" ? "error" : "ready",
                        },
                      }),
                    ],
                    { concurrency: "unbounded" },
                  ),
                );
              })
              .catch((cause) => {
                const message = toErrorMessage(cause, "GitHub Copilot turn failed.");
                const latestState = sessions.get(input.threadId);
                if (!latestState || latestState.currentPrompt !== promptPromise) {
                  return;
                }

                latestState.currentPrompt = null;
                latestState.currentTurn = null;
                latestState.session = {
                  ...latestState.session,
                  status: "error",
                  activeTurnId: undefined,
                  lastError: message,
                  updatedAt: nowIso(),
                };
                void Effect.runPromise(
                  Effect.all(
                    [
                      emit({
                        ...providerEventBase({ threadId: input.threadId }),
                        type: "runtime.error",
                        payload: {
                          message,
                        },
                      }),
                      emit({
                        ...providerEventBase({ threadId: input.threadId }),
                        type: "session.state.changed",
                        payload: {
                          state: "error",
                          reason: "prompt-failed",
                          detail: message,
                        },
                      }),
                    ],
                    { concurrency: "unbounded" },
                  ),
                ).catch(() => undefined);
              });

            return {
              threadId: input.threadId,
              turnId,
              resumeCursor: {
                sessionId: state.sessionId,
              },
            } satisfies ProviderTurnStartResult;
          },
          catch: (cause) => {
            const message = toErrorMessage(cause, "GitHub Copilot turn failed.");
            const state = sessions.get(input.threadId);
            if (state) {
              state.currentPrompt = null;
              state.currentTurn = null;
              state.session = {
                ...state.session,
                status: "error",
                activeTurnId: undefined,
                lastError: message,
                updatedAt: nowIso(),
              };
              void Effect.runPromise(
                Effect.all(
                  [
                    emit({
                      ...providerEventBase({ threadId: input.threadId }),
                      type: "runtime.error",
                      payload: {
                        message,
                      },
                    }),
                    emit({
                      ...providerEventBase({ threadId: input.threadId }),
                      type: "session.state.changed",
                      payload: {
                        state: "error",
                        reason: "prompt-failed",
                        detail: message,
                      },
                    }),
                  ],
                  { concurrency: "unbounded" },
                ),
              ).catch(() => undefined);
            }
            return isProviderAdapterRequestError(cause) ||
              isProviderAdapterProcessError(cause) ||
              isProviderAdapterSessionNotFoundError(cause) ||
              isProviderAdapterSessionClosedError(cause)
              ? cause
              : toRequestError("prompt", message, cause);
          },
        });

      const interruptTurn: CopilotAdapterShape["interruptTurn"] = (threadId) =>
        Effect.tryPromise({
          try: async () => {
            const state = getSessionState(threadId);
            await state.connection.cancel({ sessionId: state.sessionId });
          },
          catch: (cause) => toRequestError("cancel", toErrorMessage(cause, "Failed to interrupt turn."), cause),
        });

      const respondToRequest: CopilotAdapterShape["respondToRequest"] = (threadId, requestId, decision) =>
        Effect.tryPromise({
          try: async () => {
            const state = getSessionState(threadId);
            const pending = state.pendingApprovals.get(requestId);
            if (!pending) {
              throw new Error(`Unknown pending permission request: ${requestId}`);
            }
            state.pendingApprovals.delete(requestId);
            const optionId = selectPermissionOptionId(decision, pending.options);
            if (decision === "acceptForSession" && optionId) {
              state.autoApproveForSession = true;
            }
            pending.resolve(
              optionId
                ? {
                    outcome: {
                      outcome: "selected",
                      optionId,
                    },
                  }
                : {
                    outcome: {
                      outcome: "cancelled",
                    },
                  },
            );
            await Effect.runPromise(
              emit({
                ...providerEventBase({
                  threadId,
                  ...(pending.turnId ? { turnId: pending.turnId } : {}),
                  requestId,
                }),
                type: "request.resolved",
                payload: {
                  requestType: pending.requestType,
                  decision,
                },
              }),
            );
          },
          catch: (cause) =>
            toRequestError(
              "requestPermission",
              toErrorMessage(cause, "Failed to resolve approval request."),
              cause,
            ),
        });

      const respondToUserInput: CopilotAdapterShape["respondToUserInput"] = (_threadId, _requestId, _answers) =>
        Effect.fail(
          toRequestError(
            "userInput",
            "GitHub Copilot ACP user-input prompts are not implemented in this adapter.",
          ),
        );

      const stopSession: CopilotAdapterShape["stopSession"] = (threadId) =>
        Effect.tryPromise({
          try: async () => {
            const state = getSessionState(threadId);
            state.stopped = true;
            if (state.agentCapabilities?.sessionCapabilities?.close && state.connection.unstable_closeSession) {
              await state.connection.unstable_closeSession({
                sessionId: state.sessionId,
              });
            } else if (state.currentPrompt) {
              await state.connection.cancel({ sessionId: state.sessionId });
            }
            state.child.kill();
            await finalizeSession({
              threadId,
              reason: "stop-session",
              exitKind: "graceful",
            });
            sessions.delete(threadId);
          },
          catch: (cause) => toProcessError(threadId, toErrorMessage(cause, "Failed to stop session."), cause),
        });

      const listSessions: CopilotAdapterShape["listSessions"] = () =>
        Effect.sync(() => Array.from(sessions.values()).map((entry) => entry.session));

      const hasSession: CopilotAdapterShape["hasSession"] = (threadId) =>
        Effect.sync(() => sessions.has(threadId));

      const readThread: CopilotAdapterShape["readThread"] = (threadId) =>
        Effect.sync(() => {
          const state = getSessionState(threadId);
          return {
            threadId,
            turns: state.turns.map((turn) => ({
              id: turn.id,
              items: [...turn.items],
            })),
          };
        });

      const rollbackThread: CopilotAdapterShape["rollbackThread"] = (threadId, _numTurns) =>
        Effect.fail(
          toRequestError(
            "rollbackThread",
            `GitHub Copilot session rollback is not supported for thread '${threadId}'.`,
          ),
        );

      const stopAll: CopilotAdapterShape["stopAll"] = () =>
        Effect.forEach(
          Array.from(sessions.keys()),
          (threadId) => Effect.catch(stopSession(threadId), () => Effect.void),
          { concurrency: "unbounded" },
        ).pipe(Effect.asVoid);

      return {
        provider: PROVIDER,
        capabilities: {
          sessionModelSwitch: "restart-session",
        },
        startSession,
        sendTurn,
        interruptTurn,
        respondToRequest,
        respondToUserInput: (
          threadId: ThreadId,
          requestId: ApprovalRequestId,
          answers: ProviderUserInputAnswers,
        ) => respondToUserInput(threadId, requestId, answers),
        stopSession,
        listSessions,
        hasSession,
        readThread,
        rollbackThread,
        stopAll,
        streamEvents: Stream.fromQueue(runtimeEventQueue),
      } satisfies CopilotAdapterShape;
    }),
  );
}
