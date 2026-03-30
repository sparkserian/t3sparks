import { useEffect, useRef } from "react";

import { toastManager } from "../components/ui/toast";
import {
  getDesktopUpdateActionError,
  shouldToastDesktopUpdateActionResult,
} from "../components/desktopUpdate.logic";
import { resolveDesktopUpdateNotification } from "../components/desktopUpdateNotifications.logic";
import { isElectron } from "../env";
import { useDesktopUpdate } from "./useDesktopUpdate";

export function useDesktopUpdateNotifications(): void {
  const { state: desktopUpdateState, installUpdate } = useDesktopUpdate();
  const announcedAvailableUpdateVersionsRef = useRef(new Set<string>());
  const announcedDownloadedUpdateVersionsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!isElectron || !desktopUpdateState) {
      return;
    }

    const notification = resolveDesktopUpdateNotification(
      desktopUpdateState,
      announcedAvailableUpdateVersionsRef.current,
      announcedDownloadedUpdateVersionsRef.current,
    );
    if (!notification) {
      return;
    }

    if (notification.kind === "available") {
      announcedAvailableUpdateVersionsRef.current.add(notification.version);
      toastManager.add({
        type: "info",
        title: notification.title,
        description: notification.description,
        timeout: 0,
        data: { dismissAfterVisibleMs: 15_000 },
      });
      return;
    }

    announcedDownloadedUpdateVersionsRef.current.add(notification.version);
    toastManager.add({
      type: "success",
      title: notification.title,
      description: notification.description,
      timeout: 0,
      data: { dismissAfterVisibleMs: 20_000 },
      actionProps: {
        children: "Install and restart",
        onClick: () => {
          void installUpdate()
            .then((result) => {
              if (!result) return;
              if (!shouldToastDesktopUpdateActionResult(result)) return;
              const actionError = getDesktopUpdateActionError(result);
              if (!actionError) return;
              toastManager.add({
                type: "error",
                title: "Could not install update",
                description: actionError,
              });
            })
            .catch((error) => {
              toastManager.add({
                type: "error",
                title: "Could not install update",
                description:
                  error instanceof Error
                    ? error.message
                    : "An unexpected error occurred.",
              });
            });
        },
      },
    });
  }, [desktopUpdateState, installUpdate]);
}
