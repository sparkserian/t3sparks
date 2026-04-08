import { randomUUID } from "node:crypto";

import { query, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { approveAll, CopilotClient } from "@github/copilot-sdk";
import { Effect, FileSystem, Layer, Option, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { toGitHubCopilotModelId } from "@t3sparks/shared/model";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3sparks/shared/git";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { resolveCopilotBinary } from "../../provider/Layers/copilotBinary.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  type BranchNameGenerationInput,
  type BranchNameGenerationResult,
  type CommitMessageGenerationResult,
  type PrContentGenerationResult,
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";

const CODEX_MODEL = "gpt-5.3-codex";
const CODEX_REASONING_EFFORT = "low";
const CODEX_TIMEOUT_MS = 180_000;
const CLAUDE_TIMEOUT_MS = 180_000;
const COPILOT_TIMEOUT_MS = 180_000;

type GitTextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName";
type SupportedGitTextProvider = "codex" | "claudeAgent" | "githubCopilot";

function toCodexOutputJsonSchema(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return {
      ...document.schema,
      $defs: document.definitions,
    };
  }
  return document.schema;
}

function normalizeCodexError(
  operation: GitTextGenerationOperation,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (Schema.is(TextGenerationError)(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes("Command not found: codex") ||
      lower.includes("spawn codex") ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: "Codex CLI (`codex`) is required but not available on PATH.",
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}

function normalizeClaudeError(
  operation: GitTextGenerationOperation,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (Schema.is(TextGenerationError)(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes("Command not found: claude") ||
      lower.includes("spawn claude") ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: "Claude Code CLI (`claude`) is required but not available on PATH.",
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}

function normalizeCopilotError(
  operation: GitTextGenerationOperation,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (Schema.is(TextGenerationError)(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes("Command not found: copilot") ||
      lower.includes("spawn copilot") ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: "GitHub Copilot CLI (`copilot`) is required but not available on PATH.",
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

function resultErrorsText(result: SDKResultMessage): string {
  return "errors" in result && Array.isArray(result.errors) ? result.errors.join(" ").trim() : "";
}

function extractJsonObjectText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const unfenced = fencedMatch?.[1]?.trim() ?? trimmed;
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  return unfenced.slice(firstBrace, lastBrace + 1);
}

function decodeProviderOutput<S extends Schema.Top & { readonly DecodingServices: never }>(
  operation: GitTextGenerationOperation,
  schema: S,
  value: unknown,
): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(value) as S["Type"],
    catch: (cause) =>
      new TextGenerationError({
        operation,
        detail: "Provider returned invalid structured output.",
        cause,
      }),
  });
}

function resolveSupportedProvider(
  provider: BranchNameGenerationInput["provider"],
): SupportedGitTextProvider {
  if (provider === "claudeAgent" || provider === "githubCopilot") {
    return provider;
  }
  return "codex";
}

function buildCommitPrompt(input: {
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch?: boolean;
}): string {
  const wantsBranch = input.includeBranch === true;
  return [
    "You write concise git commit messages.",
    wantsBranch
      ? "Return a JSON object with keys: subject, body, branch."
      : "Return a JSON object with keys: subject, body.",
    "Rules:",
    "- subject must be imperative, <= 72 chars, and no trailing period",
    "- body can be empty string or short bullet points",
    ...(wantsBranch
      ? ["- branch must be a short semantic git branch fragment for this change"]
      : []),
    "- capture the primary user-visible or developer-visible change",
    "",
    `Branch: ${input.branch ?? "(detached)"}`,
    "",
    "Staged files:",
    limitSection(input.stagedSummary, 6_000),
    "",
    "Staged patch:",
    limitSection(input.stagedPatch, 40_000),
  ].join("\n");
}

function buildPrPrompt(input: {
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
}): string {
  return [
    "You write GitHub pull request content.",
    "Return a JSON object with keys: title, body.",
    "Rules:",
    "- title should be concise and specific",
    "- body must be markdown and include headings '## Summary' and '## Testing'",
    "- under Summary, provide short bullet points",
    "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
    "",
    `Base branch: ${input.baseBranch}`,
    `Head branch: ${input.headBranch}`,
    "",
    "Commits:",
    limitSection(input.commitSummary, 12_000),
    "",
    "Diff stat:",
    limitSection(input.diffSummary, 12_000),
    "",
    "Diff patch:",
    limitSection(input.diffPatch, 40_000),
  ].join("\n");
}

function buildBranchPrompt(input: {
  message: string;
  attachments?: BranchNameGenerationInput["attachments"];
}): string {
  const attachmentLines = (input.attachments ?? []).map(
    (attachment) =>
      `- ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`,
  );

  const promptSections = [
    "You generate concise git branch names.",
    "Return a JSON object with key: branch.",
    "Rules:",
    "- Branch should describe the requested work from the user message.",
    "- Keep it short and specific (2-6 words).",
    "- Use plain words only, no issue prefixes and no punctuation-heavy text.",
    "- If images are attached, use them as primary context for visual/UI issues.",
    "",
    "User message:",
    limitSection(input.message, 8_000),
  ];
  if (attachmentLines.length > 0) {
    promptSections.push("", "Attachment metadata:", limitSection(attachmentLines.join("\n"), 4_000));
  }
  return promptSections.join("\n");
}

const makeCodexTextGeneration = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* Effect.service(ServerConfig);

  type MaterializedImageAttachments = {
    readonly imagePaths: ReadonlyArray<string>;
  };

  const readStreamAsString = <E>(
    operation: GitTextGenerationOperation,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    Effect.gen(function* () {
      let text = "";
      yield* Stream.runForEach(stream, (chunk) =>
        Effect.sync(() => {
          text += Buffer.from(chunk).toString("utf8");
        }),
      ).pipe(
        Effect.mapError((cause) =>
          normalizeCodexError(operation, cause, "Failed to collect process output"),
        ),
      );
      return text;
    });

  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

  const writeTempFile = (
    operation: GitTextGenerationOperation,
    prefix: string,
    content: string,
  ): Effect.Effect<string, TextGenerationError> => {
    const filePath = path.join(tempDir, `t3sparks-${prefix}-${process.pid}-${randomUUID()}.tmp`);
    return fileSystem.writeFileString(filePath, content).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: `Failed to write temp file at ${filePath}.`,
            cause,
          }),
      ),
      Effect.as(filePath),
    );
  };

  const safeUnlink = (filePath: string): Effect.Effect<void, never> =>
    fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void));

  const materializeImageAttachments = (
    attachments: BranchNameGenerationInput["attachments"],
  ): Effect.Effect<MaterializedImageAttachments, TextGenerationError> =>
    Effect.gen(function* () {
      if (!attachments || attachments.length === 0) {
        return { imagePaths: [] };
      }

      const imagePaths: string[] = [];
      for (const attachment of attachments) {
        if (attachment.type !== "image") {
          continue;
        }

        const resolvedPath = resolveAttachmentPath({
          stateDir: serverConfig.stateDir,
          attachment,
        });
        if (!resolvedPath || !path.isAbsolute(resolvedPath)) {
          continue;
        }
        const fileInfo = yield* fileSystem
          .stat(resolvedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!fileInfo || fileInfo.type !== "File") {
          continue;
        }
        imagePaths.push(resolvedPath);
      }
      return { imagePaths };
    });

  const runCodexJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    imagePaths = [],
    cleanupPaths = [],
  }: {
    operation: GitTextGenerationOperation;
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    imagePaths?: ReadonlyArray<string>;
    cleanupPaths?: ReadonlyArray<string>;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const schemaPath = yield* writeTempFile(
        operation,
        "codex-schema",
        JSON.stringify(toCodexOutputJsonSchema(outputSchemaJson)),
      );
      const outputPath = yield* writeTempFile(operation, "codex-output", "");

      const runCodexCommand = Effect.gen(function* () {
        const command = ChildProcess.make(
          "codex",
          [
            "exec",
            "--ephemeral",
            "-s",
            "read-only",
            "--model",
            CODEX_MODEL,
            "--config",
            `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
            "--output-schema",
            schemaPath,
            "--output-last-message",
            outputPath,
            ...imagePaths.flatMap((imagePath) => ["--image", imagePath]),
            "-",
          ],
          {
            cwd,
            shell: process.platform === "win32",
            stdin: {
              stream: Stream.make(new TextEncoder().encode(prompt)),
            },
          },
        );

        const child = yield* commandSpawner
          .spawn(command)
          .pipe(
            Effect.mapError((cause) =>
              normalizeCodexError(operation, cause, "Failed to spawn Codex CLI process"),
            ),
          );

        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            readStreamAsString(operation, child.stdout),
            readStreamAsString(operation, child.stderr),
            child.exitCode.pipe(
              Effect.map((value) => Number(value)),
              Effect.mapError((cause) =>
                normalizeCodexError(operation, cause, "Failed to read Codex CLI exit code"),
              ),
            ),
          ],
          { concurrency: "unbounded" },
        );

        if (exitCode !== 0) {
          const stderrDetail = stderr.trim();
          const stdoutDetail = stdout.trim();
          const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
          return yield* new TextGenerationError({
            operation,
            detail:
              detail.length > 0
                ? `Codex CLI command failed: ${detail}`
                : `Codex CLI command failed with code ${exitCode}.`,
          });
        }
      });

      const cleanup = Effect.all(
        [schemaPath, outputPath, ...cleanupPaths].map((filePath) => safeUnlink(filePath)),
        {
          concurrency: "unbounded",
        },
      ).pipe(Effect.asVoid);

      return yield* Effect.gen(function* () {
        yield* runCodexCommand.pipe(
          Effect.scoped,
          Effect.timeoutOption(CODEX_TIMEOUT_MS),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new TextGenerationError({ operation, detail: "Codex CLI request timed out." }),
                ),
              onSome: () => Effect.void,
            }),
          ),
        );

        return yield* fileSystem.readFileString(outputPath).pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation,
                detail: "Failed to read Codex output file.",
                cause,
              }),
          ),
          Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))),
          Effect.catchTag("SchemaError", (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Codex returned invalid structured output.",
                cause,
              }),
            ),
          ),
        );
      }).pipe(Effect.ensuring(cleanup));
    });

  const runClaudeJson = <S extends Schema.Top & { readonly DecodingServices: never }>({
    operation,
    cwd,
    prompt,
    outputSchema,
    model,
  }: {
    operation: GitTextGenerationOperation;
    cwd: string;
    prompt: string;
    outputSchema: S;
    model?: string | undefined;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.tryPromise({
      try: async () => {
        const queryRuntime = query({
          prompt,
          options: {
            cwd,
            ...(model ? { model } : {}),
            outputFormat: {
              type: "json_schema",
              schema: toCodexOutputJsonSchema(outputSchema) as Record<string, unknown>,
            },
            permissionMode: "plan",
            pathToClaudeCodeExecutable: "claude",
            env: process.env,
            additionalDirectories: [cwd],
          },
        });

        try {
          for await (const message of queryRuntime) {
            if (message.type !== "result") {
              continue;
            }

            if (message.subtype !== "success") {
              throw new Error(resultErrorsText(message) || "Claude request failed.");
            }

            if (message.structured_output !== undefined) {
              return Schema.decodeUnknownSync(outputSchema)(message.structured_output) as S["Type"];
            }

            const jsonText = extractJsonObjectText(message.result);
            if (!jsonText) {
              throw new Error("Claude returned no JSON output.");
            }
            return Schema.decodeUnknownSync(outputSchema)(JSON.parse(jsonText)) as S["Type"];
          }
        } finally {
          queryRuntime.close();
        }

        throw new Error("Claude returned no result.");
      },
      catch: (cause) =>
        normalizeClaudeError(operation, cause, "Claude text generation request failed"),
    }).pipe(
      Effect.timeoutOption(CLAUDE_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new TextGenerationError({ operation, detail: "Claude request timed out." })),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
    );

  const runCopilotJson = <S extends Schema.Top & { readonly DecodingServices: never }>({
    operation,
    cwd,
    prompt,
    outputSchema,
    model,
  }: {
    operation: GitTextGenerationOperation;
    cwd: string;
    prompt: string;
    outputSchema: S;
    model?: string | undefined;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.tryPromise({
      try: async () => {
        const client = new CopilotClient({
          cliPath: resolveCopilotBinary(),
          cwd,
          logLevel: "error",
        });
        const selectedModel = toGitHubCopilotModelId(model);
        let session: Awaited<ReturnType<CopilotClient["createSession"]>> | undefined;

        try {
          await client.start();
          session = await client.createSession({
            ...(selectedModel ? { model: selectedModel } : {}),
            systemMessage: {
              mode: "append",
              content:
                "Return only valid JSON matching the requested schema. Do not include markdown fences or commentary.",
            },
            onPermissionRequest: approveAll,
          });

          const response = await session.sendAndWait({ prompt }, COPILOT_TIMEOUT_MS);
          const content = response?.data.content?.trim() ?? "";
          if (!content) {
            throw new Error("GitHub Copilot returned an empty response.");
          }
          const jsonText = extractJsonObjectText(content);
          if (!jsonText) {
            throw new Error("GitHub Copilot returned no JSON output.");
          }
          return Schema.decodeUnknownSync(outputSchema)(JSON.parse(jsonText)) as S["Type"];
        } finally {
          await session?.disconnect().catch(() => undefined);
          await client.stop().catch(() => []);
        }
      },
      catch: (cause) =>
        normalizeCopilotError(operation, cause, "GitHub Copilot text generation request failed"),
    });

  const runProviderJson = <S extends Schema.Top & { readonly DecodingServices: never }>({
    operation,
    cwd,
    prompt,
    outputSchema,
    provider,
    model,
    imagePaths = [],
    cleanupPaths = [],
  }: {
    operation: GitTextGenerationOperation;
    cwd: string;
    prompt: string;
    outputSchema: S;
    provider?: BranchNameGenerationInput["provider"] | undefined;
    model?: string | undefined;
    imagePaths?: ReadonlyArray<string>;
    cleanupPaths?: ReadonlyArray<string>;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> => {
    const resolvedProvider = resolveSupportedProvider(provider);
    switch (resolvedProvider) {
      case "claudeAgent":
        return runClaudeJson({
          operation,
          cwd,
          prompt,
          outputSchema,
          ...(model ? { model } : {}),
        });
      case "githubCopilot":
        return runCopilotJson({
          operation,
          cwd,
          prompt,
          outputSchema,
          ...(model ? { model } : {}),
        });
      case "codex":
      default:
        return runCodexJson({
          operation,
          cwd,
          prompt,
          outputSchemaJson: outputSchema,
          imagePaths,
          cleanupPaths,
        }).pipe(Effect.flatMap((value) => decodeProviderOutput(operation, outputSchema, value)));
    }
  };

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = (input) => {
    const wantsBranch = input.includeBranch === true;
    const outputSchema = wantsBranch
      ? Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
          branch: Schema.String,
        })
      : Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
        });

    return runProviderJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt: buildCommitPrompt(input),
      outputSchema,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            subject: sanitizeCommitSubject(generated.subject),
            body: generated.body.trim(),
            ...("branch" in generated && typeof generated.branch === "string"
              ? { branch: sanitizeFeatureBranchName(generated.branch) }
              : {}),
          }) satisfies CommitMessageGenerationResult,
      ),
    );
  };

  const generatePrContent: TextGenerationShape["generatePrContent"] = (input) => {
    const outputSchema = Schema.Struct({
      title: Schema.String,
      body: Schema.String,
    });

    return runProviderJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt: buildPrPrompt(input),
      outputSchema,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            title: sanitizePrTitle(generated.title),
            body: generated.body.trim(),
          }) satisfies PrContentGenerationResult,
      ),
    );
  };

  const generateBranchName: TextGenerationShape["generateBranchName"] = (input) =>
    Effect.gen(function* () {
      const { imagePaths } = yield* materializeImageAttachments(input.attachments);
      const outputSchema = Schema.Struct({
        branch: Schema.String,
      });

      const generated = yield* runProviderJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt: buildBranchPrompt(input),
        outputSchema,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        imagePaths,
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      } satisfies BranchNameGenerationResult;
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
  } satisfies TextGenerationShape;
});

export const CodexTextGenerationLive = Layer.effect(TextGeneration, makeCodexTextGeneration);
