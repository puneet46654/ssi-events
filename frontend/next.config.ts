import type { NextConfig } from "next";
import path from "node:path";

// The demo API route (app/api/[...path]) imports the backend from ../backend.
const repoRoot = path.resolve(process.cwd(), "..");

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // Next 16 writes AGENTS.md/CLAUDE.md on `next dev` unless this is off.
  agentRules: false,
  // events.ssistudios.com/ is the event catalogue (served by app/events/page.tsx).
  // Old /events links get a permanent redirect; detail and booking pages stay under /events/<id>.
  async redirects() {
    return [{ source: '/events', destination: '/', permanent: true }];
  },
  async rewrites() {
    const routes = [{ source: '/', destination: '/events' }];
    const apiProxy: typeof routes = [];
    // Local development only: /api is served by the backend dev server (backend: npm run dev).
    // In production CloudFront routes /api/* to the backend Lambda and this rewrite does not exist.
    // A local production build (`next build && next start`, for realistic speed) opts in by setting
    // API_PROXY_TARGET at build time; the release pipeline never sets it.
    if (process.env.NODE_ENV === 'development' || process.env.API_PROXY_TARGET) {
      apiProxy.push({ source: '/api/:path*', destination: `${process.env.API_PROXY_TARGET || 'http://localhost:4000'}/api/:path*` });
    }
    // beforeFiles: the proxy wins over the demo /api route when a local backend is used.
    return { beforeFiles: apiProxy, afterFiles: routes, fallback: [] };
  },
  // The backend (used by the demo /api route) imports its TypeScript files with .js extensions.
  // The demo is built with webpack (next build --webpack), which can map those.
  webpack(config, { isServer }) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], ...config.resolve.extensionAlias };
    // The demo's in-memory table recognises AWS SDK commands by class name: keep server names intact.
    if (isServer) config.optimization.minimize = false;
    return config;
  },
  images: {
    localPatterns: [
      {
        pathname: '/logos/**',
      },
    ],
  },
};

export default nextConfig;
