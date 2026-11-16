# AGENTS.md

## Project

- Blood-donor registry form for a breast-cancer research lab. `README.md` is in Spanish and mostly Astro starter boilerplate; its intro is the only real product description.
- App must be responsive: it has to read clearly on smartphones and PCs (verified at 320 px, no horizontal scroll).
- Astro 7 SSR site (`output: 'server'`) with the `@astrojs/netlify` adapter, Tailwind CSS 4 (Vite plugin) and daisyUI 5. No UI framework integration (React/Vue/Svelte).
- Supabase Auth is wired through `@supabase/ssr` with server-side cookies: `src/lib/supabase.ts`, `src/middleware.ts` (session refresh, `/dashboard` protection and the account-status check), `POST /api/auth/login` and `POST /api/auth/logout`. `public.usuarios` stores the profile, the role (`admin` / `supervisor` / `capturador`) and the status (`activo` / `inactivo`) with RLS; it never stores passwords.
- Pages: `src/pages/auth/login.astro`, protected `src/pages/dashboard/index.astro`, the protected `src/pages/dashboard/donaciones/nueva.astro` (visual placeholder for the donation form; no role guard, any active session), role-protected `src/pages/dashboard/admin/users.astro` (403 unless the session is an `admin`; lists the users with server-side search, status filter and pagination), `src/pages/auth/confirm.astro` (verifies the invite token), `src/pages/auth/update-password.astro` (GET form + POST handler), `src/pages/cuenta-desactivada.astro` (403 shown to a deactivated account) and API routes `src/pages/api/{auth/login,auth/logout,invitations}.ts` plus `src/pages/api/users/[id].ts` (PATCH/DELETE) and `src/pages/api/users/[id]/reinvite.ts` (POST); `/` redirects to `/auth/login` through `redirects` in `astro.config.mjs`. Only stylesheet: `src/styles/global.css`.
- Role checks live in page frontmatter, not in `src/middleware.ts`: the middleware only protects `/dashboard/*` by session and blocks deactivated accounts. `src/lib/current-user.ts` (`getCurrentUser`) is the single reader of the requester's row in `public.usuarios`; the middleware resolves it once per request and exposes it as `Astro.locals.currentUser`.
- `/dashboard` renders `NewDonationShortcutCard.astro` for every active session (no role check) and it links to `/dashboard/donaciones/nueva`. That page is visual only: `src/features/donations/components/NewDonationPanel.astro` shows a placeholder alert and a «Volver al panel» link, with no form, no data access and no API. The donation form itself is still pending.
- Deactivated accounts are blocked in two layers: a database trigger keeps `auth.users.banned_until` in sync with `public.usuarios.estatus` (so `signInWithPassword` fails), and the middleware closes the session and answers 403 on any request with a session whose status is `inactivo` (302 to `/cuenta-desactivada` for pages, JSON for `/api/*`, 503 if the status cannot be read). The status is editable from the app: the `admin` changes it in the edit modal of `/dashboard/admin/users`.
- The user listing reads `public.usuarios` with the requester's own session client (`Astro.locals.supabase`), so RLS does the filtering; the secret key stays out of it. The search term is sanitized before it reaches the PostgREST filter (`sanitizeSearchTerm` in `src/features/users/lib/users-list.ts`) and the status filter is a whitelist (`sanitizeEstatusFilter`).
- The admin can create people from `/dashboard/admin/users`: a `<dialog class="modal">` (`src/features/users/components/UsersInviteModal.astro`) with three views (form → confirmation → result) that posts `{ nombre, email, rol }` to `POST /api/invitations`. The button and the modal are rendered only in the authorized branch of `AdminUsersPanel.astro` (`autorizado = !denied && result !== undefined`), so a non-admin gets a 403 and no button in the HTML.
- `POST /api/invitations` accepts `email` (required) plus optional `nombre` (1–120 chars) and `rol` (whitelist `ROL_VALUES`); `src/features/invitations/lib/invitations.ts` owns `parseInviteInput()`, `generateInviteLink()` and `createInvitedUser()`. The role is written by the server with the secret key (`service_role`, bypasses RLS), never read from the invite metadata: metadata can be written by whoever creates the user in Auth, while the role is an authorization decision. If that write fails, the just-created user is deleted (`auth.admin.deleteUser`, cascades to `public.usuarios`) so no half-created account is left behind. `ROL_VALUES` in `src/lib/roles.ts` is the single source of truth for the whitelist (server validation and the modal's `<select>`).
- The admin also manages existing accounts from the same table: three icon buttons per row (Lucide `Pencil`, `Send`, `Trash`) that open `UsersEditModal.astro`, `UsersResendModal.astro` and `UsersDeleteModal.astro`. The row data travels in `data-user-*` attributes (no request to open a modal) and each modal's `<script>` scopes its queries to its own `<dialog>` (the modals share `data-email` / `data-resultado` names).
- `PATCH /api/users/[id]` (edit), `DELETE /api/users/[id]` (delete) and `POST /api/users/[id]/reinvite` (resend the invitation) live in `src/pages/api/users/`. All three require an `admin` session (401 without a session, 403 otherwise) and answer with a generic message; the details go to the server log. `src/features/users/lib/users-admin.ts` owns `parseUserUpdateInput()`, `findUserProfile()`, `updateUserProfile()` and `deleteUserAccount()`, all with the secret key (so `public.usuarios` keeps only its `select` policy).
- Self-protection is enforced on the server, comparing the route `id` with `locals.claims.sub`: nobody changes their own `rol` or `estatus`, and nobody deletes their own account (403). The modals only disable those fields as a courtesy. An `admin` can still edit another `admin` fully.
- `public.usuarios.email_confirmado` and `public.usuarios.invitado_at` mirror `auth.users.email_confirmed_at` and `auth.users.invited_at` through the trigger `on_auth_user_invitation_changed` (`private.sync_user_invitation()`). The resend of an invitation does not delete and recreate the account: GoTrue renews the `confirmation_token` of an unconfirmed user and keeps its `id`, `nombre` and `rol`; a confirmed account is rejected with 409.

## Structure

```text
scripts/
└── seed-fake-users.mjs         # crea 17 usuarios ficticios (npm run seed:users)
src/
├── middleware.ts                          # session refresh + /dashboard protection + status block
├── env.d.ts                               # astro:env types + App.Locals (supabase, claims, currentUser)
├── styles/global.css                      # Tailwind 4 + daisyUI setup (only stylesheet)
├── lib/                                   # multi-feature infra
│   ├── current-user.ts                    # requester's profile (nombre, email, rol, estatus) + getCurrentUser()
│   ├── database.types.ts                  # Supabase types generated from the MCP
│   ├── estatus.ts                         # Estatus type + ESTATUS_VALUES whitelist + ESTATUS_INFO map (label, badge class)
│   ├── roles.ts                           # Rol type + ROL_VALUES whitelist + ROL_INFO map (label, badge class)
│   └── supabase.ts                        # @supabase/ssr server client factory
├── components/
│   └── ui/                                # components used across features
│       ├── BaseLayout.astro               # <head>, <body class="bg-base-200">, imports global.css
│       ├── AlertError.astro               # role="alert" + alert alert-error (+ alert-soft)
│       └── AppNavbar.astro                # navbar + «Cerrar sesión» logout form
├── features/
│   ├── auth/
│   │   └── components/
│   │       ├── AuthCard.astro             # main > section.card > card-body
│   │       ├── FormField.astro            # fieldset + label + input (or slot)
│   │       └── PasswordInput.astro        # div.input + password field + toggle + its script
│   ├── dashboard/
│   │   └── components/
│   │       ├── AdminUsersShortcutCard.astro # admin-only card linking to /dashboard/admin/users
│   │       └── NewDonationShortcutCard.astro # card linking to /dashboard/donaciones/nueva (all roles)
│   ├── donations/
│   │   └── components/
│   │       └── NewDonationPanel.astro      # card of the destination page: placeholder alert + «Volver al panel»
│   ├── users/
│   │   ├── components/
│   │   │   ├── AdminUsersPanel.astro      # props denied?/result?/currentUserId: card that composes the row actions
│   │   │   ├── UsersSearchForm.astro      # GET form (q + estatus) + «Quitar filtros»
│   │   │   ├── UsersTable.astro           # table (nombre, correo, rol, estatus, invitación, acciones) + empty states
│   │   │   ├── UsersPagination.astro      # daisyUI join of page links (keeps q + estatus)
│   │   │   ├── UsersInviteModal.astro     # <dialog> modal: form → confirmation → result + its script
│   │   │   ├── UsersEditModal.astro       # <dialog> modal: prefilled nombre/rol/estatus + its script
│   │   │   ├── UsersDeleteModal.astro     # <dialog> modal: warning + confirmation + its script
│   │   │   └── UsersResendModal.astro     # <dialog> modal: resend confirmation + its script
│   │   └── lib/
│   │       ├── users-list.ts              # listUsers(), countUsers(), fetchUsersPage(),
│   │       │                              # sanitizeSearchTerm(), sanitizeEstatusFilter(), buildPageWindow()
│   │       └── users-admin.ts             # parseUserUpdateInput(), findUserProfile(),
│   │                                      # updateUserProfile(), deleteUserAccount(), isUserId()
│   └── invitations/
│       └── lib/
│           ├── invitations.ts              # parseInviteInput() + generateInviteLink() + createInvitedUser()
│           ├── email.ts                   # nodemailer SMTP sender (greets by name, escapes the HTML)
│           └── supabase-admin.ts          # admin client using SUPABASE_SECRET_API_KEY
└── pages/
    ├── cuenta-desactivada.astro           # 403 for a deactivated account (exempt from the status check)
    ├── dashboard/index.astro              # profile card + «Registrar donación» card (+ admin shortcut card)
    ├── dashboard/donaciones/nueva.astro   # donation form page: placeholder only (no role guard)
    ├── dashboard/admin/users.astro        # role guard: Astro.response.status = 403 if not admin
    ├── auth/{login,confirm,update-password}.astro
    └── api/
        ├── invitations.ts
        ├── users/[id].ts                  # PATCH (edit) + DELETE (remove) of one user
        ├── users/[id]/reinvite.ts         # POST (resend the invitation)
        └── auth/{login,logout}.ts
```

Rules:

- `src/pages/` holds routing and frontmatter only (redirects, data fetching, `Astro.locals`); markup lives in components.
- Where a component lives: `src/components/ui/` if it is used by several features, `src/features/<f>/components/` if it belongs to a single feature.
- `src/lib/` is multi-feature infra (Supabase client, generated types). Code used by a single feature goes to `src/features/<f>/lib/`.

### Recipe: add a feature

1. Create `src/features/<name>/` with `components/` and/or `lib/` as needed.
2. Add its routes as pages under `src/pages/` (Astro requires pages there); keep redirects and data fetching in the page frontmatter.
3. Put feature-only TypeScript helpers in `src/features/<name>/lib/`; import shared infra (`src/lib/supabase.ts`, `database.types.ts`) from there.
4. If it needs new env vars, declare them server-only in `astro:env` (`context: 'server'`, `access: 'secret'`) and add placeholders to `.env.template`.
5. Verify with `npm run build` and `npx tsc --noEmit`.

### Recipe: add a component

1. Extract markup only when it is repeated in two or more places (the navbar and the password field were extracted explicitly to isolate SPEC 04, even with a single use).
2. Place it in `src/components/ui/` (cross-feature) or `src/features/<f>/components/` (single feature).
3. Props only for what actually varies; no speculative props. Content that varies per use goes through `<slot />`.
4. Move the markup wholesale: the served HTML must not change (Astro strips source indentation, so only element structure matters).
5. Verify with `npm run build`, `npx tsc --noEmit` and, for visible changes, a browser check.

## Commands

- `npm run dev` / `npm run build` / `npm run preview`.
- `npm run seed:users` siembra 17 usuarios ficticios (`@example.com`) con roles y estatus variados. Es idempotente: omite los correos que ya existen. Usa `SUPABASE_SECRET_API_KEY` desde `.env` y no envía correos.
- There are no test or lint scripts. `npm run build` is the main verification step; `npm run check` (`astro check`) type-checks the `.astro` frontmatter and `npx tsc --noEmit` covers `src/**/*.ts`.
- `npx tsc --noEmit` does **not** check `.astro` files: it only covers `src/**/*.ts`. Frontmatter errors in pages and components need `npm run check` (`@astrojs/check` + `typescript` are declared devDependencies).
- `astro` is not on PATH here: bare `astro ...` fails, so always use `npx astro ...`.
- The build prints `Invalid empty selector` warnings from daisyUI CSS; they are non-fatal (verified on Astro 7.4.7 / daisyUI 5.7.50).
- No Supabase CLI is installed or declared and there is no `supabase/config.toml`; database work goes through the Supabase MCP server or the dashboard, and applied SQL is versioned in `supabase/migrations/`. If the CLI is added, invoke it as `npx supabase` and commit `supabase/`.

## Dev server

Run it in the background so it does not block the session:

```sh
npx astro dev --background
```

Manage it with `npx astro dev stop`, `npx astro dev status`, and `npx astro dev logs` (`--follow` streams).

## Styling

- `src/styles/global.css` is the entire setup: `@import "tailwindcss";` plus `@plugin "daisyui";`.
- Tailwind 4 is configured only through the Vite plugin in `astro.config.mjs`. Do not add `tailwind.config.js` (deprecated in v4).
- `src/components/ui/BaseLayout.astro` imports `src/styles/global.css`; pages wrap their markup in it instead of importing the stylesheet themselves.
- Icons come from `@lucide/astro` (`import { Pencil } from '@lucide/astro'`), not from inline SVG. Watch the deprecated aliases: `Trash2` is now `Trash`.
- Read the `daisyui` skill in `.agents/skills/daisyui/` before writing markup or choosing component classes.

## Supabase

- Read `.agents/skills/supabase/SKILL.md` before any Supabase task, and `.agents/skills/supabase-postgres-best-practices/SKILL.md` before schema, migration, SQL, index, or RLS work. Supabase changes often: verify against the current docs/changelog instead of memory.
- `@supabase/supabase-js`, `@supabase/ssr` and the `@astrojs/netlify` SSR adapter are installed; the site is no longer static.
- Env vars live in `.env` (gitignored) and `.env.template` (tracked): `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_PASSWORD`, plus `SUPABASE_SECRET_API_KEY` and `SMTP_*` (see the Email section below). `.env` is populated locally; never commit it or copy real values into `.env.template`.
- `SUPABASE_URL` and `SUPABASE_KEY` are server-only: declared in `astro:env` as `context: 'server'`, `access: 'secret'` and read only by `src/lib/supabase.ts`. Never rename them to `PUBLIC_*` or expose them to client code. `SUPABASE_DB_PASSWORD` is CLI/MCP-only and must never reach the client.
- Never use a `service_role`/secret key in frontend code. Enable RLS on every table in an exposed schema and write policies per table, not a blanket `auth.uid()`. `public.usuarios` already has RLS and `select`-only grants for `authenticated`.
- Session cookies are `httpOnly`, `sameSite=lax` and `secure` only in production; requests are authorized with `getClaims()`, not `getSession()`. The middleware protects `/dashboard/*` by session and blocks deactivated accounts; role authorization is checked in page frontmatter.
- `public.usuarios.estatus` is `public.estatus_usuario` (`activo` / `inactivo`), `not null` with default `activo`. The trigger `on_usuarios_estatus_changed` (`private.sync_user_estatus()`, `security definer` + `set search_path = ''`) mirrors it into `auth.users.banned_until`; it only fires when the value actually changes. Both migrations live in `supabase/migrations/`: `20261107235752_create_usuarios.sql` and `20261112185401_add_estatus_usuario.sql`.
- `public.usuarios.email_confirmado` (`boolean not null default false`) and `public.usuarios.invitado_at` (`timestamptz`) are mirrored from `auth.users` by the trigger `on_auth_user_invitation_changed` (`private.sync_user_invitation()`), which runs `after update of email_confirmed_at, invited_at`. The third migration (`20261113201404_add_email_confirmado.sql`) also backfills the existing rows from `auth.users`. No recursion with the status trigger: each writes columns the other does not touch.
- Types are generated with `generate_typescript_types` from the MCP and stored in `src/lib/database.types.ts`; the server client is `SupabaseClient<Database>`.
- The Supabase MCP server is configured globally in `~/.config/opencode/opencode.jsonc` (project ref `ugzbcrwykivvisbvpozo`, the same as `SUPABASE_URL` in `.env`), not in this repo's `opencode.jsonc`. Use it to inspect tables, migrations, logs, and advisors before changing the remote project.

## Security

Unchanged rules, restated here so they are never lost during refactors:

- Server-only secrets: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SECRET_API_KEY` and `SMTP_*` are `astro:env` server secrets; they must never appear in client code, in the served HTML/JS, or in `dist/`.
- RLS on every table in an exposed schema, with per-table policies (details in Supabase above).
- `service_role`/secret keys only in server code: `SUPABASE_SECRET_API_KEY` is read by `src/features/invitations/lib/supabase-admin.ts` from API routes, never from pages or client scripts.
- The deactivated-account check fails closed: if the status cannot be read, the middleware answers 503 instead of letting the request through.
- The login endpoint never reveals whether an account exists: `POST /api/auth/login` answers the same generic error for a wrong password and for a banned account.
- The invitation endpoint never reveals whether an account exists either: `POST /api/invitations` answers a generic 409 for an already-registered email.
- The role of an invited person is decided by the server from the request body, never from the invite metadata (see Project above): only the `admin` that calls the API can choose it.
- The user-management routes (`/api/users/**`) check the role on the server (`locals.currentUser?.rol !== 'admin'` → 403) and enforce self-protection (no own `rol`/`estatus` change, no own deletion → 403). The disabled fields in the modals are only a courtesy.
- The reinvite endpoint never mails a confirmed account: `public.usuarios.email_confirmado` is checked first (409) and GoTrue's `email_exists` is mapped to the same 409.

## Email (SMTP)

- The app sends its own invitation emails with `nodemailer` (`src/features/invitations/lib/email.ts`): Gmail SMTP (`smtp.gmail.com`, port 465, direct TLS) using an app password. `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SUPABASE_SECRET_API_KEY` are `astro:env` server secrets; only placeholders go in `.env.template`.
- Gmail allows about 500 emails per day (fewer on new accounts) — enough for the lab. Migrate to another SMTP (Resend, SendGrid…) if the volume grows.
- If the Google app password is revoked or expires, sends fail: the error is logged on the server and `POST /api/invitations` answers a generic message. To rotate it, generate a new app password and update `SMTP_PASS`.
- Never use Supabase Dashboard's «Invite user» button: it would send a second email from Supabase. The app calls `auth.admin.generateLink` (returns `hashed_token` and sends nothing) and mails the link itself.
- The invitation email greets the invited person by name (`sendInviteEmail` takes `nombre`); the HTML part escapes the name, the email and the link before interpolating them.
- `SUPABASE_SECRET_API_KEY` (the `sb_secret_...` key, the current replacement for `service_role`) is server-only: read by `src/features/invitations/lib/supabase-admin.ts` from API routes. It must never appear in client code, in the served HTML/JS, or in `dist/`.

## Spec workflow

- `/spec` only designs and writes the spec file (`specs/NN-slug.md`). It must never write or modify application code.
- `/spec-impl` is the only workflow allowed to modify application code, and only when the spec's status means Approved (e.g. `Approved` / `Aprobado`). Otherwise it must stop without touching code.
- `/spec-impl` executes the implementation plan **one numbered step at a time**: implement exactly one step, summarize the files touched and show the diff, then **stop and wait for human review**. Never chain several steps in one go; continue only after the user explicitly confirms (`yes`, `go`, equivalent). If there are no steps left, say so and stop.
- Never commit automatically, per step or at the end; only when the user explicitly asks. Only a human moves a spec to `Approved` and to `Implemented`. `/spec-impl` creates/switches to branch `spec-NN-slug` before implementing.
- `spec-verifier` only verifies and edits files under `specs/**`; it must not change app code or the spec's status.
- `specs/` holds `specs/01-login.md`, `specs/02-auth-supabase.md`, `specs/03-invitacion-confirmacion.md` and `specs/04-toggle-visibilidad-contrasena.md` (all `Implementado`), plus `specs/05-refactor-fdd-componentes.md`, `specs/06-admin-usuarios.md`, `specs/07-listado-usuarios.md`, `specs/08-estatus-usuarios.md`, `specs/09-alta-usuario-desde-panel.md`, `specs/10-edicion-borrado-y-reenvio-invitacion.md` and `specs/11-seccion-formulario-donaciones.md` (11 is `Aprobado`; the rest are `Implementado`). New specs follow `specs/NN-slug.md`.
- `spec-verifier` uses `npx astro dev *`, `npm run build`, `npx tsc --noEmit` (never `astro check`), read-only git, read-only `curl`, Playwright, Context7, Astro Docs and the Supabase MCP. Its Supabase access is read-only: no migrations, branches, Edge Functions or DML/DDL. It must ask before mutating real state (invitations, real `POST`s).

## References

- `opencode.jsonc` configures the `astro-docs` and `playwright` MCP servers, useful for Astro API questions and browser verification. The `supabase` and `context7` MCP servers are configured globally instead (see Supabase above).
