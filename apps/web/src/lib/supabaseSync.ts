import {
  type Session,
  type SupabaseClient,
  createClient,
} from "@supabase/supabase-js";

import type { ProjectId } from "@t3sparks/contracts";

import type { T3SparksBackup } from "./backup";

const SNAPSHOTS_TABLE = "t3sparks_sync_snapshots";
const DEVICE_BINDINGS_TABLE = "t3sparks_sync_device_bindings";

interface SnapshotRow {
  user_id: string;
  backup_json: T3SparksBackup;
  updated_at: string;
}

interface DeviceBindingRow {
  user_id: string;
  device_id: string;
  device_name: string;
  project_id: string;
  workspace_root: string;
  updated_at: string;
}

let cachedClient: SupabaseClient | null | undefined;

function envValue(key: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string | null {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function isSupabaseSyncConfigured(): boolean {
  return envValue("VITE_SUPABASE_URL") !== null && envValue("VITE_SUPABASE_ANON_KEY") !== null;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const url = envValue("VITE_SUPABASE_URL");
  const anonKey = envValue("VITE_SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return cachedClient;
}

function requireClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      "Supabase sync is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY first.",
    );
  }
  return client;
}

async function requireUserId(): Promise<string> {
  const client = requireClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error) {
    throw error;
  }
  if (!user) {
    throw new Error("Sign in first.");
  }
  return user.id;
}

export async function signInWithSupabasePassword(email: string, password: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
}

export async function signUpWithSupabasePassword(email: string, password: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signUp({ email, password });
  if (error) {
    throw error;
  }
}

export async function signOutFromSupabase(): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function getSupabaseSession(): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export function onSupabaseAuthStateChange(
  listener: (session: Session | null) => void,
): () => void {
  const client = getSupabaseClient();
  if (!client) {
    listener(null);
    return () => {};
  }
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    listener(session);
  });
  void client.auth
    .getSession()
    .then(({ data: sessionData }) => listener(sessionData.session))
    .catch(() => listener(null));
  return () => {
    data.subscription.unsubscribe();
  };
}

export async function uploadSyncBackup(backup: T3SparksBackup): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();
  const payload: SnapshotRow = {
    user_id: userId,
    backup_json: backup,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from(SNAPSHOTS_TABLE).upsert(payload, { onConflict: "user_id" });
  if (error) {
    throw error;
  }
}

export async function downloadSyncBackup(): Promise<T3SparksBackup | null> {
  const client = requireClient();
  const userId = await requireUserId();
  const { data, error } = await client
    .from(SNAPSHOTS_TABLE)
    .select("backup_json")
    .eq("user_id", userId)
    .maybeSingle<{ backup_json: T3SparksBackup }>();
  if (error) {
    throw error;
  }
  return data?.backup_json ?? null;
}

export async function listDeviceProjectBindings(deviceId: string): Promise<Record<ProjectId, string>> {
  const client = requireClient();
  const userId = await requireUserId();
  const { data, error } = await client
    .from(DEVICE_BINDINGS_TABLE)
    .select("project_id, workspace_root")
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .returns<Array<Pick<DeviceBindingRow, "project_id" | "workspace_root">>>();
  if (error) {
    throw error;
  }
  const bindingsByProjectId: Record<ProjectId, string> = {} as Record<ProjectId, string>;
  for (const row of data ?? []) {
    bindingsByProjectId[row.project_id as ProjectId] = row.workspace_root;
  }
  return bindingsByProjectId;
}

export async function upsertDeviceProjectBinding(input: {
  deviceId: string;
  deviceName: string;
  projectId: ProjectId;
  workspaceRoot: string;
}): Promise<void> {
  const client = requireClient();
  const userId = await requireUserId();
  const { error } = await client.from(DEVICE_BINDINGS_TABLE).upsert(
    {
      user_id: userId,
      device_id: input.deviceId,
      device_name: input.deviceName,
      project_id: input.projectId,
      workspace_root: input.workspaceRoot,
      updated_at: new Date().toISOString(),
    } satisfies DeviceBindingRow,
    { onConflict: "user_id,device_id,project_id" },
  );
  if (error) {
    throw error;
  }
}
