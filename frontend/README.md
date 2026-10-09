# frontend

Next.js 16 site for https://events.ssistudios.com. See `../docs/frontend-developer-guide.md`.

```bash
npm ci
npm run dev        # http://localhost:3000, /api proxied to the local backend on :4000
npm test           # unit tests
npm run lint
npx next build     # production build (standalone output, deployed to Lambda)
```
