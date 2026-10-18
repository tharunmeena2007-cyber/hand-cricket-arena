# Hand Cricket Arena

A private multiplayer browser game where friends create rooms and compete in Normal Hand Cricket or Baseball Mode.

## Run & Operate

- `pnpm --filter @workspace/hand-cricket-arena run dev` — run the game frontend
- `pnpm --filter @workspace/api-server run dev` — run the API and Socket.IO game server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

The game keeps rooms in memory; room and match data are not persisted after the API server restarts.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite
- API and real-time game server: Express 5 + Socket.IO
- Room state: in-memory, server-authoritative
- Shared workspace DB package: PostgreSQL + Drizzle ORM (not used by game rooms)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/hand-cricket-arena/` — game interface and browser Socket.IO client
- `artifacts/api-server/src/game/` — room management and match rules
- `lib/api-spec/openapi.yaml` — REST service status contract

## Architecture decisions

- Match rules, room limits, and winners are calculated by the server.
- A disconnected player keeps their place temporarily so the same browser session can reconnect.
- Rooms with no connected players are cleared after ten minutes.

## Product

- Create private rooms with a unique six-character code and invite up to seven friends.
- Choose Team A or Team B, then play Normal Hand Cricket or Baseball Mode.
- Follow a live scoreboard, innings, targets, strikes, outs, and match results.

## User preferences

- Keep the specified dark navy and bright green cricket-arena palette and make room-setup headings prominent.

## Gotchas

- Keep `/socket.io` listed on the API service route so the Replit proxy forwards live game connections.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
