// Next.js 16: was früher "middleware" hiess, heisst jetzt "proxy" (siehe
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
// Gleiche Funktion, gleicher Platz im Projektstamm, neuer Name.
//
// Zwei Aufgaben, mehr nicht:
//
//  1. Session auffrischen. Nur hier lassen sich die von Supabase erneuerten
//     Auth-Cookies an die Antwort hängen - Server Components dürfen keine
//     Cookies schreiben. Ohne diesen Schritt würde eine Sitzung nach Ablauf
//     des Access Tokens serverseitig als abgemeldet gelten.
//
//  2. Optimistische Weiterleitung. Wer gar keine Session hat, wird sofort auf
//     /login geschickt, ohne dass eine geschützte Seite überhaupt gerendert
//     wird.
//
// Was hier bewusst NICHT passiert: die Rolle nachschlagen. Der Proxy läuft
// bei jeder Navigation und sogar bei Prefetches; ein Backend-Aufruf pro
// Route wäre teuer und laut Next.js-Dokumentation ausdrücklich nicht das,
// wofür Proxy gedacht ist ("avoid database checks"). Die rollenabhängige
// Entscheidung fällt einmal pro Seitenaufbau in app/layout.tsx - und die
// echte Sperre ohnehin in FastAPI.

import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH, PATHNAME_HEADER, requiredAccessFor } from "@/lib/auth/route-access";
import { updateSession } from "@/lib/supabase/proxy-session";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Server Components kennen den angefragten Pfad nicht von sich aus - der
  // dokumentierte Weg, ihn weiterzureichen, ist ein Request-Header. Muss
  // gesetzt sein, BEVOR updateSession() die Antwort erzeugt, weil die
  // Request-Header dort in die Antwort übernommen werden.
  request.headers.set(PATHNAME_HEADER, pathname);

  const { response, isAuthenticated } = await updateSession(request);

  // /control/* sind Route Handler, keine Seiten (siehe
  // app/control/backend/*). Sie beantworten JSON und prüfen ihre Rolle
  // selbst - eine Weiterleitung auf eine HTML-Seite wäre dort die falsche
  // Antwort, genau wie bei /api/*. Die Session wird für sie trotzdem
  // aufgefrischt, damit ein gerade abgelaufenes Token nicht unnötig zu 401
  // führt.
  const isRouteHandler = pathname.startsWith("/control");
  const requiresLogin = !isRouteHandler && requiredAccessFor(pathname) !== "public";

  if (requiresLogin && !isAuthenticated) {
    const target = request.nextUrl.clone();
    target.pathname = LOGIN_PATH;
    target.search = "";
    target.searchParams.set("redirectTo", `${pathname}${search}`);
    const redirect = NextResponse.redirect(target);
    // Auffrischungs-Cookies aus updateSession nicht verlieren.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  // Genau diese Antwort weiterreichen: sie trägt die ggf. erneuerten
  // Auth-Cookies und die zugehörigen Cache-Control-Header.
  return response;
}

export const config = {
  // Statische Dateien, Bilder und die eigenen Icons bleiben aussen vor -
  // sonst würde jede CSS-/JS-Datei durch die Auth-Logik laufen.
  //
  // /api/* ist bewusst ausgenommen: diese Pfade werden per Rewrite direkt an
  // FastAPI weitergereicht, das jeden Aufruf selbst prüft. Ein Redirect auf
  // /login wäre hier auch falsch - ein API-Aufruf will einen Statuscode,
  // keine HTML-Seite.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
