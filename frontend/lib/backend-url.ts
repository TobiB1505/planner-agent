// Reine, testbare Auflösung der Backend-Rewrite-Ziel-URL für next.config.ts.
// Getrennt von next.config.ts, weil next.config.ts selbst schwer direkt zu
// testen ist (Next.js lädt/wertet die Datei aus, kein normales ESM-Modul für
// Vitest) - siehe frontend/lib/backend-url.test.ts.

export class BackendUrlConfigError extends Error {}

interface BackendUrlEnv {
  APP_ENV?: string;
  BACKEND_INTERNAL_URL?: string;
  // Erlaubt process.env (NodeJS.ProcessEnv, ein Index-Signatur-Typ) direkt
  // als Default-Wert - ohne das sieht TS "keine gemeinsamen Properties"
  // zwischen einem rein optionalen Interface und einem Index-Signatur-Typ.
  [key: string]: string | undefined;
}

const DEFAULT_LOCAL_BACKEND_URL = "http://127.0.0.1:8000";

// "local" ist der Default, wenn APP_ENV nicht gesetzt ist (lokale
// Entwicklung, Tests, CI-Build ohne explizite Umgebung) - nur ein
// *explizites* APP_ENV=preview/production verlangt BACKEND_INTERNAL_URL.
function requiresExplicitBackendUrl(appEnv: string | undefined): boolean {
  return appEnv === "preview" || appEnv === "production";
}

/**
 * Löst die Backend-Basis-URL für den next.config.ts-Rewrite auf.
 *
 * - BACKEND_INTERNAL_URL gesetzt: wird validiert (nur http/https), von
 *   abschließenden Slashes befreit und zurückgegeben - unabhängig von APP_ENV.
 * - BACKEND_INTERNAL_URL fehlt, APP_ENV unbekannt/"local": fällt auf
 *   localhost:8000 zurück (bisheriges Verhalten für lokale Entwicklung).
 * - BACKEND_INTERNAL_URL fehlt, APP_ENV="preview"/"production": wirft
 *   BackendUrlConfigError - kein stiller Fallback auf localhost in der Cloud.
 */
export function resolveBackendUrl(env: BackendUrlEnv = process.env): string {
  const raw = env.BACKEND_INTERNAL_URL;

  if (!raw) {
    if (requiresExplicitBackendUrl(env.APP_ENV)) {
      throw new BackendUrlConfigError(
        `BACKEND_INTERNAL_URL muss gesetzt sein, wenn APP_ENV=${env.APP_ENV} ist - ` +
          "kein impliziter Fallback auf localhost in Preview/Production.",
      );
    }
    return DEFAULT_LOCAL_BACKEND_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BackendUrlConfigError(`BACKEND_INTERNAL_URL ist keine gültige URL: "${raw}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BackendUrlConfigError(
      `BACKEND_INTERNAL_URL muss http:// oder https:// verwenden, nicht "${parsed.protocol}" (Wert: "${raw}")`,
    );
  }

  return raw.replace(/\/+$/, "");
}

/** Vollständiges Rewrite-Ziel für next.config.ts - hängt /api/:path* genau einmal an. */
export function backendRewriteDestination(env?: BackendUrlEnv): string {
  return `${resolveBackendUrl(env)}/api/:path*`;
}
