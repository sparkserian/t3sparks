# Supabase Sync Setup

1. Create a Supabase project.
2. In `Authentication -> Providers`, enable `Email`.
3. In the SQL editor, run [`sync-schema.sql`](./sync-schema.sql).
4. Copy the project URL and anon key from `Project Settings -> API`.
5. Set these env vars for the desktop/web app build:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

6. Restart T3 Sparks and open `Settings -> Cloud sync`.
7. Sign in or sign up, then use `Upload current state` on the source device.
8. On the other device, sign in, use `Restore cloud state`, and bind any projects that need a local folder path.

## Notes

- Sync currently uses a single latest snapshot per user account.
- Device-specific project bindings are stored separately, so Mac and Windows can point the same logical project at different local folders.
- Provider auth, CLI installs, running terminals, and OS permissions remain device-local. The app will show those as setup items after restore when relevant.
- Attachments and provider login tokens are not yet synced through Supabase in this slice.
