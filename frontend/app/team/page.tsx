"use client";

import PageHeader from "@/components/PageHeader";
import EmployeeIntelligenceDialog from "@/components/EmployeeIntelligenceDialog";
import {
  createPerson,
  deletePerson,
  getTeam,
  updatePerson,
  type Person,
} from "@/lib/api";
import { useEffect, useId, useMemo, useState } from "react";

type TeamView = "active" | "inactive";
type Notice = { kind: "success" | "error" | "info"; text: string };

export default function TeamPage() {
  const departmentListId = useId();
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<TeamView>("active");
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [profilePersonId, setProfilePersonId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      setPeople(await getTeam());
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Team konnte nicht geladen werden.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    getTeam()
      .then(setPeople)
      .catch((error) => {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "Team konnte nicht geladen werden.",
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const activeCount = people.filter((person) => person.active).length;
  const inactiveCount = people.length - activeCount;
  const departments = useMemo(
    () => Array.from(new Set(
      people
        .map((person) => person.department?.trim())
        .filter((value): value is string => Boolean(value)),
    )).sort((a, b) => a.localeCompare(b, "de")),
    [people],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de");
    return people
      .filter((person) => person.active === (view === "active"))
      .filter((person) =>
        !needle || `${person.name} ${person.department ?? ""}`
          .toLocaleLowerCase("de")
          .includes(needle))
      .sort((a, b) => {
        const byDepartment = (a.department ?? "").localeCompare(b.department ?? "", "de");
        return byDepartment || a.name.localeCompare(b.name, "de");
      });
  }, [people, query, view]);

  async function addPerson() {
    if (!name.trim()) return;
    setAdding(true);
    setNotice(null);
    try {
      await createPerson(name.trim(), department.trim());
      setName("");
      setDepartment("");
      setView("active");
      setAddOpen(false);
      setNotice({ kind: "success", text: "Mitarbeiter wurde zum aktiven Pool hinzugefügt." });
      await load();
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Mitarbeiter konnte nicht angelegt werden.",
      });
    } finally {
      setAdding(false);
    }
  }

  async function saveDetails(person: Person, nextName: string, nextDepartment: string) {
    const cleanName = nextName.trim();
    const cleanDepartment = nextDepartment.trim();
    if (!cleanName) throw new Error("Der Name darf nicht leer sein.");
    await updatePerson(person.id, {
      name: cleanName,
      department: cleanDepartment,
      active: person.active,
    });
    setPeople((current) => current.map((entry) =>
      entry.id === person.id
        ? { ...entry, name: cleanName, department: cleanDepartment || null }
        : entry));
  }

  async function changeStatus(person: Person, active: boolean) {
    setPeople((current) => current.map((entry) =>
      entry.id === person.id ? { ...entry, active } : entry));
    setNotice({
      kind: "info",
      text: active
        ? `${person.name} wird wieder aktiviert …`
        : `${person.name} wird aus dem aktiven Pool genommen …`,
    });
    try {
      await updatePerson(person.id, {
        name: person.name,
        department: person.department ?? "",
        active,
      });
      setNotice({
        kind: "success",
        text: active
          ? `${person.name} ist wieder aktiv und erscheint in den Planvorschlägen.`
          : `${person.name} ist jetzt inaktiv und wird nicht mehr vorgeschlagen.`,
      });
    } catch (error) {
      setPeople((current) => current.map((entry) =>
        entry.id === person.id ? { ...entry, active: person.active } : entry));
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Status konnte nicht geändert werden.",
      });
    }
  }

  async function remove(person: Person) {
    const confirmed = window.confirm(
      `${person.name} wirklich aus der Mitarbeiterverwaltung löschen?\n\nHistorische Dienstpläne bleiben unverändert erhalten.`,
    );
    if (!confirmed) return;
    try {
      await deletePerson(person.id);
      setPeople((current) => current.filter((entry) => entry.id !== person.id));
      setNotice({
        kind: "success",
        text: `${person.name} wurde gelöscht. Historische Dienstpläne bleiben erhalten.`,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Mitarbeiter konnte nicht gelöscht werden.",
      });
    }
  }

  return (
    <div className="team-page">
      <datalist id={departmentListId}>
        {departments.map((item) => <option value={item} key={item} />)}
      </datalist>

      <div className="team-page-head">
        <PageHeader
          title="Team"
          subtitle="Aktiver Mitarbeiterpool, Abteilungen und Namensvorschläge für die Planung"
        />
        <button
          type="button"
          className={`btn btn-primary team-add-trigger ${addOpen ? "is-open" : ""}`}
          onClick={() => setAddOpen((current) => !current)}
        >
          <span aria-hidden="true">{addOpen ? "×" : "+"}</span>
          {addOpen ? "Schließen" : "MA hinzufügen"}
        </button>
      </div>

      <section className="team-overview" aria-label="Teamübersicht">
        <div className="team-overview-main">
          <span className="team-eyebrow">Mitarbeiterpool</span>
          <strong>{activeCount} aktive Mitarbeiter</strong>
          <p>Nur aktive MA werden im Dienstplan automatisch vorgeschlagen.</p>
        </div>
        <div className="team-overview-stat is-active">
          <span>Aktiv</span>
          <strong>{activeCount}</strong>
        </div>
        <div className="team-overview-stat">
          <span>Inaktiv</span>
          <strong>{inactiveCount}</strong>
        </div>
        <div className="team-overview-stat">
          <span>Abteilungen</span>
          <strong>{departments.length}</strong>
        </div>
      </section>

      {addOpen && (
        <section className="team-add-panel">
          <div className="team-add-intro">
            <span className="team-add-icon" aria-hidden="true">+</span>
            <div>
              <span className="team-eyebrow">Neuer Mitarbeiter</span>
              <h2>Direkt zum aktiven Pool hinzufügen</h2>
              <p>Die Abteilung steuert später passende Empfehlungen im Plan-Editor.</p>
            </div>
          </div>
          <div className="team-add-fields">
            <label>
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Vor- und Nachname"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && name.trim()) void addPerson();
                }}
                autoFocus
              />
            </label>
            <label>
              <span>Abteilung</span>
              <input
                value={department}
                list={departmentListId}
                onChange={(event) => setDepartment(event.target.value)}
                placeholder="z. B. S&L oder SPT"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && name.trim()) void addPerson();
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={adding || !name.trim()}
              onClick={() => void addPerson()}
            >
              {adding && <span className="spinner" />}
              Zum Team hinzufügen
            </button>
          </div>
        </section>
      )}

      {notice && <div className={`status status-${notice.kind}`}>{notice.text}</div>}

      <section className="team-directory">
        <div className="team-directory-head">
          <div className="team-tabs" role="tablist" aria-label="Mitarbeiterstatus">
            <button
              type="button"
              role="tab"
              aria-selected={view === "active"}
              className={`team-tab ${view === "active" ? "is-active" : ""}`}
              onClick={() => setView("active")}
            >
              Aktiv <span>{activeCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "inactive"}
              className={`team-tab ${view === "inactive" ? "is-active" : ""}`}
              onClick={() => setView("inactive")}
            >
              Inaktiv <span>{inactiveCount}</span>
            </button>
          </div>

          <label className="team-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name oder Abteilung suchen"
              aria-label="Team durchsuchen"
            />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Suche leeren">×</button>}
          </label>
        </div>

        <div className="team-directory-labels" aria-hidden="true">
          <span>Mitarbeiter</span>
          <span>Name</span>
          <span>Abteilung</span>
          <span>Historie</span>
          <span>Status</span>
        </div>

        <div className="team-member-list">
          {loading && (
            <div className="team-empty-state">
              <span className="spinner" />
              <strong>Team wird geladen …</strong>
            </div>
          )}
          {!loading && filtered.map((person) => (
            <TeamMemberRow
              key={person.id}
              person={person}
              departmentListId={departmentListId}
              showDelete={view === "inactive"}
              onSave={saveDetails}
              onStatusChange={changeStatus}
              onDelete={remove}
              onNotice={setNotice}
              onOpenProfile={(personId) => setProfilePersonId(personId)}
            />
          ))}
          {!loading && filtered.length === 0 && (
            <div className="team-empty-state">
              <span aria-hidden="true">{query ? "⌕" : view === "active" ? "○" : "✓"}</span>
              <strong>
                {query
                  ? "Keine passenden Mitarbeiter gefunden"
                  : view === "active"
                    ? "Noch keine aktiven Mitarbeiter"
                    : "Keine inaktiven Mitarbeiter"}
              </strong>
              <p>
                {query
                  ? "Passe den Suchbegriff an."
                  : view === "active"
                    ? "Füge oben den ersten Mitarbeiter zum Pool hinzu."
                    : "Deaktivierte Mitarbeiter erscheinen automatisch hier."}
              </p>
            </div>
          )}
        </div>

        <div className="team-directory-foot">
          <span>{filtered.length} von {view === "active" ? activeCount : inactiveCount} angezeigt</span>
          <span>Änderungen an Name und Abteilung speichern automatisch</span>
        </div>
      </section>
      {profilePersonId !== null && (
        <EmployeeIntelligenceDialog
          personId={profilePersonId}
          onClose={() => setProfilePersonId(null)}
        />
      )}
    </div>
  );
}

function TeamMemberRow({
  person,
  departmentListId,
  showDelete,
  onSave,
  onStatusChange,
  onDelete,
  onNotice,
  onOpenProfile,
}: {
  person: Person;
  departmentListId: string;
  showDelete: boolean;
  onSave: (person: Person, name: string, department: string) => Promise<void>;
  onStatusChange: (person: Person, active: boolean) => Promise<void>;
  onDelete: (person: Person) => Promise<void>;
  onNotice: (notice: Notice) => void;
  onOpenProfile: (personId: number) => void;
}) {
  const [name, setName] = useState(person.name);
  const [department, setDepartment] = useState(person.department ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function commit() {
    const cleanName = name.trim();
    const cleanDepartment = department.trim();
    if (cleanName === person.name && cleanDepartment === (person.department ?? "")) return;
    setSaveState("saving");
    try {
      await onSave(person, cleanName, cleanDepartment);
      setName(cleanName);
      setDepartment(cleanDepartment);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1800);
    } catch (error) {
      setName(person.name);
      setDepartment(person.department ?? "");
      setSaveState("error");
      onNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Änderung konnte nicht gespeichert werden.",
      });
    }
  }

  const initials = person.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("de");

  return (
    <article className={`team-member-row ${person.active ? "" : "is-inactive"}`}>
      <div className="team-member-identity">
        <span className="team-member-avatar">{initials || "MA"}</span>
        <span>
          <strong>{person.name}</strong>
          <small>{person.department || "Ohne Abteilung"}</small>
        </span>
      </div>

      <label className="team-member-field">
        <span>Name</span>
        <input
          value={name}
          disabled={saveState === "saving"}
          onChange={(event) => {
            setName(event.target.value);
            setSaveState("idle");
          }}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setName(person.name);
              event.currentTarget.blur();
            }
          }}
        />
      </label>

      <label className="team-member-field">
        <span>Abteilung</span>
        <input
          value={department}
          list={departmentListId}
          disabled={saveState === "saving"}
          placeholder="Keine Abteilung"
          onChange={(event) => {
            setDepartment(event.target.value);
            setSaveState("idle");
          }}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDepartment(person.department ?? "");
              event.currentTarget.blur();
            }
          }}
        />
      </label>

      <div className="team-member-history">
        <strong>{person.total_assignments}</strong>
        <span>Zuweisungen</span>
      </div>

      <div className="team-member-actions">
        <span className={`team-save-state is-${saveState}`} aria-live="polite">
          {saveState === "saving" && "Speichert …"}
          {saveState === "saved" && "Gespeichert"}
          {saveState === "error" && "Fehler"}
          {saveState === "idle" && (person.active ? "Aktiv" : "Inaktiv")}
        </span>
        <button
          type="button"
          className="team-profile-button"
          onClick={() => onOpenProfile(person.id)}
        >
          Profil
        </button>
        <button
          type="button"
          className={`team-status-button ${person.active ? "is-active" : "is-inactive"}`}
          onClick={() => void onStatusChange(person, !person.active)}
        >
          <span aria-hidden="true" />
          {person.active ? "Deaktivieren" : "Aktivieren"}
        </button>
        {showDelete && (
          <button
            type="button"
            className="team-delete-button"
            onClick={() => void onDelete(person)}
            aria-label={`${person.name} löschen`}
            title="Mitarbeiter löschen"
          >
            Löschen
          </button>
        )}
      </div>
    </article>
  );
}
