import { spawn, type ChildProcess } from "node:child_process";

import {
  EventId,
  type CustomInstruction,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, Queue, Schema, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
} from "../Errors.ts";
import { GeminiAdapter, type GeminiAdapterShape } from "../Services/GeminiAdapter.ts";
import { buildGeminiHeadlessArgs, resolveGeminiCli } from "../../gemini/geminiCli.ts";

const PROVIDER = "gemini" as const;
const GEMINI_31_PREVIEW_MODEL = "gemini-3.1-pro-preview";
const GEMINI_31_PREVIEW_UNAVAILABLE_MESSAGE =
  "Gemini 3.1 Pro is listed in current Gemini docs, but it is unavailable through the current Gemini CLI/API path in this environment. Choose Gemini 2.5 Pro or Gemini 2.5 Flash for now.";
const isProviderAdapterRequestError = Schema.is(ProviderAdapterRequestError);
const isProviderAdapterSessionNotFoundError = Schema.is(ProviderAdapterSessionNotFoundError);
const isProviderAdapterSessionClosedError = Schema.is(ProviderAdapterSessionClosedError);
const isProviderAdapterProcessError = Schema.is(ProviderAdapterProcessError);

interface GeminiResumeCursor {
  readonly sessionId: string;
}

interface GeminiStreamJsonEventBase {
  readonly type: string;
  readonly timestamp?: string;
}

interface GeminiInitEvent extends GeminiStreamJsonEventBase {
  readonly type: "init";
  readonly session_id?: string;
  readonly model?: string;
}

interface GeminiMessageEvent extends GeminiStreamJsonEventBase {
  readonly type: "message";
  readonly role?: "user" | "assistant";
  readonly content?: string;
  readonly delta?: boolean;
}

interface GeminiToolUseEvent extends GeminiStreamJsonEventBase {
  readonly type: "tool_use";
  readonly tool_name?: string;
  readonly tool_id?: string;
  readonly parameters?: unknown;
}

interface GeminiToolResultEvent extends GeminiStreamJsonEventBase {
  readonly type: "tool_result";
  readonly tool_id?: string;
  readonly status?: "success" | "error";
  readonly output?: string;
  readonly error?: {
    readonly type?: string;
    readonly message?: string;
  };
}

interface GeminiResultEvent extends GeminiStreamJsonEventBase {
  readonly type: "result";
  readonly status?: "success" | "error";
  readonly error?: {
    readonly type?: string;
    readonly message?: string;
  };
  readonly stats?: unknown;
}

interface GeminiWarningEvent extends GeminiStreamJsonEventBase {
  readonly type: "error";
  readonly severity?: "warning" | "error";
  readonly message?: string;
}

type GeminiStreamJsonEvent =
  | GeminiInitEvent
  | GeminiMessageEvent
  | GeminiToolUseEvent
  | GeminiToolResultEvent
  | GeminiResultEvent
  | GeminiWarningEvent;

interface GeminiSessionState {
  session: ProviderSession;
  currentProcess: ChildProcess | null;
  currentTurnId: TurnId | null;
  currentAssistantItemId: string | null;
  interrupted: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function decodeResumeCursor(value: unknown): GeminiResumeCursor | null {
  if (!isRecord(value)) return null;
  const sessionId = asString(value.sessionId);
  return sessionId ? { sessionId } : null;
}

function providerEventBase(input: {
  threadId: ThreadId;
  turnId?: TurnId;
  itemId?: string;
}): Pick<ProviderRuntimeEvent, "eventId" | "provider" | "threadId" | "createdAt" | "turnId" | "itemId"> {
  return {
    eventId: EventId.makeUnsafe(crypto.randomUUID()),
    provider: PROVIDER,
    threadId: input.threadId,
    createdAt: nowIso(),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.itemId ? { itemId: RuntimeItemId.makeUnsafe(input.itemId) } : {}),
  };
}

function toRuntimeError(threadId: ThreadId, detail: string, cause?: unknown): ProviderAdapterProcessError {
  return new ProviderAdapterProcessError({
    provider: PROVIDER,
    threadId,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function rewriteGeminiFailureMessage(model: string | undefined, message: string): string {
  if (
    model === GEMINI_31_PREVIEW_MODEL &&
    /requested entity was not found|modelnotfounderror/i.test(message)
  ) {
    return GEMINI_31_PREVIEW_UNAVAILABLE_MESSAGE;
  }
  return message;
}

function composeGeminiPrompt(input: {
  readonly prompt: string;
  readonly customInstructions?: ReadonlyArray<CustomInstruction>;
}): string {
  const prompt = input.prompt.trim();
  if (!input.customInstructions || input.customInstructions.length === 0) {
    return prompt;
  }

  const instructionSections = input.customInstructions.map(
    (instruction, index) => `${index + 1}. ${instruction.title}\n${instruction.body}`,
  );

  return [
    "Apply these custom instructions for this turn:",
    ...instructionSections,
    "User request:",
    prompt,
  ].join("\n\n");
}

const makeGeminiAdapter = Effect.gen(function* () {
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, GeminiSessionState>();

  const emit = (event: ProviderRuntimeEvent) => Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid);

  const startSession: GeminiAdapterShape["startSession"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const resolution = await resolveGeminiCli();
        if (!resolution.available) {
          throw new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "startSession",
            detail: resolution.message ?? "Gemini CLI is unavailable.",
          });
        }

        const resumeCursor = decodeResumeCursor(input.resumeCursor);
        const createdAt = nowIso();
        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.model ? { model: input.model } : {}),
          threadId: input.threadId,
          ...(resumeCursor ? { resumeCursor } : {}),
          createdAt,
          updatedAt: createdAt,
        };

        sessions.set(input.threadId, {
          session,
          currentProcess: null,
          currentTurnId: null,
          currentAssistantItemId: null,
          interrupted: false,
        });

        await Effect.runPromise(
          Effect.all(
            [
              emit({
                ...providerEventBase({ threadId: input.threadId }),
                type: "session.started",
                payload: resumeCursor ? { resume: resumeCursor } : {},
              }),
              emit({
                ...providerEventBase({ threadId: input.threadId }),
                type: "thread.started",
                payload: {},
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
      catch: (cause) =>
        isProviderAdapterRequestError(cause) ||
        isProviderAdapterSessionNotFoundError(cause) ||
        isProviderAdapterProcessError(cause)
          ? cause
          : toRuntimeError(input.threadId, "Unable to start Gemini session.", cause),
    });

  const sendTurn: GeminiAdapterShape["sendTurn"] = (input) =>
    Effect.tryPromise({
      try: async () => {
        const state = sessions.get(input.threadId);
        if (!state) {
          throw new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId: input.threadId,
          });
        }
        if (state.currentProcess) {
          throw new ProviderAdapterSessionClosedError({
            provider: PROVIDER,
            threadId: input.threadId,
            cause: new Error("Gemini turn already running."),
          });
        }
        if (state.session.runtimeMode !== "full-access") {
          throw new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "sendTurn",
            detail: "Gemini currently requires Full access in T3 Sparks. Switch runtime mode and retry.",
          });
        }

        const resolution = await resolveGeminiCli();
        if (!resolution.available) {
          throw new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "sendTurn",
            detail: resolution.message ?? "Gemini CLI is unavailable.",
          });
        }

        const turnId = TurnId.makeUnsafe(crypto.randomUUID());
        const assistantItemId = `assistant:${turnId}`;
        const resumeCursor = decodeResumeCursor(state.session.resumeCursor);
        const prompt = composeGeminiPrompt({
          prompt: input.input?.trim() ?? "",
          ...(input.customInstructions !== undefined
            ? { customInstructions: input.customInstructions }
            : {}),
        });
        const selectedModel = input.model ?? state.session.model;
        const args = buildGeminiHeadlessArgs(resolution, {
          prompt,
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(resumeCursor?.sessionId ? { sessionId: resumeCursor.sessionId } : {}),
        });
        const child = spawn(resolution.command, args, {
          cwd: state.session.cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdoutBuffer = "";
        let stderrBuffer = "";
        let sawAssistantStart = false;
        let sawResult = false;
        let turnFailedMessage: string | undefined;
        let turnStatus: "completed" | "failed" | "cancelled" | "interrupted" = "completed";
        let resolveTurnStart: (() => void) | null = null;
        const turnStartedPromise = new Promise<void>((resolve) => {
          resolveTurnStart = resolve;
        });

        const finishTurn = async () => {
          const latest = sessions.get(input.threadId);
          if (!latest) return;
          sessions.set(input.threadId, {
            ...latest,
            currentProcess: null,
            currentTurnId: null,
            currentAssistantItemId: null,
            interrupted: false,
            session: {
              ...latest.session,
              status: turnStatus === "failed" ? "error" : "ready",
              activeTurnId: undefined,
              updatedAt: nowIso(),
              ...(turnFailedMessage ? { lastError: turnFailedMessage } : {}),
            },
          });
        };

        const handleParsedEvent = async (parsed: GeminiStreamJsonEvent) => {
          if (parsed.type === "init") {
            const sessionId = parsed.session_id?.trim();
            if (sessionId) {
              const latest = sessions.get(input.threadId);
              if (latest) {
                sessions.set(input.threadId, {
                  ...latest,
                  session: {
                    ...latest.session,
                    resumeCursor: { sessionId },
                    ...(parsed.model ? { model: parsed.model } : {}),
                    updatedAt: nowIso(),
                  },
                });
              }
            }
            resolveTurnStart?.();
            resolveTurnStart = null;
            return;
          }

          if (parsed.type === "message" && parsed.role === "assistant" && parsed.content) {
            if (!sawAssistantStart) {
              sawAssistantStart = true;
              await Effect.runPromise(
                emit({
                  ...providerEventBase({
                    threadId: input.threadId,
                    turnId,
                    itemId: assistantItemId,
                  }),
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
                ...providerEventBase({
                  threadId: input.threadId,
                  turnId,
                  itemId: assistantItemId,
                }),
                type: "content.delta",
                payload: {
                  streamKind: "assistant_text",
                  delta: parsed.content,
                },
              }),
            );
            return;
          }

          if (parsed.type === "tool_use" && parsed.tool_id && parsed.tool_name) {
            await Effect.runPromise(
              emit({
                ...providerEventBase({
                  threadId: input.threadId,
                  turnId,
                  itemId: parsed.tool_id,
                }),
                type: "item.started",
                payload: {
                  itemType: "dynamic_tool_call",
                  title: parsed.tool_name,
                  ...(parsed.parameters
                    ? { detail: JSON.stringify(parsed.parameters).slice(0, 180) }
                    : {}),
                },
              }),
            );
            return;
          }

          if (parsed.type === "tool_result" && parsed.tool_id) {
            await Effect.runPromise(
              emit({
                ...providerEventBase({
                  threadId: input.threadId,
                  turnId,
                  itemId: parsed.tool_id,
                }),
                type: "item.completed",
                payload: {
                  itemType: "dynamic_tool_call",
                  title: "Tool call",
                  ...(parsed.error?.message
                    ? { detail: parsed.error.message }
                    : parsed.output
                      ? { detail: parsed.output.slice(0, 180) }
                      : {}),
                },
              }),
            );
            return;
          }

          if (parsed.type === "error" && parsed.message) {
            await Effect.runPromise(
              emit({
                ...providerEventBase({ threadId: input.threadId, turnId }),
                type: parsed.severity === "error" ? "runtime.error" : "runtime.warning",
                payload:
                  parsed.severity === "error"
                    ? {
                        message: parsed.message,
                      }
                    : {
                        message: parsed.message,
                      },
              }),
            );
            return;
          }

          if (parsed.type === "result") {
            sawResult = true;
            if (parsed.status === "error") {
              turnStatus = sessions.get(input.threadId)?.interrupted ? "interrupted" : "failed";
              turnFailedMessage = rewriteGeminiFailureMessage(
                selectedModel,
                parsed.error?.message ?? "Gemini turn failed.",
              );
              await Effect.runPromise(
                emit({
                  ...providerEventBase({ threadId: input.threadId, turnId }),
                  type: "runtime.error",
                  payload: {
                    message: turnFailedMessage,
                  },
                }),
              );
            }

            if (sawAssistantStart) {
              await Effect.runPromise(
                emit({
                  ...providerEventBase({
                    threadId: input.threadId,
                    turnId,
                    itemId: assistantItemId,
                  }),
                  type: "item.completed",
                  payload: {
                    itemType: "assistant_message",
                    title: "Assistant message",
                  },
                }),
              );
            }

            await Effect.runPromise(
              emit({
                ...providerEventBase({ threadId: input.threadId, turnId }),
                type: "turn.completed",
                payload: {
                  state: turnStatus,
                  ...(parsed.stats !== undefined ? { usage: parsed.stats } : {}),
                  ...(turnFailedMessage ? { errorMessage: turnFailedMessage } : {}),
                },
              }),
            );
            await Effect.runPromise(
              emit({
                ...providerEventBase({ threadId: input.threadId }),
                type: "session.state.changed",
                payload: {
                  state: turnStatus === "failed" ? "error" : "ready",
                  ...(turnFailedMessage ? { reason: turnFailedMessage } : {}),
                },
              }),
            );
            await finishTurn();
          }
        };

        const parseStdoutLines = async () => {
          const lines = stdoutBuffer.split("\n");
          stdoutBuffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              await handleParsedEvent(JSON.parse(trimmed) as GeminiStreamJsonEvent);
            } catch {
              // Ignore non-JSON stdout lines.
            }
          }
        };

        child.stdout.on("data", (chunk: Buffer) => {
          stdoutBuffer += chunk.toString("utf8");
          void parseStdoutLines();
        });

        child.stderr.on("data", (chunk: Buffer) => {
          stderrBuffer += chunk.toString("utf8");
        });

        child.on("error", (error) => {
          turnStatus = state.interrupted ? "interrupted" : "failed";
          turnFailedMessage = rewriteGeminiFailureMessage(selectedModel, error.message);
          void Effect.runPromise(
            emit({
              ...providerEventBase({ threadId: input.threadId, turnId }),
              type: "runtime.error",
              payload: {
                message: turnFailedMessage,
              },
            }),
          );
          resolveTurnStart?.();
          resolveTurnStart = null;
        });

        child.on("close", (code, signal) => {
          void (async () => {
            if (!sawResult) {
              const latest = sessions.get(input.threadId);
              const wasInterrupted = latest?.interrupted === true;
              turnStatus =
                wasInterrupted || signal === "SIGINT"
                  ? "interrupted"
                  : code === 0
                    ? "completed"
                    : "failed";
              turnFailedMessage =
                turnStatus === "failed"
                  ? rewriteGeminiFailureMessage(
                      selectedModel,
                      stderrBuffer.trim() || `Gemini exited with code ${code ?? "null"}.`,
                    )
                  : undefined;

              if (turnFailedMessage) {
                await Effect.runPromise(
                  emit({
                    ...providerEventBase({ threadId: input.threadId, turnId }),
                    type: "runtime.error",
                    payload: {
                      message: turnFailedMessage,
                    },
                  }),
                );
              }

              if (sawAssistantStart) {
                await Effect.runPromise(
                  emit({
                    ...providerEventBase({
                      threadId: input.threadId,
                      turnId,
                      itemId: assistantItemId,
                    }),
                    type: "item.completed",
                    payload: {
                      itemType: "assistant_message",
                      title: "Assistant message",
                    },
                  }),
                );
              }

              await Effect.runPromise(
                emit({
                  ...providerEventBase({ threadId: input.threadId, turnId }),
                  type: "turn.completed",
                  payload: {
                    state: turnStatus,
                    ...(turnFailedMessage ? { errorMessage: turnFailedMessage } : {}),
                  },
                }),
              );
              await Effect.runPromise(
                emit({
                  ...providerEventBase({ threadId: input.threadId }),
                  type: "session.state.changed",
                  payload: {
                    state: turnStatus === "failed" ? "error" : "ready",
                    ...(turnFailedMessage ? { reason: turnFailedMessage } : {}),
                  },
                }),
              );
              await finishTurn();
            }
            resolveTurnStart?.();
            resolveTurnStart = null;
          })().catch(() => undefined);
        });

        sessions.set(input.threadId, {
          ...state,
          currentProcess: child,
          currentTurnId: turnId,
          currentAssistantItemId: assistantItemId,
          interrupted: false,
          session: {
            ...state.session,
            status: "running",
            activeTurnId: turnId,
            updatedAt: nowIso(),
            ...(input.model ? { model: input.model } : {}),
          },
        });

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
                payload: input.model ? { model: input.model } : {},
              }),
            ],
            { concurrency: "unbounded" },
          ),
        );

        await Promise.race([
          turnStartedPromise,
          new Promise<void>((resolve) => {
            setTimeout(resolve, 2_000);
          }),
        ]);

        const latest = sessions.get(input.threadId);
        const latestResumeCursor = decodeResumeCursor(latest?.session.resumeCursor);

        return {
          threadId: input.threadId,
          turnId,
          ...(latestResumeCursor ? { resumeCursor: latestResumeCursor } : {}),
        } satisfies ProviderTurnStartResult;
      },
      catch: (cause) =>
        isProviderAdapterRequestError(cause) ||
        isProviderAdapterSessionNotFoundError(cause) ||
        isProviderAdapterSessionClosedError(cause)
          ? cause
          : toRuntimeError(input.threadId, "Unable to start Gemini turn.", cause),
    });

  const interruptTurn: GeminiAdapterShape["interruptTurn"] = (threadId) =>
    Effect.try({
      try: () => {
        const state = sessions.get(threadId);
        if (!state) {
          throw new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }
        if (!state.currentProcess) {
          return;
        }
        sessions.set(threadId, {
          ...state,
          interrupted: true,
        });
        state.currentProcess.kill("SIGINT");
      },
      catch: (cause) =>
        isProviderAdapterSessionNotFoundError(cause)
          ? cause
          : toRuntimeError(threadId, "Unable to interrupt Gemini turn.", cause),
    });

  const respondToRequest: GeminiAdapterShape["respondToRequest"] = (threadId) =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "respondToRequest",
        detail: `Gemini does not expose resumable approval requests for thread ${threadId}.`,
      }),
    );

  const respondToUserInput: GeminiAdapterShape["respondToUserInput"] = (threadId) =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "respondToUserInput",
        detail: `Gemini does not expose resumable user-input requests for thread ${threadId}.`,
      }),
    );

  const stopSession: GeminiAdapterShape["stopSession"] = (threadId) =>
    Effect.tryPromise({
      try: async () => {
        const state = sessions.get(threadId);
        if (!state) {
          throw new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          });
        }
        if (state.currentProcess) {
          state.currentProcess.kill("SIGTERM");
        }
        sessions.delete(threadId);
        await Effect.runPromise(
          emit({
            ...providerEventBase({ threadId }),
            type: "session.exited",
            payload: {
              reason: "Session stopped",
              recoverable: true,
              exitKind: "graceful",
            },
          }),
        );
      },
      catch: (cause) =>
        isProviderAdapterSessionNotFoundError(cause)
          ? cause
          : toRuntimeError(threadId, "Unable to stop Gemini session.", cause),
    });

  const listSessions: GeminiAdapterShape["listSessions"] = () =>
    Effect.sync(() => Array.from(sessions.values(), (entry) => entry.session));

  const hasSession: GeminiAdapterShape["hasSession"] = (threadId) =>
    Effect.sync(() => sessions.has(threadId));

  const readThread: GeminiAdapterShape["readThread"] = (threadId) =>
    Effect.sync(() => ({
      threadId,
      turns: [],
    }));

  const rollbackThread: GeminiAdapterShape["rollbackThread"] = (threadId) =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "rollbackThread",
        detail: `Gemini rollback is not supported for thread ${threadId}.`,
      }),
    );

  const stopAll: GeminiAdapterShape["stopAll"] = () =>
    Effect.tryPromise({
      try: async () => {
        const threadIds = Array.from(sessions.keys());
        await Promise.all(
          threadIds.map(async (threadId) => {
            const state = sessions.get(threadId);
            if (state?.currentProcess) {
              state.currentProcess.kill("SIGTERM");
            }
            sessions.delete(threadId);
          }),
        );
      },
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "stopAll",
          detail: cause instanceof Error ? cause.message : "Unable to stop Gemini sessions.",
          cause,
        }),
    });

  const service = {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "in-session",
    },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromQueue(runtimeEventQueue),
  } satisfies GeminiAdapterShape;

  return service;
});

export const GeminiAdapterLive = Layer.effect(GeminiAdapter, makeGeminiAdapter);
