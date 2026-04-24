/**
 * Convex - Effect service contract for detecting Convex project status.
 */
import { Context } from "effect";
import type { Effect } from "effect";

import type { ConvexStatusError, ConvexStatusInput, ConvexStatusResult } from "@t3tools/contracts";

export interface ConvexShape {
  readonly getStatus: (
    input: ConvexStatusInput,
  ) => Effect.Effect<ConvexStatusResult, ConvexStatusError>;
}

export class Convex extends Context.Service<Convex, ConvexShape>()("t3/convex/Services/Convex") {}
