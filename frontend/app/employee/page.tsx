import type { Metadata } from "next";
import { getAppUser } from "@/lib/auth/app-user";

export const metadata: Metadata = {
  title: "Meine Übersicht",
};

// Auth-Sprint, Aufgabe 29: bewusst nur eine kleine, funktionale Startseite.
// Der eigentliche Mitarbeiterbereich (mein Dienstplan, Künstlerplan,
// Probenplan) entsteht im Employee-Portal-Sprint. Was hier steht, beweist,
// dass die Kette Anmeldung -> Rolle -> Person funktioniert: der Name kommt
// aus der people-Tabelle, verknüpft über app_users.person_id.

const UPCOMING = [
  {
    title: "Mein Dienstplan",
    description: "Die eigenen Einsätze der aktuellen und der kommenden Wochen.",
  },
  {
    title: "Künstlerplan",
    description: "Der Künstlerplan der Woche, wie er im Haus aushängt.",
  },
  {
    title: "Probenplan",
    description: "Proben mit Zeit, Ort und Beteiligten.",
  },
];

export default async function EmployeeHomePage() {
  const user = await getAppUser();
  const name = user?.personName ?? user?.email ?? "willkommen";

  return (
    <div className="employee-home">
      <header className="employee-home-header">
        <h1>Hallo {name}</h1>
        <p>
          Dein Mitarbeiterbereich wird gerade aufgebaut. Die folgenden Bereiche kommen als
          Nächstes dazu.
        </p>
      </header>

      <div className="employee-home-grid">
        {UPCOMING.map((item) => (
          // Kein <Card>: die Primitive braucht eine Client Component (Event-Handler);
          // diese Seite ist eine Server Component und nutzt dieselben Klassen.
          <article key={item.title} className="ui-card ui-card--default employee-home-card">
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            <span className="employee-home-badge">In Vorbereitung</span>
          </article>
        ))}
      </div>

      {user?.personId === null && (
        <p className="employee-home-note">
          Diesem Konto ist noch keine Person aus dem Team zugeordnet. Sobald die Zuordnung
          vorliegt, erscheinen hier die eigenen Dienste.
        </p>
      )}
    </div>
  );
}
