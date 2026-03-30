import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3sparks/contracts";
import { useCallback, useEffect, useState } from "react";

import { isElectron } from "../env";

function readDesktopBridge() {
  if (!isElectron) return null;
  return window.desktopBridge ?? null;
}

export function useDesktopUpdate() {
  const [state, setState] = useState<DesktopUpdateState | null>(null);

  useEffect(() => {
    const bridge = readDesktopBridge();
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const checkForUpdates = useCallback(async (): Promise<DesktopUpdateActionResult | null> => {
    const bridge = readDesktopBridge();
    if (!bridge || typeof bridge.checkForUpdates !== "function") {
      return null;
    }
    return bridge.checkForUpdates();
  }, []);

  const downloadUpdate = useCallback(async (): Promise<DesktopUpdateActionResult | null> => {
    const bridge = readDesktopBridge();
    if (!bridge || typeof bridge.downloadUpdate !== "function") {
      return null;
    }
    return bridge.downloadUpdate();
  }, []);

  const installUpdate = useCallback(async (): Promise<DesktopUpdateActionResult | null> => {
    const bridge = readDesktopBridge();
    if (!bridge || typeof bridge.installUpdate !== "function") {
      return null;
    }
    return bridge.installUpdate();
  }, []);

  return {
    state,
    isSupported: Boolean(readDesktopBridge()),
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  };
}
