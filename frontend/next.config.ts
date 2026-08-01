import type { NextConfig } from "next";

// Serverseitige (nicht NEXT_PUBLIC_) Variable: nur der Next.js-Server sieht
// sie beim Rewrite, der Browser bekommt sie nie zu Gesicht. Der Browser
// spricht immer nur die eigene Origin (relative /api/...-Aufrufe) an, siehe
// frontend/lib/api.ts.
const backendUrl = process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
