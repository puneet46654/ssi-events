import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // events.ssistudios.com/ is the event catalogue (served by app/events/page.tsx).
  // Old /events links get a permanent redirect; detail and booking pages stay under /events/<id>.
  async redirects() {
    return [{ source: '/events', destination: '/', permanent: true }];
  },
  async rewrites() {
    return [{ source: '/', destination: '/events' }];
  },
  images: {
    localPatterns: [
      {
        pathname: '/logos/ssilogo.png',
      },
    ],
  },
};

export default nextConfig;
