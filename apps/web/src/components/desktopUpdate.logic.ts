import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3sparks/contracts";

export type DesktopUpdateButtonAction = "download" | "install" | "none";
export interface DesktopUpdateSummary {
  title: string;
  description: string;
}

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  if (state.status === "available") {
    return "download";
  }
  if (state.status === "downloaded") {
    return "install";
  }
  if (state.status === "error") {
    if (state.errorContext === "install" && state.downloadedVersion) {
      return "install";
    }
    if (state.errorContext === "download" && state.availableVersion) {
      return "download";
    }
  }
  return "none";
}

export function shouldShowDesktopUpdateButton(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  if (state.status === "downloading") {
    return true;
  }
  return resolveDesktopUpdateButtonAction(state) !== "none";
}

export function isDesktopUpdateButtonDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "downloading";
}

export function getDesktopUpdateButtonTooltip(state: DesktopUpdateState): string {
  if (state.status === "available") {
    return `Update ${state.availableVersion ?? "available"} found. Downloading in the background.`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${progress}`;
  }
  if (state.status === "downloaded") {
    return `Update ${state.downloadedVersion ?? state.availableVersion ?? "ready"} downloaded. Click to restart and install.`;
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return `Download failed for ${state.availableVersion}. Click to retry.`;
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return `Install failed for ${state.downloadedVersion}. Click to retry.`;
    }
    return state.message ?? "Update failed";
  }
  return "Update available";
}

export function getDesktopUpdateActionError(result: DesktopUpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (typeof result.state.message !== "string") return null;
  const message = result.state.message.trim();
  return message.length > 0 ? message : null;
}

export function shouldToastDesktopUpdateActionResult(result: DesktopUpdateActionResult): boolean {
  return result.accepted && !result.completed;
}

export function shouldHighlightDesktopUpdateError(state: DesktopUpdateState | null): boolean {
  if (!state || state.status !== "error") return false;
  return state.errorContext === "download" || state.errorContext === "install";
}

export function getDesktopUpdateSummary(state: DesktopUpdateState): DesktopUpdateSummary {
  if (!state.enabled || state.status === "disabled") {
    return {
      title: "Automatic updates unavailable",
      description:
        state.message ?? "This build cannot download and install updates automatically.",
    };
  }

  if (state.status === "checking") {
    return {
      title: "Checking for updates",
      description: `Looking for a newer release than ${state.currentVersion}.`,
    };
  }

  if (state.status === "up-to-date") {
    return {
      title: "App is up to date",
      description: `Version ${state.currentVersion} is the latest version found.`,
    };
  }

  if (state.status === "available") {
    return {
      title: `Update ${state.availableVersion ?? "available"} found`,
      description: "The download has started in the background.",
    };
  }

  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return {
      title: `Downloading ${state.availableVersion ?? "update"}${progress}`,
      description: "The installer package is downloading in the background.",
    };
  }

  if (state.status === "downloaded") {
    return {
      title: `Update ${state.downloadedVersion ?? state.availableVersion ?? "ready"} is ready`,
      description: "Restart the app to install the downloaded update.",
    };
  }

  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return {
        title: `Could not download ${state.availableVersion}`,
        description: state.message ?? "Retry the download to continue the update.",
      };
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return {
        title: `Could not install ${state.downloadedVersion}`,
        description: state.message ?? "Retry the install when you are ready to restart.",
      };
    }
    return {
      title: "Could not check for updates",
      description: state.message ?? "Try checking again.",
    };
  }

  return {
    title: "Automatic updates enabled",
    description: "The app checks for new releases after launch and periodically while running.",
  };
}

export function getDesktopUpdatePrimaryActionLabel(state: DesktopUpdateState): string | null {
  const action = resolveDesktopUpdateButtonAction(state);
  if (action === "download") {
    return state.errorContext === "download"
      ? "Retry download"
      : `Download ${state.availableVersion ?? "update"}`;
  }
  if (action === "install") {
    return "Install and restart";
  }
  return null;
}

export function shouldShowDesktopUpdateCheckAction(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) return false;
  return state.status !== "downloading" && state.status !== "downloaded";
}

export function isDesktopUpdateCheckActionDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "checking";
}
