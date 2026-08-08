// Session-Auffrischung für proxy.ts (in Next.js 16 heisst die frühere
// "Middleware" so).
//
// Warum das nötig ist: Access Tokens laufen nach kurzer Zeit ab. Nur an
// dieser Stelle kann die aufgefrischte Session als Set-Cookie an die Antwort
// gehängt werden - Server Components dürfen keine Cookies schreiben. Ohne
// diesen Schritt würde eine Sitzung nach Ablauf des Tokens serverseitig
// stillschweigend als "abgemeldet" gelten, obwohl der Browser noch ein
// gültiges Refresh Token hat.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

export interface SessionUpdate {
  /** Antwort mit ggf. aktualisierten Auth-Cookies. Immer weiterverwenden. */
  response: NextResponse;
  /** true, wenn eine Session existiert. Sagt nichts über die Rolle aus. */
  isAuthenticated: boolean;
}

export async function updateSession(request: NextRequest): Promise<SessionUpdate> {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured()) {
    // Ohne Konfiguration gibt es keine Session, die man auffrischen könnte.
    // Der Aufrufer behandelt das wie "nicht angemeldet"; das Backend lehnt
    // ohnehin jeden geschützten Aufruf ab.
    return { response, isAuthenticated: false };
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Antworten, die Auth-Cookies setzen, dürfen nie in einem CDN oder
        // Reverse Proxy landen - sonst bekäme ein anderer Benutzer diese
        // Cookies ausgeliefert. Die passenden Header liefert die Bibliothek
        // selbst mit.
        for (const [key, headerValue] of Object.entries(headers ?? {})) {
          response.headers.set(key, headerValue);
        }
      },
    },
  });

  // Muss vor dem Erzeugen der endgültigen Antwort passieren, damit ein
  // Refresh noch in die Cookies geschrieben werden kann.
  //
  // getClaims() statt getUser(): bei asymmetrischen Signaturschlüsseln
  // (Supabase-Standard) prüft es das Token lokal über die WebCrypto-API und
  // frischt die Session bei nahendem Ablauf trotzdem auf - ohne bei jeder
  // Navigation einen Netzwerk-Roundtrip zum Auth-Server zu erzwingen.
  //
  // Das Ergebnis wird hier ausschliesslich als "angemeldet ja/nein"
  // verwendet. Rolle und Berechtigung kommen niemals aus diesen Claims,
  // sondern aus app_users hinter FastAPI.
  const { data, error } = await supabase.auth.getClaims();

  return { response, isAuthenticated: !error && Boolean(data?.claims?.sub) };
}
