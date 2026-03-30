import type { DesktopUpdateState } from "@t3sparks/contracts";

export type DesktopUpdateNotification =
  | {
      kind: "available";
      version: string;
      title: string;
      description: string;
    }
  | {
      kind: "downloaded";
      version: string;
      title: string;
      description: string;
    };

export function resolveDesktopUpdateNotification(
  state: DesktopUpdateState,
  announcedAvailableVersions: ReadonlySet<string>,
  announcedDownloadedVersions: ReadonlySet<string>,
): DesktopUpdateNotification | null {
  const availableVersion = state.availableVersion?.trim() ?? "";
  if (
    availableVersion.length > 0 &&
    (state.status === "available" || state.status === "downloading") &&
    !announcedAvailableVersions.has(availableVersion)
  ) {
    return {
      kind: "available",
      version: availableVersion,
      title: "Update available",
      description:
        state.status === "downloading"
          ? `Version ${availableVersion} is downloading in the background.`
          : `Version ${availableVersion} is available and will download in the background.`,
    };
  }

  const downloadedVersion = state.downloadedVersion?.trim() ?? "";
  if (
    downloadedVersion.length > 0 &&
    state.status === "downloaded" &&
    !announcedDownloadedVersions.has(downloadedVersion)
  ) {
    return {
      kind: "downloaded",
      version: downloadedVersion,
      title: "Update ready to install",
      description: `Version ${downloadedVersion} has been downloaded.`,
    };
  }

  return null;
}
