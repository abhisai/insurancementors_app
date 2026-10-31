# Coverdesk

Coverdesk is a Vercel-hosted client and policy workspace backed by Supabase Auth and Postgres. The browser uses only the Supabase publishable (or legacy `anon`) key; database row-level security restricts access to members of the shared agency workspace.

## Local development

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` to your project root URL (not the `/rest/v1/` API endpoint).
4. Set `VITE_SUPABASE_PUBLISHABLE_KEY` to the project's publishable key. A legacy `anon` key is also supported. Never use a `service_role` or secret key in this app.
5. Apply the SQL migrations in order in the Supabase SQL Editor:
   - `supabase/migrations/202611010001_initial_schema.sql`
   - `supabase/migrations/202611010002_policy_insurer_and_name.sql`
   - `supabase/migrations/202611010003_policy_dates_and_application_type.sql`
6. Create the first user from Supabase Authentication, then add that user as the workspace owner by running the SQL below with their Auth user UUID:

   ```sql
   insert into public.workspace_members (workspace_id, user_id, role)
   select id, 'AUTH-USER-UUID'::uuid, 'owner'
   from public.workspaces
   where slug = 'agency'
   on conflict (workspace_id, user_id) do update set role = 'owner';
   ```

7. Invite additional staff from Supabase Authentication and add each invited Auth user to `workspace_members` with the `agent` role. Agents can read and edit shared clients and policies; only owners can delete them.
8. Configure Supabase Auth's site URL and redirect URL allowlist for your deployment. Disable public sign-ups; invite staff only. Set a strong minimum password length and enable the available leaked-password/MFA protections for your plan.
9. Run `npm install`, then `npm run dev`.

The local `.env.local` is ignored by Git and must never be committed. Set the same two variables in Vercel's project environment-variable settings before deploying.

The migrations create a single `agency` workspace with RLS enabled on all application tables, and add insurer, policy name, application type, applied date, and inception date fields. Existing policies are backfilled with insurer `Others`, policy name `Not specified`, and type `New`; edit those values as needed. Adding an invited user to the Auth project alone does **not** grant workspace access; the user must also have a `workspace_members` row.

## Vercel deployment

Import the Git repository into Vercel and set these Production environment variables (and Preview/Development values only if those deployments should access the production data):

- `VITE_SUPABASE_URL`: project root URL, without `/rest/v1/`
- `VITE_SUPABASE_PUBLISHABLE_KEY`: publishable or legacy anon key

Deploy with the default Vite build settings (`npm run build`, output directory `dist`). The security headers in `vercel.json` allow the Supabase project URL currently configured for this app. If you use another Supabase project, update the `connect-src` domains in the Content-Security-Policy header to match it.

After deployment, set the exact production URL in Supabase Auth's site URL and redirect allowlist. Test sign-in, invited-user isolation, password recovery, client/policy creation and edits, and owner-only deletion using separate accounts before entering real records.

## Email and calendar

Email opens a prefilled draft in the signed-in user's default mail app; the app does not send email or retain a delivery record. Calendar actions download `.ics` reminders for import; they do not sync a calendar account. Direct sending and Google/Microsoft calendar synchronization need a separately configured provider and OAuth/transactional-email credentials and are not enabled here.

## Operational and privacy checklist

- Add only the staff who need access; keep sign-ups disabled and remove workspace membership when access should end.
- Never expose Supabase service-role/secret keys in Vite variables, source files, browser storage, or Vercel client-side environment variables.
- Configure and periodically test database backups and point-in-time recovery according to your Supabase plan.
- Review retention, deletion, incident response, access logging, and applicable insurance/privacy/data-residency obligations before importing real client records. The migration does not implement a complete audit trail or jurisdiction-specific compliance controls.
- Use a custom domain and HTTPS in production; review the Vercel security headers if adding integrations.
