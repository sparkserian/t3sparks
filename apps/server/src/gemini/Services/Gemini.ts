import type { GeminiStatusResult } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { GeminiError } from "../Errors.ts";

export interface GeminiShape {
  readonly getStatus: (input: {
    readonly cwd: string;
  }) => Effect.Effect<GeminiStatusResult, GeminiError>;
}

export class Gemini extends ServiceMap.Service<Gemini, GeminiShape>()("t3/gemini/Services/Gemini") {}
