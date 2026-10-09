# backend

API for `/api/*` (`docs/api-contract.md`), deployed as the Lambda `ssi-events-api`. TypeScript,
Node 24, bundled with esbuild. Data model: `docs/data-model.md`.

```bash
npm ci
npm run dev          # local API on :4000 with an in-memory table and sample data
npm run typecheck
npm test             # node:test against an in-memory DynamoDB stand-in (test/fake-table.ts)
npm run build        # dist/index.mjs
npm run smoke        # loads the built bundle
```

| Path | Contents |
| --- | --- |
| `src/handler.ts` | Router; every endpoint is registered here |
| `src/routes/` | Endpoint handlers |
| `src/lib/` | Auth, bookings, email, analytics, scheduling, images |
| `src/db/table.ts` | DynamoDB client and key builders |
| `scripts/` | `create-admin.ts` (needs AWS credentials), `dev-server.ts` |

New DynamoDB condition or update expressions should also be run once against the real table (on
throwaway `TEST#` items); the in-memory stand-in does not check reserved words.
