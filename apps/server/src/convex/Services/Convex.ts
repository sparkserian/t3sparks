import type { ConvexStatusResult } from "@t3sparks/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ConvexError } from "../Errors.ts";

export interface ConvexShape {
  readonly getStatus: (input: {
    readonly cwd: string;
  }) => Effect.Effect<ConvexStatusResult, ConvexError>;
}

export class Convex extends ServiceMap.Service<Convex, ConvexShape>()("t3sparks/convex/Services/Convex") {}
