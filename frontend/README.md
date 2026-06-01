# ICEDR Frontend

The frontend is a Vite + React client for the ICEDR drive workspace.

## Scripts

```bash
pnpm --filter frontend dev
pnpm --filter frontend lint
pnpm --filter frontend build
pnpm --filter frontend start
```

The dev server runs at `http://localhost:13000`.

## Environment

Use `VITE_API_BASE_URL` to point the browser client at the API:

```bash
VITE_API_BASE_URL=http://127.0.0.1:13001/api
```
