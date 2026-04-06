import type { DesktopUpdateState } from "@t3sparks/contracts";

export interface AutoUpdateMacSignatureInfo {
  signature: string | null;
  teamIdentifier: string | null;
}

export function shouldBroadcastDownloadProgress(
  currentState: DesktopUpdateState,
  nextPercent: number,
): boolean {
  if (currentState.status !== "downloading") {
    return true;
  }

  const currentPercent = currentState.downloadPercent;
  if (currentPercent === null) {
    return true;
  }

  const previousStep = Math.floor(currentPercent / 10);
  const nextStep = Math.floor(nextPercent / 10);
  return nextStep !== previousStep || nextPercent === 100;
}

export function nextStatusAfterDownloadFailure(
  currentState: DesktopUpdateState,
): DesktopUpdateState["status"] {
  return currentState.availableVersion ? "available" : "error";
}

export function getCanRetryAfterDownloadFailure(currentState: DesktopUpdateState): boolean {
  return currentState.availableVersion !== null;
}

export function getAutoUpdateDisabledReason(args: {
  isDevelopment: boolean;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  appImage?: string | undefined;
  disabledByEnv: boolean;
  macSignature?: AutoUpdateMacSignatureInfo | null;
}): string | null {
  if (args.isDevelopment || !args.isPackaged) {
    return "Automatic updates are only available in packaged production builds.";
  }
  if (args.disabledByEnv) {
    return "Automatic updates are disabled by the T3SPARKS_DISABLE_AUTO_UPDATE setting.";
  }
  if (args.platform === "linux" && !args.appImage) {
    return "Automatic updates on Linux require running the AppImage build.";
  }
  if (args.platform === "darwin") {
    const signature = args.macSignature?.signature?.trim().toLowerCase() ?? null;
    const teamIdentifier = args.macSignature?.teamIdentifier?.trim() ?? null;
    if (signature === "adhoc" || !teamIdentifier || teamIdentifier === "not set") {
      return "Automatic updates are unavailable for this macOS install because it was installed from an unsigned local build. Install the latest signed GitHub release manually once, then future updates can install from inside the app.";
    }
  }
  return null;
}

export function normalizeAutoUpdateInstallError(message: string): string {
  if (
    /code signature/i.test(message) &&
    /did not pass validation/i.test(message)
  ) {
    return "The downloaded update is signed, but this installed app was not. Install the latest signed GitHub release manually once, then future in-app updates will work.";
  }
  return message;
}
