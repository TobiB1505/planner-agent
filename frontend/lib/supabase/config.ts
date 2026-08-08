// Zentrale Auflösung der Supabase-Konfiguration für das Frontend.
//
// Nur die beiden öffentlichen Werte - Projekt-URL und Publishable Key. Der
// Service-Role-Key hat im Frontend nichts zu suchen und taucht deshalb hier
// nirgends auf, auch nicht als optionaler Fallback.
//
// Wichtig: NEXT_PUBLIC_*-Variablen werden von Next.js zur Build-Zeit in den
// Code eingesetzt. Das funktioniert nur bei direktem, statisch lesbarem
// Zugriff auf process.env.<NAME> - deshalb stehen die beiden Namen hier
// ausgeschrieben und werden nicht dynamisch zusammengebaut.

export class SupabaseConfigError extends Error {}

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

/**
 * Liefert die Konfiguration oder wirft mit einer Meldung, die sagt, was zu
 * tun ist. Bewusst kein stiller Fallback auf eine Demo-Instanz und kein
 * "dann eben ohne Anmeldung" - ein fehlkonfiguriertes Deployment soll
 * auffallen, nicht scheinbar funktionieren.
 */
export function requireSupabaseConfig(): { url: string; publishableKey: string } {
  if (!isSupabaseConfigured()) {
    throw new SupabaseConfigError(
      "Supabase ist nicht konfiguriert: NEXT_PUBLIC_SUPABASE_URL und " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY müssen gesetzt sein " +
        "(siehe docs/auth/SUPABASE_AUTH_SETUP.md).",
    );
  }
  return { url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY };
}
