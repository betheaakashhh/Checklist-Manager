# Checklist Manager

Checklist Manager turns pasted bullet points into a persistent, Jira-style checklist with progress tracking and status statistics.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/checklist-manager` — responsive React/Vite dashboard and checklist workspace
- `artifacts/api-server/src/routes/checklists.ts` — checklist CRUD, status updates, and statistics API
- `lib/api-spec/openapi.yaml` — source of truth for checklist API contracts
- `lib/db/src/schema/checklists.ts` — PostgreSQL schema for checklists and checklist items
- `lib/api-client-react/src/generated` — generated React Query hooks and types

## Architecture decisions

- Pasted text is parsed into one checklist item per non-empty line on the server, stripping common bullet and numbered-list prefixes.
- Checklist item status is stored as a text value constrained by the API contract to `todo`, `in_progress`, `done`, or `blocked`.
- Checklist progress and dashboard statistics are computed from persisted item rows so reloads and other sessions see the same state.

## Product

- Paste bullets with an optional checklist name to create a live checklist.
- View and switch between saved checklists.
- Change item statuses, rename checklists, and delete checklists.
- See completion rate, total items, status counts, progress bars, and recent activity.

## User preferences

- Keep the experience direct: users should be able to paste a list and start updating statuses immediately.

## Gotchas

- Run API codegen after editing `lib/api-spec/openapi.yaml`.
- Run `pnpm --filter @workspace/db run push` after changing the database schema.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
