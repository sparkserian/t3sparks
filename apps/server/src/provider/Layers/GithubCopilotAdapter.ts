/**
 * GithubCopilotAdapterLive — GitHub Copilot CLI provider adapter.
 *
 * **Status: SCAFFOLD.** The provider kind, settings wiring, binary probe,
 * model picker UX, and adapter registry hookup all work end-to-end. The
 * actual ACP-over-stdio runtime (session streaming, tool calls, approvals)
 * is **not yet implemented** — `startSession` fails with a clear
 * `ProviderAdapterRequestError` directing the user to finish the port in a
 * dedicated session.
 *
 * This scaffold intentionally mirrors the shape of {@link CursorAdapterLive}
 * so the real implementation can be dropped in without further plumbing.
 *
 * @module GithubCopilotAdapterLive
 */
import type {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderTurnStartResult,
  ProviderUserInputAnswers,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, Stream } from "effect";

import { ProviderAdapterRequestError, ProviderAdapterSessionNotFoundError } from "../Errors.ts";
import {
  GithubCopilotAdapter,
  type GithubCopilotAdapterShape,
} from "../Services/GithubCopilotAdapter.ts";

const PROVIDER = "githubCopilot" as const;
const NOT_IMPLEMENTED_DETAIL =
  "GitHub Copilot CLI runtime adapter is not yet ported. Use another provider (Codex, Claude, Cursor, OpenCode) for now.";

const makeGithubCopilotAdapter = Effect.fn("makeGithubCopilotAdapter")(function* () {
  const runtimeEventPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<ProviderRuntimeEvent>(),
    PubSub.shutdown,
  );

  const notImplemented = <A>(method: string): Effect.Effect<A, ProviderAdapterRequestError> =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method,
        detail: NOT_IMPLEMENTED_DETAIL,
      }),
    );

  const startSession: GithubCopilotAdapterShape["startSession"] = (
    _input: ProviderSessionStartInput,
  ) => notImplemented<ProviderSession>("startSession");

  const sendTurn: GithubCopilotAdapterShape["sendTurn"] = (_input: ProviderSendTurnInput) =>
    notImplemented<ProviderTurnStartResult>("sendTurn");

  const interruptTurn: GithubCopilotAdapterShape["interruptTurn"] = (
    _threadId: ThreadId,
    _turnId?: TurnId,
  ) => notImplemented<void>("interruptTurn");

  const respondToRequest: GithubCopilotAdapterShape["respondToRequest"] = (
    _threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _decision: ProviderApprovalDecision,
  ) => notImplemented<void>("respondToRequest");

  const respondToUserInput: GithubCopilotAdapterShape["respondToUserInput"] = (
    _threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _answers: ProviderUserInputAnswers,
  ) => notImplemented<void>("respondToUserInput");

  const stopSession: GithubCopilotAdapterShape["stopSession"] = (_threadId: ThreadId) =>
    Effect.void;

  const listSessions: GithubCopilotAdapterShape["listSessions"] = () =>
    Effect.succeed([] as ReadonlyArray<ProviderSession>);

  const hasSession: GithubCopilotAdapterShape["hasSession"] = (_threadId: ThreadId) =>
    Effect.succeed(false);

  const readThread: GithubCopilotAdapterShape["readThread"] = (threadId: ThreadId) =>
    Effect.fail(
      new ProviderAdapterSessionNotFoundError({
        provider: PROVIDER,
        threadId,
      }),
    );

  const rollbackThread: GithubCopilotAdapterShape["rollbackThread"] = (
    threadId: ThreadId,
    _numTurns: number,
  ) =>
    Effect.fail(
      new ProviderAdapterSessionNotFoundError({
        provider: PROVIDER,
        threadId,
      }),
    );

  const stopAll: GithubCopilotAdapterShape["stopAll"] = () => Effect.void;

  const streamEvents = Stream.fromPubSub(runtimeEventPubSub);

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "unsupported" as const },
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
    streamEvents,
  } satisfies GithubCopilotAdapterShape;
});

export const GithubCopilotAdapterLive = Layer.effect(
  GithubCopilotAdapter,
  makeGithubCopilotAdapter(),
);
