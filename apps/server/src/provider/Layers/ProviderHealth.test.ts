import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer, Sink, Stream } from "effect";
import * as PlatformError from "effect/PlatformError";
import { ChildProcessSpawner } from "effect/unstable/process";
import { expect } from "vitest";

import {
  checkCodexProviderStatus,
  makeCheckCopilotProviderStatus,
  mapCopilotModel,
  mapCopilotQuotaSnapshots,
  parseAuthStatusFromOutput,
} from "./ProviderHealth";

// ── Test helpers ────────────────────────────────────────────────────

const encoder = new TextEncoder();

function mockHandle(result: { stdout: string; stderr: string; code: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout)),
    stderr: Stream.make(encoder.encode(result.stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockSpawnerLayer(
  handler: (args: ReadonlyArray<string>) => { stdout: string; stderr: string; code: number },
) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const cmd = command as unknown as { args: ReadonlyArray<string> };
      return Effect.succeed(mockHandle(handler(cmd.args)));
    }),
  );
}

function failingSpawnerLayer(description: string) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() =>
      Effect.fail(
        PlatformError.systemError({
          _tag: "NotFound",
          module: "ChildProcess",
          method: "spawn",
          description,
        }),
      ),
    ),
  );
}

// ── Tests ───────────────────────────────────────────────────────────

it.effect("returns ready when codex is installed and authenticated", () =>
  Effect.gen(function* () {
    const status = yield* checkCodexProviderStatus;
    assert.strictEqual(status.provider, "codex");
    assert.strictEqual(status.status, "ready");
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.authStatus, "authenticated");
  }).pipe(
    Effect.provide(
      mockSpawnerLayer((args) => {
        const joined = args.join(" ");
        if (joined === "--version") return { stdout: "codex 1.0.0\n", stderr: "", code: 0 };
        if (joined === "login status") return { stdout: "Logged in\n", stderr: "", code: 0 };
        throw new Error(`Unexpected args: ${joined}`);
      }),
    ),
  ),
);

it.effect("returns unavailable when codex is missing", () =>
  Effect.gen(function* () {
    const status = yield* checkCodexProviderStatus;
    assert.strictEqual(status.provider, "codex");
    assert.strictEqual(status.status, "error");
    assert.strictEqual(status.available, false);
    assert.strictEqual(status.authStatus, "unknown");
    assert.strictEqual(status.message, "Codex CLI (`codex`) is not installed or not on PATH.");
  }).pipe(Effect.provide(failingSpawnerLayer("spawn codex ENOENT"))),
);

it.effect("returns unauthenticated when auth probe reports login required", () =>
  Effect.gen(function* () {
    const status = yield* checkCodexProviderStatus;
    assert.strictEqual(status.provider, "codex");
    assert.strictEqual(status.status, "error");
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.authStatus, "unauthenticated");
    assert.strictEqual(
      status.message,
      "Codex CLI is not authenticated. Run `codex login` and try again.",
    );
  }).pipe(
    Effect.provide(
      mockSpawnerLayer((args) => {
        const joined = args.join(" ");
        if (joined === "--version") return { stdout: "codex 1.0.0\n", stderr: "", code: 0 };
        if (joined === "login status") {
          return { stdout: "", stderr: "Not logged in. Run codex login.", code: 1 };
        }
        throw new Error(`Unexpected args: ${joined}`);
      }),
    ),
  ),
);

it.effect(
  "returns unauthenticated when login status output includes 'not logged in'",
  () =>
    Effect.gen(function* () {
      const status = yield* checkCodexProviderStatus;
      assert.strictEqual(status.provider, "codex");
      assert.strictEqual(status.status, "error");
      assert.strictEqual(status.available, true);
      assert.strictEqual(status.authStatus, "unauthenticated");
      assert.strictEqual(
        status.message,
        "Codex CLI is not authenticated. Run `codex login` and try again.",
      );
    }).pipe(
      Effect.provide(
        mockSpawnerLayer((args) => {
          const joined = args.join(" ");
          if (joined === "--version") return { stdout: "codex 1.0.0\n", stderr: "", code: 0 };
          if (joined === "login status")
            return { stdout: "Not logged in\n", stderr: "", code: 1 };
          throw new Error(`Unexpected args: ${joined}`);
        }),
      ),
    ),
);

it.effect("returns warning when login status command is unsupported", () =>
  Effect.gen(function* () {
    const status = yield* checkCodexProviderStatus;
    assert.strictEqual(status.provider, "codex");
    assert.strictEqual(status.status, "warning");
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.authStatus, "unknown");
    assert.strictEqual(
      status.message,
      "Codex CLI authentication status command is unavailable in this Codex version.",
    );
  }).pipe(
    Effect.provide(
      mockSpawnerLayer((args) => {
        const joined = args.join(" ");
        if (joined === "--version") return { stdout: "codex 1.0.0\n", stderr: "", code: 0 };
        if (joined === "login status") {
          return { stdout: "", stderr: "error: unknown command 'login'", code: 2 };
        }
        throw new Error(`Unexpected args: ${joined}`);
      }),
    ),
  ),
);

it.effect("returns authenticated copilot status with models and quota metadata", () =>
  Effect.gen(function* () {
    const status = yield* makeCheckCopilotProviderStatus(async () => ({
      status: {
        version: "1.0.7",
      },
      authStatus: {
        isAuthenticated: true,
      },
      models: [
        {
          id: "gpt-5.4",
          name: "GPT-5.4",
          supportedReasoningEfforts: ["medium", "high"],
          defaultReasoningEffort: "high",
          billing: { multiplier: 2 },
        } as never,
      ],
      quota: {
        quotaSnapshots: {
          premium_interactions: {
            entitlementRequests: 100,
            usedRequests: 25,
            remainingPercentage: 75,
            overage: 0,
            overageAllowedWithExhaustedQuota: false,
            resetDate: "2026-04-01T00:00:00.000Z",
          },
        },
      },
    }));
    assert.strictEqual(status.provider, "githubCopilot");
    assert.strictEqual(status.status, "ready");
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.authStatus, "authenticated");
    assert.deepEqual(status.models, [
      {
        id: "copilot:gpt-5.4",
        name: "GPT-5.4",
        supportsReasoningEffort: true,
        supportedReasoningEfforts: ["medium", "high"],
        defaultReasoningEffort: "high",
        billingMultiplier: 2,
      },
    ]);
    assert.deepEqual(status.quotaSnapshots, [
      {
        key: "premium_interactions",
        entitlementRequests: 100,
        usedRequests: 25,
        remainingRequests: 75,
        remainingPercentage: 75,
        overage: 0,
        overageAllowedWithExhaustedQuota: false,
        resetDate: "2026-04-01T00:00:00.000Z",
      },
    ]);
  }),
);

it.effect("returns unavailable when github copilot health probe fails", () =>
  Effect.gen(function* () {
    const status = yield* makeCheckCopilotProviderStatus(async () => {
      throw new Error("spawn copilot ENOENT");
    });
    assert.strictEqual(status.provider, "githubCopilot");
    assert.strictEqual(status.status, "error");
    assert.strictEqual(status.available, false);
  }),
);

// ── Pure function tests ─────────────────────────────────────────────

it("parseAuthStatusFromOutput: exit code 0 with no auth markers is ready", () => {
  const parsed = parseAuthStatusFromOutput({ stdout: "OK\n", stderr: "", code: 0 });
  assert.strictEqual(parsed.status, "ready");
  assert.strictEqual(parsed.authStatus, "authenticated");
});

it("parseAuthStatusFromOutput: JSON with authenticated=false is unauthenticated", () => {
  const parsed = parseAuthStatusFromOutput({
    stdout: '[{"authenticated":false}]\n',
    stderr: "",
    code: 0,
  });
  assert.strictEqual(parsed.status, "error");
  assert.strictEqual(parsed.authStatus, "unauthenticated");
});

it("parseAuthStatusFromOutput: JSON without auth marker but exit code 0 is ready", () => {
  const parsed = parseAuthStatusFromOutput({
    stdout: '[{"ok":true}]\n',
    stderr: "",
    code: 0,
  });
  assert.strictEqual(parsed.status, "ready");
  assert.strictEqual(parsed.authStatus, "authenticated");
});

it("parseAuthStatusFromOutput: JSON without auth marker and non-zero exit code is warning", () => {
  const parsed = parseAuthStatusFromOutput({
    stdout: '[{"ok":true}]\n',
    stderr: "",
    code: 1,
  });
  assert.strictEqual(parsed.status, "warning");
  assert.strictEqual(parsed.authStatus, "unknown");
});

it("parseAuthStatusFromOutput: positive 'logged in' text is authenticated", () => {
  const parsed = parseAuthStatusFromOutput({
    stdout: "You are logged in as user@example.com\n",
    stderr: "",
    code: 0,
  });
  assert.strictEqual(parsed.status, "ready");
  assert.strictEqual(parsed.authStatus, "authenticated");
});

it("parseAuthStatusFromOutput: 'authenticated' text is authenticated", () => {
  const parsed = parseAuthStatusFromOutput({
    stdout: "Authenticated successfully.\n",
    stderr: "",
    code: 0,
  });
  assert.strictEqual(parsed.status, "ready");
  assert.strictEqual(parsed.authStatus, "authenticated");
});

it("mapCopilotModel prefixes GitHub Copilot model ids", () => {
  expect(
    mapCopilotModel({
      id: "claude-opus-4.6",
      name: "Claude Opus 4.6",
      supportedReasoningEfforts: [],
    } as never),
  ).toEqual({
    id: "copilot:claude-opus-4.6",
    name: "Claude Opus 4.6",
    supportsReasoningEffort: false,
  });
});

it("mapCopilotQuotaSnapshots sorts and derives remaining requests", () => {
  expect(
    mapCopilotQuotaSnapshots({
      chat: {
        entitlementRequests: 50,
        usedRequests: 10,
        remainingPercentage: 80,
        overage: 0,
        overageAllowedWithExhaustedQuota: false,
      },
      premium_interactions: {
        entitlementRequests: 10,
        usedRequests: 2,
        remainingPercentage: 80,
        overage: 0,
        overageAllowedWithExhaustedQuota: false,
      },
    }),
  ).toEqual([
    {
      key: "premium_interactions",
      entitlementRequests: 10,
      usedRequests: 2,
      remainingRequests: 8,
      remainingPercentage: 80,
      overage: 0,
      overageAllowedWithExhaustedQuota: false,
    },
    {
      key: "chat",
      entitlementRequests: 50,
      usedRequests: 10,
      remainingRequests: 40,
      remainingPercentage: 80,
      overage: 0,
      overageAllowedWithExhaustedQuota: false,
    },
  ]);
});
