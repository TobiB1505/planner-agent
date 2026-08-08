"use client";

// Supabase-Client für den Browser.
//
// Die Session liegt in Cookies (nicht in localStorage) - dafür sorgt
// @supabase/ssr: derselbe Speicherort, den der Server in server.ts und
// proxy.ts liest. Nur so sehen Server Components, Proxy und Browser
// denselben Anmeldezustand, und nur so überlebt eine Anmeldung ein
// Neuladen der Seite serverseitig.

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseConfig } from "./config";

/**
 * Gibt den (prozessweit einmaligen) Browser-Client zurück.
 *
 * @supabase/ssr hält intern eine Singleton-Instanz - mehrfaches Aufrufen
 * erzeugt keine zweite Session und keinen zweiten Token-Refresh-Timer.
 */
export function createClient() {
  const { url, publishableKey } = requireSupabaseConfig();
  return createBrowserClient(url, publishableKey);
}

/**
 * Das aktuelle Access Token für Aufrufe an das eigene Backend.
 *
 * `getSession()` erneuert ein abgelaufenes Token bei Bedarf selbst und
 * schreibt das Ergebnis zurück in die Cookies. Ist niemand angemeldet oder
 * ist Supabase nicht konfiguriert, kommt null zurück - der Aufrufer schickt
 * dann eben keinen Authorization-Header, und das Backend antwortet mit 401.
 * Das ist der gewünschte Weg: die Entscheidung fällt im Backend.
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
