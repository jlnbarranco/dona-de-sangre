# AGENTS.md

## Project

- Blood-donor registry form for a breast-cancer research lab. `README.md` is in Spanish and mostly Astro starter boilerplate; its intro is the only real product description.
- App must be responsive, should watch it clearly on smartphones and PC's.
- Astro 7 static site + Tailwind CSS 4 (Vite plugin) + daisyUI 5. No UI framework integration (React/Vue/Svelte) and no SSR adapter.
- Supabase integration is partial: `@supabase/supabase-js` ^2.119.0 (installed 2.119.0) and the env vars exist, but there is no client module, no auth wiring, and login still only calls `preventDefault()`. Do not assume Supabase is functional.
- Pages: `src/pages/auth/login.astro` only; `/` redirects to `/auth/login` through `redirects` in `astro.config.mjs` (the old `src/pages/index.astro` was removed in spec 01). Only stylesheet: `src/styles/global.css`.

## Commands

- `npm run dev` / `npm run build` / `npm run preview`.
- There are no test, lint, or typecheck scripts. `npm run build` is the only verification step.
- `astro` is not on PATH here: bare `astro ...` fails, so always use `npx astro ...`.
- `astro check` is not installed either; running it prompts to install `@astrojs/check` and `typescript`.
- The build prints `Invalid empty selector` warnings from daisyUI CSS; they are non-fatal (verified on Astro 7.4.7 / daisyUI 5.7.50).
- No Supabase CLI is installed or declared, and there is no `supabase/` directory or `config.toml`. Database work currently goes through the Supabase MCP server or the dashboard; if the CLI is added, invoke it as `npx supabase` and commit `supabase/`.

## Dev server

Run it in the background so it does not block the session:

```sh
npx astro dev --background
```

Manage it with `npx astro dev stop`, `npx astro dev status`, and `npx astro dev logs` (`--follow` streams).

## Styling

- `src/styles/global.css` is the entire setup: `@import "tailwindcss";` plus `@plugin "daisyui";`.
- Tailwind 4 is configured only through the Vite plugin in `astro.config.mjs`. Do not add `tailwind.config.js` (deprecated in v4).
- There is no layout component: each page must import `src/styles/global.css` itself (`src/pages/auth/login.astro` shows the pattern).
- Read the `daisyui` skill in `.agents/skills/daisyui/` before writing markup or choosing component classes.

## Supabase

- Read `.agents/skills/supabase/SKILL.md` before any Supabase task, and `.agents/skills/supabase-postgres-best-practices/SKILL.md` before schema, migration, SQL, index, or RLS work. Supabase changes often: verify against the current docs/changelog instead of memory.
- `@supabase/supabase-js` is the only Supabase package. `@supabase/ssr` and an SSR adapter are not installed, so the site stays static and any session/auth logic is client-side unless a spec introduces SSR.
- Env vars live in `.env` (gitignored) and `.env.template` (tracked): `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_PASSWORD`. `.env` is populated locally; never commit it or copy real values into `.env.template`.
- Astro only exposes `PUBLIC_*` variables to client code. The current names have no prefix, so browser code cannot read them: either rename to `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_KEY` (publishable/anon key only) or keep the calls server-side under SSR. `SUPABASE_DB_PASSWORD` is admin/CLI-only and must never reach the client.
- Never use a `service_role`/secret key in frontend code. Enable RLS on every table in an exposed schema and write policies per table, not a blanket `auth.uid()`.
- No Supabase client module exists yet. Creating `src/lib/supabase.*` (or any DB/auth call) belongs to an approved spec, not to ad-hoc work.
- The Supabase MCP server is configured globally in `~/.config/opencode/opencode.jsonc` (project ref `swguryvbjzosovilywxf`), not in this repo's `opencode.jsonc`. Use it to inspect tables, migrations, logs, and advisors before changing the remote project.

## Spec workflow

- `/spec` only designs and writes the spec file (`specs/NN-slug.md`). It must never write or modify application code.
- `/spec-impl` is the only workflow allowed to modify application code, and only when the spec's status means Approved (e.g. `Approved` / `Aprobado`). Otherwise it must stop without touching code.
- `/spec-impl` executes the implementation plan **one numbered step at a time**: implement exactly one step, summarize the files touched and show the diff, then **stop and wait for human review**. Never chain several steps in one go; continue only after the user explicitly confirms (`yes`, `go`, equivalent). If there are no steps left, say so and stop.
- Never commit automatically, per step or at the end; only when the user explicitly asks. Only a human moves a spec to `Approved` and to `Implemented`. `/spec-impl` creates/switches to branch `spec-NN-slug` before implementing.
- `spec-verifier` only verifies and edits files under `specs/**`; it must not change app code or the spec's status.
- `specs/` exists and currently holds `specs/01-login.md` (status Implementado). New specs follow `specs/NN-slug.md`.
- `spec-verifier`'s shell allowlist only matches bare `astro dev *`, which fails here (no global `astro`). Update it to `npx astro dev *` before relying on that agent.

## References

- `opencode.jsonc` configures the `astro-docs` and `playwright` MCP servers, useful for Astro API questions and browser verification. The Supabase MCP server is configured globally instead (see Supabase above).
