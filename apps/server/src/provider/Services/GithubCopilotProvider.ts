import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider.ts";

export interface GithubCopilotProviderShape extends ServerProviderShape {}

export class GithubCopilotProvider extends Context.Service<
  GithubCopilotProvider,
  GithubCopilotProviderShape
>()("t3/provider/Services/GithubCopilotProvider") {}
