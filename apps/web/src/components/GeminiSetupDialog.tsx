import type { GeminiStatusResult } from "@t3tools/contracts";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

function authLabel(authType: string | null | undefined): string {
  if (!authType) return "Not configured";
  if (authType === "oauth-personal") return "Google account";
  if (authType === "gemini-api-key") return "Gemini API key";
  if (authType === "vertex-ai") return "Vertex AI";
  return authType;
}

export default function GeminiSetupDialog(props: {
  open: boolean;
  status: GeminiStatusResult | null | undefined;
  isRefreshing: boolean;
  onOpenChange: (open: boolean) => void;
  onRunSetup: () => void;
  onRefresh: () => void;
  onOpenDocs: () => void;
}) {
  const status = props.status;
  const needsSetup = !status || !status.available || status.authStatus === "unauthenticated";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl bg-card/96 shadow-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Set up Gemini</DialogTitle>
          <DialogDescription>
            Connect Gemini once, then use Gemini models from the normal provider and model picker.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-muted/35 p-4">
            <p className="text-sm font-medium text-foreground">What happens next</p>
            <p className="mt-1 text-sm text-muted-foreground">
              T3 Sparks opens the official Gemini CLI in a terminal for this project. Gemini should
              prompt for <span className="font-medium text-foreground">Login with Google</span> and
              open your browser for authorization.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground/70">
                Command
              </p>
              <p className="mt-2 break-all font-mono text-xs text-foreground">
                {status?.setupCommand ?? "Checking Gemini CLI..."}
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground/70">
                Auth
              </p>
              <p className="mt-2 text-sm text-foreground">{authLabel(status?.authType)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {status?.authStatus === "authenticated"
                  ? "Configured and ready for headless Gemini runs."
                  : status?.authStatus === "unknown"
                    ? "Configured, but T3 Sparks will verify it on the first Gemini run."
                    : "Not signed in yet."}
              </p>
            </div>
          </div>

          {status?.message ? (
            <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm text-muted-foreground">
              {status.message}
            </div>
          ) : null}

          <div className="rounded-xl border border-border/70 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground/70">
              After setup
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Close the Gemini terminal once sign-in is complete, click refresh here if you want,
              then send your next prompt with Gemini selected.
            </p>
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button variant="outline" onClick={props.onOpenDocs}>
            Open docs
          </Button>
          <Button variant="outline" onClick={props.onRefresh} disabled={props.isRefreshing}>
            {props.isRefreshing ? "Refreshing..." : "Refresh status"}
          </Button>
          <Button onClick={props.onRunSetup}>{needsSetup ? "Open Gemini setup" : "Reopen Gemini"}</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
