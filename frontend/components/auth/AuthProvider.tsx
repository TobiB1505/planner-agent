"use client";

// Stellt den angemeldeten Benutzer im Client-Baum bereit.
//
// Der Ausgangswert kommt vom Server (app/layout.tsx hat ihn bereits von
// FastAPI geholt) - dadurch steht die Rolle beim ersten Rendern fest und die
// Navigation "springt" nicht von Planner- auf Employee-Ansicht.
//
// Der Kontext ist eine Bequemlichkeit für die Oberfläche, keine
// Sicherheitsgrenze: er entscheidet, welche Links sichtbar sind. Ob ein
// Aufruf erlaubt ist, entscheidet FastAPI bei jedem einzelnen Request.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AppUser } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";
import { LOGIN_PATH } from "@/lib/auth/route-access";

interface AuthContextValue {
  user: AppUser | null;
  signingOut: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: AppUser | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      // Beendet die Session in Supabase und löscht die Auth-Cookies.
      await createClient().auth.signOut();
    } catch {
      // Auch wenn Supabase gerade nicht erreichbar ist: lokal abmelden und
      // zur Login-Seite - eine halb abgemeldete Oberfläche wäre schlimmer.
    } finally {
      // replace statt push: die geschützte Seite darf nicht über den
      // Zurück-Button aus dem Client-Cache wieder auftauchen.
      router.replace(LOGIN_PATH);
      // Verwirft zusätzlich den Router-Cache samt aller serverseitig
      // gerenderten Inhalte der vorherigen Sitzung.
      router.refresh();
      setSigningOut(false);
    }
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({ user: initialUser, signingOut, signOut }),
    [initialUser, signingOut, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth muss innerhalb von <AuthProvider> verwendet werden.");
  }
  return value;
}

/** Rolle oder null - Kurzform für Navigations-Entscheidungen. */
export function useRole() {
  return useAuth().user?.role ?? null;
}
