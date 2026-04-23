/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@t3sparks/contracts";

declare global {
  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
  }
}
