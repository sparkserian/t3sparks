/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@t3sparks/contracts";

interface ImportMetaEnv {
  readonly VITE_WS_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

declare global {
  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
  }
}
