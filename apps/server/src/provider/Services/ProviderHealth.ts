/**
 * ProviderHealth - Provider readiness snapshot service.
 *
 * Owns provider health checks (install/auth reachability), keeps a cached
 * snapshot, and exposes refresh hooks to transport layers.
 *
 * @module ProviderHealth
 */
import type { ProviderKind, ServerProviderStatus } from "@t3sparks/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface ProviderHealthShape {
  /**
   * Read the current cached provider health snapshot.
   */
  readonly getStatuses: Effect.Effect<ReadonlyArray<ServerProviderStatus>>;
  /**
   * Re-run a single provider health check and update the cached snapshot.
   */
  readonly checkStatus: (
    provider: ProviderKind,
  ) => Effect.Effect<ServerProviderStatus, Error | never>;
}

export class ProviderHealth extends ServiceMap.Service<ProviderHealth, ProviderHealthShape>()(
  "t3sparks/provider/Services/ProviderHealth",
) {}
