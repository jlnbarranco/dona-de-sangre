# AGENTS.md

## Project

- Blood-donor registry form for a breast-cancer research lab. `README.md` is in Spanish and mostly Astro starter boilerplate; its intro is the only real product description.
- App must be responsive, should watch it clearly on smartphones and PC's.
- Astro 7 static site + Tailwind CSS 4 (Vite plugin) + daisyUI 5. No UI framework integration (React/Vue/Svelte) and no SSR adapter.
- `README.md` says Supabase provides the database and auth, but none of it exists yet: no `@supabase/*` dependency, no client, no `.env*` file. Do not assume it is wired up.
- Only page: `src/pages/index.astro`. Only stylesheet: `src/styles/global.css`.

## Commands

- `npm run dev` / `npm run build` / `npm run preview`.
- There are no test, lint, or typecheck scripts. `npm run build` is the only verification step.
- `astro` is not on PATH here: bare `astro ...` fails, so always use `npx astro ...`.
- `astro check` is not installed either; running it prompts to install `@astrojs/check` and `typescript`.
- The build prints `Invalid empty selector` warnings from daisyUI CSS; they are non-fatal (verified on Astro 7.4.7 / daisyUI 5.7.50).

## Dev server

Run it in the background so it does not block the session:

```sh
npx astro dev --background
```

Manage it with `npx astro dev stop`, `npx astro dev status`, and `npx astro dev logs` (`--follow` streams).

## Styling

- `src/styles/global.css` is the entire setup: `@import "tailwindcss";` plus `@plugin "daisyui";`.
- Tailwind 4 is configured only through the Vite plugin in `astro.config.mjs`. Do not add `tailwind.config.js` (deprecated in v4).
- There is no layout component: each page must import `src/styles/global.css` itself (`src/pages/index.astro` shows the pattern).
- Read the `daisyui` skill in `.agents/skills/daisyui/` before writing markup or choosing component classes.

## Spec workflow

- `/spec` only designs and writes the spec file (`specs/NN-slug.md`). It must never write or modify application code.
- `/spec-impl` is the only workflow allowed to modify application code, and only when the spec's status means Approved (e.g. `Approved` / `Aprobado`). Otherwise it must stop without touching code.
- `/spec-impl` executes the implementation plan **one numbered step at a time**: implement exactly one step, summarize the files touched and show the diff, then **stop and wait for human review**. Never chain several steps in one go; continue only after the user explicitly confirms (`yes`, `go`, equivalent). If there are no steps left, say so and stop.
- Never commit automatically, per step or at the end; only when the user explicitly asks. Only a human moves a spec to `Approved` and to `Implemented`. `/spec-impl` creates/switches to branch `spec-NN-slug` before implementing.
- `spec-verifier` only verifies and edits files under `specs/**`; it must not change app code or the spec's status.
- `specs/` does not exist yet; the first spec creates it.
- `spec-verifier`'s shell allowlist only matches bare `astro dev *`, which fails here (no global `astro`). Update it to `npx astro dev *` before relying on that agent.

## References

- `opencode.jsonc` configures the `astro-docs` and `playwright` MCP servers, useful for Astro API questions and browser verification.
