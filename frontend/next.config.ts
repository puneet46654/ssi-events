import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Next 16 writes AGENTS.md/CLAUDE.md on `next dev` unless this is off.
  agentRules: false,
  // events.ssistudios.com/ is the event catalogue (served by app/events/page.tsx).
  // Old /events links get a permanent redirect; detail and booking pages stay under /events/<id>.
  async redirects() {
    return [{ source: '/events', destination: '/', permanent: true }];
  },
  async rewrites() {
    const routes = [{ source: '/', destination: '/events' }];
    // Local development only: /api is served by the backend dev server (backend: npm run dev).
    // In production CloudFront routes /api/* to the backend Lambda and this rewrite does not exist.
    // A local production build (`next build && next start`, for realistic speed) opts in by setting
    // API_PROXY_TARGET at build time; the release pipeline never sets it.
    if (process.env.NODE_ENV === 'development' || process.env.API_PROXY_TARGET) {
      routes.push({ source: '/api/:path*', destination: `${process.env.API_PROXY_TARGET || 'http://localhost:4000'}/api/:path*` });
    }
    return routes;
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
