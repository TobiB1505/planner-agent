import type { NextConfig } from "next";
import { backendRewriteDestination } from "./lib/backend-url";

// Serverseitige (nicht NEXT_PUBLIC_) Variable: nur der Next.js-Server sieht
// sie beim Rewrite, der Browser bekommt sie nie zu Gesicht. Der Browser
// spricht immer nur die eigene Origin (relative /api/...-Aufrufe) an, siehe
// frontend/lib/api.ts.
//
// backendRewriteDestination() wirft synchron beim Modul-Laden (also beim
// `next build`/`next start`-Start), wenn APP_ENV=preview/production gesetzt
// ist, aber BACKEND_INTERNAL_URL fehlt - kein stiller Fallback auf
// localhost in der Cloud (siehe frontend/lib/backend-url.ts).
const rewriteDestination = backendRewriteDestination();

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: rewriteDestination,
      },
    ];
  },
};

export default nextConfig;
