"use client";

// Anmeldeformular - E-Mail und Passwort, mehr nicht.
//
// Bewusst nicht enthalten (Aufgabe 10): keine öffentliche Registrierung,
// keine Social Logins, kein Magic Link, kein "Passwort vergessen"-Fluss.
// Konten legt ein Administrator in Supabase an; alles andere wäre in einer
// internen Dienstplanung eine offene Tür.
//
// Gestaltung: ausschliesslich bestehende Bausteine des Designsystems
// (Card/Field/Input/Button/InlineStatus) - kein eigenes Login-Design.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InlineStatus from "@/components/ui/InlineStatus";
import Input from "@/components/ui/Input";
import { PLANNER_HOME, safeRedirectTarget } from "@/lib/auth/route-access";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

// Eine einzige, bewusst unspezifische Meldung für alle Anmeldefehler:
// "Passwort falsch" gegenüber "Konto existiert nicht" verrät, welche
// E-Mail-Adressen im System bekannt sind.
const CREDENTIALS_MESSAGE = "E-Mail oder Passwort ist nicht korrekt.";
const UNAVAILABLE_MESSAGE =
  "Die Anmeldung ist gerade nicht erreichbar. Bitte später erneut versuchen.";
const NOT_CONFIGURED_MESSAGE =
  "Die Anmeldung ist auf diesem System noch nicht eingerichtet.";

export default function LoginForm({ redirectTo }: { redirectTo: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const configured = isSupabaseConfigured();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setError(null);
    setPending(true);
    try {
      const { error: signInError } = await createClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        // Supabase unterscheidet u.a. ungültige Zugangsdaten von
        // Rate-Limits; nach aussen bleibt es bei zwei Meldungen.
        setError(signInError.status === 400 ? CREDENTIALS_MESSAGE : UNAVAILABLE_MESSAGE);
        return;
      }

      const target = safeRedirectTarget(redirectTo, PLANNER_HOME);
      // replace: die Login-Seite soll nicht im Verlauf zurückbleiben.
      router.replace(target);
      // Erzwingt einen Server-Rendervorgang mit der frischen Session -
      // erst dadurch kennt das Layout die Rolle und leitet ggf. weiter
      // (z.B. Mitarbeitende auf /employee).
      router.refresh();
    } catch {
      setError(UNAVAILABLE_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate>
      <Field label="E-Mail" required>
        <Input
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending || !configured}
        />
      </Field>

      <Field label="Passwort" required>
        <Input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={pending || !configured}
        />
      </Field>

      {!configured && <InlineStatus variant="warning">{NOT_CONFIGURED_MESSAGE}</InlineStatus>}
      {error && <InlineStatus variant="danger">{error}</InlineStatus>}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        disabled={!configured || !email || !password}
      >
        Anmelden
      </Button>
    </form>
  );
}
