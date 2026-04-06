create table if not exists public.t3sparks_sync_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  backup_json jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.t3sparks_sync_device_bindings (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_name text not null,
  project_id text not null,
  workspace_root text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, device_id, project_id)
);

alter table public.t3sparks_sync_snapshots enable row level security;
alter table public.t3sparks_sync_device_bindings enable row level security;

drop policy if exists "users_manage_own_t3sparks_sync_snapshots" on public.t3sparks_sync_snapshots;
create policy "users_manage_own_t3sparks_sync_snapshots"
on public.t3sparks_sync_snapshots
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users_manage_own_t3sparks_sync_device_bindings" on public.t3sparks_sync_device_bindings;
create policy "users_manage_own_t3sparks_sync_device_bindings"
on public.t3sparks_sync_device_bindings
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
