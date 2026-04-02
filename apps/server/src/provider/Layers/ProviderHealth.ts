/**
 * ProviderHealthLive - Startup-time provider health checks.
 *
 * Performs one-time provider readiness probes when the server starts and
 * keeps the resulting snapshot in memory for `server.getConfig`.
 *
 * Uses effect's ChildProcessSpawner to run CLI probes natively.
 *
 * @module ProviderHealthLive
 */
import type {
  ProviderKind,
  ServerProviderAuthStatus,
  ServerProviderModel,
  ServerProviderQuotaSnapshot,
  ServerProviderStatus,
  ServerProviderStatusState,
} from "@t3sparks/contracts";
import { normalizeModelSlug } from "@t3sparks/shared/model";
import { CopilotClient, type ModelInfo } from "@github/copilot-sdk";
import { Effect, Layer, Option, Result, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { readConfiguredGeminiAuth, resolveGeminiCli } from "../../gemini/geminiCli.ts";
import { resolveCopilotBinary } from "./copilotBinary.ts";
import { ProviderHealth, type ProviderHealthShape } from "../Services/ProviderHealth";

const DEFAULT_TIMEOUT_MS = 4_000;
const CODEX_PROVIDER = "codex" as const;
const GEMINI_PROVIDER = "gemini" as const;
const GITHUB_COPILOT_PROVIDER = "githubCopilot" as const;

export function getCopilotHealthCheckTimeoutMs(platform: string = process.platform): number {
  return platform === "win32" ? 10_000 : DEFAULT_TIMEOUT_MS;
}

class GeminiProviderHealthError extends Schema.TaggedErrorClass<GeminiProviderHealthError>()(
  "GeminiProviderHealthError",
  {
    cause: Schema.optional(Schema.Defect),
  },
) {}

class CopilotProviderHealthError extends Schema.TaggedErrorClass<CopilotProviderHealthError>()(
  "CopilotProviderHealthError",
  {
    cause: Schema.optional(Schema.Defect),
  },
) {}

// ── Pure helpers ────────────────────────────────────────────────────

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

interface CopilotQuotaSnapshotInfo {
  readonly entitlementRequests: number;
  readonly usedRequests: number;
  readonly remainingPercentage: number;
  readonly overage: number;
  readonly overageAllowedWithExhaustedQuota: boolean;
  readonly resetDate?: string;
}

interface CopilotHealthProbeResult {
  readonly status?:
    | {
        readonly version?: string;
      }
    | undefined;
  readonly authStatus?:
    | {
        readonly isAuthenticated?: boolean;
        readonly statusMessage?: string;
      }
    | undefined;
  readonly models?: ReadonlyArray<ModelInfo> | undefined;
  readonly quota?:
    | {
        readonly quotaSnapshots?: Record<string, CopilotQuotaSnapshotInfo>;
      }
    | undefined;
}

function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isCommandMissingCause(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return (
    lower.includes("command not found: codex") ||
    lower.includes("spawn codex enoent") ||
    lower.includes("enoent") ||
    lower.includes("notfound")
  );
}

function detailFromResult(
  result: CommandResult & { readonly timedOut?: boolean },
): string | undefined {
  if (result.timedOut) return "Timed out while running command.";
  const stderr = nonEmptyTrimmed(result.stderr);
  if (stderr) return stderr;
  const stdout = nonEmptyTrimmed(result.stdout);
  if (stdout) return stdout;
  if (result.code !== 0) {
    return `Command exited with code ${result.code}.`;
  }
  return undefined;
}

const COPILOT_QUOTA_PRIORITY = ["premium_interactions", "chat", "completions"] as const;

function compareCopilotQuotaKeys(left: string, right: string): number {
  const leftPriority = COPILOT_QUOTA_PRIORITY.indexOf(
    left as (typeof COPILOT_QUOTA_PRIORITY)[number],
  );
  const rightPriority = COPILOT_QUOTA_PRIORITY.indexOf(
    right as (typeof COPILOT_QUOTA_PRIORITY)[number],
  );
  const normalizedLeftPriority = leftPriority === -1 ? Number.POSITIVE_INFINITY : leftPriority;
  const normalizedRightPriority = rightPriority === -1 ? Number.POSITIVE_INFINITY : rightPriority;
  return normalizedLeftPriority - normalizedRightPriority || left.localeCompare(right);
}

export function mapCopilotModel(model: ModelInfo): ServerProviderModel {
  return {
    id: normalizeModelSlug(model.id, "githubCopilot") ?? model.id,
    name: model.name,
    supportsReasoningEffort: (model.supportedReasoningEfforts?.length ?? 0) > 0,
    ...(model.supportedReasoningEfforts && model.supportedReasoningEfforts.length > 0
      ? { supportedReasoningEfforts: [...model.supportedReasoningEfforts] }
      : {}),
    ...(model.defaultReasoningEffort
      ? { defaultReasoningEffort: model.defaultReasoningEffort }
      : {}),
    ...(typeof model.billing?.multiplier === "number"
      ? { billingMultiplier: model.billing.multiplier }
      : {}),
  } satisfies ServerProviderModel;
}

export function mapCopilotQuotaSnapshots(
  quotaSnapshots: Record<string, CopilotQuotaSnapshotInfo> | undefined,
): ReadonlyArray<ServerProviderQuotaSnapshot> {
  if (!quotaSnapshots) return [];

  return Object.entries(quotaSnapshots)
    .toSorted(([leftKey], [rightKey]) => compareCopilotQuotaKeys(leftKey, rightKey))
    .map(([key, snapshot]) => {
      const entitlementRequests = Math.max(0, Math.trunc(snapshot.entitlementRequests));
      const usedRequests = Math.max(0, Math.trunc(snapshot.usedRequests));
      const mapped: ServerProviderQuotaSnapshot = {
        key,
        entitlementRequests,
        usedRequests,
        remainingRequests: Math.max(0, entitlementRequests - usedRequests),
        remainingPercentage: snapshot.remainingPercentage,
        overage: Math.max(0, Math.trunc(snapshot.overage)),
        overageAllowedWithExhaustedQuota: snapshot.overageAllowedWithExhaustedQuota,
      };
      return snapshot.resetDate
        ? {
            ...mapped,
            resetDate: snapshot.resetDate,
          }
        : mapped;
    });
}

function extractAuthBoolean(value: unknown): boolean | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthBoolean(entry);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"] as const) {
    if (typeof record[key] === "boolean") return record[key];
  }
  for (const key of ["auth", "status", "session", "account"] as const) {
    const nested = extractAuthBoolean(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function parseAuthStatusFromOutput(result: CommandResult): {
  readonly status: ServerProviderStatusState;
  readonly authStatus: ServerProviderAuthStatus;
  readonly message?: string;
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    lowerOutput.includes("unknown command") ||
    lowerOutput.includes("unrecognized command") ||
    lowerOutput.includes("unexpected argument")
  ) {
    return {
      status: "warning",
      authStatus: "unknown",
      message: "Codex CLI authentication status command is unavailable in this Codex version.",
    };
  }

  if (
    lowerOutput.includes("not logged in") ||
    lowerOutput.includes("login required") ||
    lowerOutput.includes("authentication required") ||
    lowerOutput.includes("run `codex login`") ||
    lowerOutput.includes("run codex login")
  ) {
    return {
      status: "error",
      authStatus: "unauthenticated",
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }

  const parsedAuth = (() => {
    const trimmed = result.stdout.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
      return { attemptedJsonParse: false as const, auth: undefined as boolean | undefined };
    }
    try {
      return {
        attemptedJsonParse: true as const,
        auth: extractAuthBoolean(JSON.parse(trimmed)),
      };
    } catch {
      return { attemptedJsonParse: false as const, auth: undefined as boolean | undefined };
    }
  })();

  if (parsedAuth.auth === true) {
    return { status: "ready", authStatus: "authenticated" };
  }
  if (parsedAuth.auth === false) {
    return {
      status: "error",
      authStatus: "unauthenticated",
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }
  // Positive-match patterns: if the output explicitly confirms auth, return
  // early as authenticated. These run after JSON parsing so structured output
  // like {"authenticated":false} is not misclassified by substring matches.
  if (
    lowerOutput.includes("logged in") ||
    lowerOutput.includes("authenticated") ||
    lowerOutput.includes("active session") ||
    lowerOutput.includes("signed in")
  ) {
    return { status: "ready", authStatus: "authenticated" };
  }
  // If JSON was parsed but no explicit auth marker found, fall through to
  // the exit-code check below rather than immediately returning "unknown".
  // A successful exit code (0) strongly indicates the CLI is authenticated.
  if (parsedAuth.attemptedJsonParse && result.code !== 0) {
    return {
      status: "warning",
      authStatus: "unknown",
      message:
        "Could not verify Codex authentication status from JSON output (missing auth marker).",
    };
  }
  if (result.code === 0) {
    return { status: "ready", authStatus: "authenticated" };
  }

  const detail = detailFromResult(result);
  return {
    status: "warning",
    authStatus: "unknown",
    message: detail
      ? `Could not verify Codex authentication status. ${detail}`
      : "Could not verify Codex authentication status.",
  };
}

// ── Effect-native command execution ─────────────────────────────────

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  Stream.runFold(
    stream,
    () => "",
    (acc, chunk) => acc + new TextDecoder().decode(chunk),
  );

const runCodexCommand = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = ChildProcess.make("codex", [...args], {
      shell: process.platform === "win32",
    });

    const child = yield* spawner.spawn(command);

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    return { stdout, stderr, code: exitCode } satisfies CommandResult;
  }).pipe(Effect.scoped);

const runCommand = (commandName: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = ChildProcess.make(commandName, [...args], {
      shell: process.platform === "win32",
    });

    const child = yield* spawner.spawn(command);
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    return { stdout, stderr, code: exitCode } satisfies CommandResult;
  }).pipe(Effect.scoped);

// ── Health check ────────────────────────────────────────────────────

async function runCopilotHealthProbe(): Promise<CopilotHealthProbeResult> {
  const cliPath = resolveCopilotBinary();
  const client = new CopilotClient({
    ...(cliPath ? { cliPath } : {}),
    logLevel: "error",
  });

  try {
    await client.start();
    const [status, authStatus] = await Promise.all([
      client.getStatus(),
      client.getAuthStatus().catch(() => undefined),
    ]);
    const [models, quota] =
      authStatus?.isAuthenticated === true
        ? await Promise.all([
            client.listModels().catch(() => undefined),
            client.rpc.account.getQuota().catch(() => undefined),
          ])
        : [undefined, undefined];

    return { status, authStatus, models, quota };
  } finally {
    await client.stop().catch(() => []);
  }
}

export const checkCodexProviderStatus: Effect.Effect<
  ServerProviderStatus,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const checkedAt = new Date().toISOString();

  // Probe 1: `codex --version` — is the CLI reachable?
  const versionProbe = yield* runCodexCommand(["--version"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return {
      provider: CODEX_PROVIDER,
      status: "error" as const,
      available: false,
      authStatus: "unknown" as const,
      checkedAt,
      message: isCommandMissingCause(error)
        ? "Codex CLI (`codex`) is not installed or not on PATH."
        : `Failed to execute Codex CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }

  if (Option.isNone(versionProbe.success)) {
    return {
      provider: CODEX_PROVIDER,
      status: "error" as const,
      available: false,
      authStatus: "unknown" as const,
      checkedAt,
      message: "Codex CLI is installed but failed to run. Timed out while running command.",
    };
  }

  const version = versionProbe.success.value;
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return {
      provider: CODEX_PROVIDER,
      status: "error" as const,
      available: false,
      authStatus: "unknown" as const,
      checkedAt,
      message: detail
        ? `Codex CLI is installed but failed to run. ${detail}`
        : "Codex CLI is installed but failed to run.",
    };
  }

  // Probe 2: `codex login status` — is the user authenticated?
  const authProbe = yield* runCodexCommand(["login", "status"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(authProbe)) {
    const error = authProbe.failure;
    return {
      provider: CODEX_PROVIDER,
      status: "warning" as const,
      available: true,
      authStatus: "unknown" as const,
      checkedAt,
      message:
        error instanceof Error
          ? `Could not verify Codex authentication status: ${error.message}.`
          : "Could not verify Codex authentication status.",
    };
  }

  if (Option.isNone(authProbe.success)) {
    return {
      provider: CODEX_PROVIDER,
      status: "warning" as const,
      available: true,
      authStatus: "unknown" as const,
      checkedAt,
      message: "Could not verify Codex authentication status. Timed out while running command.",
    };
  }

  const parsed = parseAuthStatusFromOutput(authProbe.success.value);
  return {
    provider: CODEX_PROVIDER,
    status: parsed.status,
    available: true,
    authStatus: parsed.authStatus,
    checkedAt,
    ...(parsed.message ? { message: parsed.message } : {}),
  } satisfies ServerProviderStatus;
});

export const checkGeminiProviderStatus: Effect.Effect<ServerProviderStatus, never> = Effect.tryPromise({
  try: async () => {
    const checkedAt = new Date().toISOString();
    const [resolution, auth] = await Promise.all([resolveGeminiCli(), readConfiguredGeminiAuth()]);

    if (!resolution.available) {
      return {
        provider: GEMINI_PROVIDER,
        status: "error" as const,
        available: false,
        authStatus: "unknown" as const,
        checkedAt,
        message: resolution.message ?? "Gemini CLI is unavailable.",
      } satisfies ServerProviderStatus;
    }

    const status: ServerProviderStatusState =
      auth.authStatus === "unauthenticated" || resolution.installed === false ? "warning" : "ready";
    const message =
      auth.authStatus === "unauthenticated"
        ? `Gemini needs sign-in. Run \`${resolution.setupCommand}\` and choose "Login with Google".`
        : resolution.installed === false
          ? resolution.message
          : undefined;

    return {
      provider: GEMINI_PROVIDER,
      status,
      available: true,
      authStatus: auth.authStatus,
      checkedAt,
      ...(message ? { message } : {}),
    } satisfies ServerProviderStatus;
  },
  catch: (cause) => new GeminiProviderHealthError({ cause }),
}).pipe(
  Effect.match({
    onFailure: () =>
      ({
        provider: GEMINI_PROVIDER,
        status: "warning" as const,
        available: true,
        authStatus: "unknown" as const,
        checkedAt: new Date().toISOString(),
        message: "Could not determine Gemini provider status.",
      }) satisfies ServerProviderStatus,
    onSuccess: (status) => status,
  }),
);

export function makeCheckCopilotProviderStatus(
  probe: () => Promise<CopilotHealthProbeResult> = runCopilotHealthProbe,
  timeoutMs: number = getCopilotHealthCheckTimeoutMs(),
): Effect.Effect<ServerProviderStatus, never> {
  return Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const result = yield* Effect.tryPromise({
      try: probe,
      catch: (cause) => new CopilotProviderHealthError({ cause }),
    }).pipe(Effect.timeoutOption(timeoutMs), Effect.result);

    if (Result.isFailure(result)) {
      const error = result.failure;
      return {
        provider: GITHUB_COPILOT_PROVIDER,
        status: "error" as const,
        available: false,
        authStatus: "unknown" as const,
        checkedAt,
        message:
          error instanceof Error
            ? `Failed to start GitHub Copilot CLI health check: ${error.message}.`
            : "Failed to start GitHub Copilot CLI health check.",
      } satisfies ServerProviderStatus;
    }

    if (Option.isNone(result.success)) {
      return {
        provider: GITHUB_COPILOT_PROVIDER,
        status: "warning" as const,
        available: true,
        authStatus: "unknown" as const,
        checkedAt,
        message:
          "GitHub Copilot SDK health check timed out while starting the client. Copilot chats may still work, but SDK-only metadata was not confirmed.",
      } satisfies ServerProviderStatus;
    }

    const probeResult = result.success.value;
    const authStatus: ServerProviderAuthStatus =
      probeResult.authStatus?.isAuthenticated === true
        ? "authenticated"
        : probeResult.authStatus?.isAuthenticated === false
          ? "unauthenticated"
          : "unknown";
    const status: ServerProviderStatusState =
      authStatus === "unauthenticated" ? "error" : authStatus === "unknown" ? "warning" : "ready";
    const quotaSnapshots = mapCopilotQuotaSnapshots(probeResult.quota?.quotaSnapshots);

    return {
      provider: GITHUB_COPILOT_PROVIDER,
      status,
      available: true,
      authStatus,
      checkedAt,
      ...(probeResult.models && probeResult.models.length > 0
        ? { models: probeResult.models.map(mapCopilotModel) }
        : {}),
      ...(quotaSnapshots.length > 0 ? { quotaSnapshots } : {}),
      ...(probeResult.authStatus?.statusMessage
        ? { message: probeResult.authStatus.statusMessage }
        : probeResult.status?.version
          ? { message: `GitHub Copilot CLI ${probeResult.status.version}` }
          : {}),
    } satisfies ServerProviderStatus;
  });
}

export const checkCopilotProviderStatus = makeCheckCopilotProviderStatus();

// ── Layer ───────────────────────────────────────────────────────────

export const ProviderHealthLive = Layer.effect(
  ProviderHealth,
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const statusesRef = yield* Effect.sync(() =>
      new Map<ProviderKind, ServerProviderStatus>(),
    );
    const seedStatuses = yield* Effect.all([
      checkCodexProviderStatus,
      checkGeminiProviderStatus,
      checkCopilotProviderStatus,
      Effect.succeed({
        provider: "claudeAgent",
        status: "ready",
        available: true,
        authStatus: "unknown",
        checkedAt: new Date().toISOString(),
        message: "Claude availability is determined at session start.",
      } satisfies ServerProviderStatus),
    ]);
    for (const status of seedStatuses) {
      statusesRef.set(status.provider, status);
    }
    const providerOrder = [
      CODEX_PROVIDER,
      GEMINI_PROVIDER,
      "claudeAgent",
      GITHUB_COPILOT_PROVIDER,
    ] satisfies ReadonlyArray<ProviderKind>;

    return {
      getStatuses: Effect.sync(() =>
        providerOrder
          .map((provider) => statusesRef.get(provider))
          .filter((status): status is ServerProviderStatus => status !== undefined),
      ),
      checkStatus: (provider) =>
        (provider === CODEX_PROVIDER
          ? checkCodexProviderStatus.pipe(
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
            )
          : provider === GEMINI_PROVIDER
            ? checkGeminiProviderStatus
            : provider === GITHUB_COPILOT_PROVIDER
              ? checkCopilotProviderStatus
              : Effect.succeed({
                  provider: "claudeAgent",
                  status: "ready",
                  available: true,
                  authStatus: "unknown",
                  checkedAt: new Date().toISOString(),
                  message: "Claude availability is determined at session start.",
                } satisfies ServerProviderStatus)).pipe(
          Effect.tap((status) =>
            Effect.sync(() => {
              statusesRef.set(provider, status);
            }),
          ),
        ),
    } satisfies ProviderHealthShape;
  }),
);
