import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Anmelden",
};

// Bewusst kein <Card>: die Karten-Primitive registriert einen
// onKeyDown-Handler und lässt sich deshalb nur aus Client Components heraus
// rendern ("Event handlers cannot be passed to Client Component props").
// Diese Seite ist eine Server Component - sie nutzt dieselben Klassen
// (ui-card), sodass das Aussehen identisch bleibt, ohne die gesamte Seite
// zur Client Component zu machen.
//
// `redirectTo` wird hier serverseitig gelesen und als Prop weitergereicht,
// statt im Formular über useSearchParams: sonst müsste das Formular in eine
// Suspense-Grenze und wäre im ausgelieferten HTML gar nicht enthalten.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = params.redirectTo;
  const redirectTo = Array.isArray(raw) ? raw[0] : raw;

  return (
    <div className="login-page">
      <div className="ui-card ui-card--default login-card">
        <div className="login-intro">
          <strong className="login-brand">
            Planner<em>-Agent</em>
          </strong>
          <h1 className="login-title">Anmelden</h1>
          <p className="login-subtitle">
            Bitte mit den Zugangsdaten anmelden, die für dieses Team hinterlegt wurden.
          </p>
        </div>

        <LoginForm redirectTo={redirectTo ?? null} />
      </div>
    </div>
  );
}
