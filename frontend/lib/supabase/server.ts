// Supabase-Client für Server Components, Server Actions und Route Handler.
//
// Nur serverseitig verwenden: `next/headers` ist im Browser-Bundle nicht
// verfügbar, ein versehentlicher Import aus einer Client-Komponente scheitert
// deshalb bereits beim Build (kein zusätzliches "server-only"-Paket nötig).
//
// Pro Anfrage ein neuer Client - niemals einen Client zwischen Requests
// teilen, sonst könnte die Session eines Benutzers bei einem anderen landen.
//
// Das Schreiben von Cookies ist in Server Components nicht erlaubt (Next.js
// wirft dort). Das ist kein Problem: das Auffrischen der Session übernimmt
// proxy.ts, das bei jeder Anfrage vorher läuft und die neuen Cookies an die
// Antwort hängt. Der try/catch unten fängt genau diesen erwarteten Fall ab.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseConfig } from "./config";

export async function createClient() {
  const { url, publishableKey } = requireSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Aufruf aus einer Server Component: Cookies sind dort read-only.
          // proxy.ts hat die Session bereits aufgefrischt.
        }
      },
    },
  });
}

/**
 * Das Access Token der aktuellen Server-Anfrage - oder null.
 *
 * Wird nur verwendet, um es an FastAPI weiterzureichen. Die inhaltliche
 * Prüfung (Signatur, Issuer, Ablauf) passiert dort, nicht hier: das
 * Frontend behandelt das Token als undurchsichtige Zeichenkette.
 */
export async function getServerAccessToken(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
