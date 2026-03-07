import type { GeminiStatusResult } from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { GeminiError } from "../Errors.ts";
import {
  getGeminiSettingsPath,
  readConfiguredGeminiAuth,
  resolveGeminiCli,
} from "../geminiCli.ts";
import { Gemini, type GeminiShape } from "../Services/Gemini.ts";

const makeGemini = Effect.sync(() => {
  const service = {
    getStatus: ({ cwd }) =>
      Effect.tryPromise({
        try: async () => {
          const [resolution, auth] = await Promise.all([
            resolveGeminiCli(),
            readConfiguredGeminiAuth(),
          ]);

          const message =
            !resolution.available
              ? resolution.message
              : auth.authStatus === "unauthenticated"
                ? `Sign in with Google by running \`${resolution.setupCommand}\`.`
                : resolution.message;

          return {
            cwd,
            available: resolution.available,
            installed: resolution.installed,
            executableCommand: resolution.executableCommand,
            setupCommand: resolution.setupCommand,
            headlessCommand: resolution.headlessCommand,
            settingsPath: getGeminiSettingsPath(),
            authType: auth.authType,
            authStatus: auth.authStatus,
            ...(message ? { message } : {}),
          } satisfies GeminiStatusResult;
        },
        catch: (cause) =>
          Schema.is(GeminiError)(cause)
            ? cause
            : new GeminiError({
                message: "Unable to determine Gemini CLI status.",
                cause,
              }),
      }),
  } satisfies GeminiShape;

  return service;
});

export const GeminiLive = Layer.effect(Gemini, makeGemini);
