"use client";

import PageHeader from "@/components/PageHeader";
import EmployeeIntelligenceDialog from "@/components/EmployeeIntelligenceDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  createPerson,
  deletePerson,
  getTeam,
  getTeamIntelligenceOverview,
  updatePerson,
  type Person,
  type TeamIntelligenceOverview,
  type TeamIntelligencePerson,
} from "@/lib/api";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

type TeamView = "active" | "inactive";
type IntelligenceView = "all" | "ready" | "attention";
type Notice = { kind: "success" | "error" | "info"; text: string };

function currentMonday(): string {
  const now = new Date();
  const weekday = now.getDay() || 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1, 12);
  return monday.toLocaleDateString("sv-SE");
}

export default function TeamPage() {
  const departmentListId = useId();
  const { toast } = useToast();
  const [people, setPeople] = useState<Person[]>([]);
  const [intelligence, setIntelligence] = useState<TeamIntelligenceOverview | null>(null);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<TeamView>("active");
  const [intelligenceView, setIntelligenceView] = useState<IntelligenceView>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [profilePersonId, setProfilePersonId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Person | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [teamResult, intelligenceResult] = await Promise.allSettled([
        getTeam(),
        getTeamIntelligenceOverview({ currentWeekStart: currentMonday() }),
      ]);
      if (teamResult.status === "rejected") throw teamResult.reason;
      setPeople(teamResult.value);
      if (intelligenceResult.status === "fulfilled") {
        setIntelligence(intelligenceResult.value);
      } else {
        setNotice({
          kind: "info",
          text: "Team ist verfügbar, die Intelligence-Auswertung konnte aber nicht geladen werden.",
        });
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Team konnte nicht geladen werden.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadIntelligence = useCallback(async () => {
    try {
      setIntelligence(await getTeamIntelligenceOverview({ currentWeekStart: currentMonday() }));
    } catch {
      setNotice({ kind: "info", text: "Profil gespeichert; die Übersicht wird beim nächsten Laden aktualisiert." });
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      getTeam(),
      getTeamIntelligenceOverview({ currentWeekStart: currentMonday() }),
    ]).then(([teamResult, intelligenceResult]) => {
      if (!active) return;
      if (teamResult.status === "rejected") throw teamResult.reason;
      setPeople(teamResult.value);
      if (intelligenceResult.status === "fulfilled") {
        setIntelligence(intelligenceResult.value);
      } else {
        setNotice({
          kind: "info",
          text: "Team ist verfügbar, die Intelligence-Auswertung konnte aber nicht geladen werden.",
        });
      }
    }).catch((error) => {
      if (!active) return;
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Team konnte nicht geladen werden.",
      });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
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
  const intelligenceById = useMemo(
    () => new Map((intelligence?.people ?? []).map((item) => [item.person_id, item])),
    [intelligence],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de");
    return people
      .filter((person) => person.active === (view === "active"))
      .filter((person) =>
        !needle || `${person.name} ${person.department ?? ""}`
          .toLocaleLowerCase("de")
          .includes(needle))
      .filter((person) => {
        const profile = intelligenceById.get(person.id);
        if (intelligenceView === "ready") {
          return profile?.data_status === "ready" && profile.planning_hint.tone !== "warning";
        }
        if (intelligenceView === "attention") {
          return !profile || profile.data_status !== "ready" || profile.planning_hint.tone === "warning";
        }
        return true;
      })
      .sort((a, b) => {
        const byDepartment = (a.department ?? "").localeCompare(b.department ?? "", "de");
        return byDepartment || a.name.localeCompare(b.name, "de");
      });
  }, [intelligenceById, intelligenceView, people, query, view]);

  const intelligenceSummary = intelligence?.summary;
  const intelligenceCoverage = activeCount
    ? Math.round(((intelligenceSummary?.with_history ?? 0) / activeCount) * 100)
    : 0;

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
    await loadIntelligence();
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
      await loadIntelligence();
    } catch (error) {
      setPeople((current) => current.map((entry) =>
        entry.id === person.id ? { ...entry, active: person.active } : entry));
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Status konnte nicht geändert werden.",
      });
    }
  }

  function remove(person: Person) {
    setDeleteTarget(person);
  }

  async function confirmDelete() {
    const person = deleteTarget;
    if (!person) return;
    setDeleting(true);
    try {
      await deletePerson(person.id);
      setPeople((current) => current.filter((entry) => entry.id !== person.id));
      await loadIntelligence();
      toast({
        variant: "success",
        title: `${person.name} wurde gelöscht`,
        description: "Historische Dienstpläne bleiben erhalten.",
      });
      setDeleteTarget(null);
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Mitarbeiter konnte nicht gelöscht werden.",
      });
    } finally {
      setDeleting(false);
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
          subtitle="Mitarbeiterpool, Skills, Historie und planungsrelevante Hinweise"
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
          <span className="team-eyebrow">Mitarbeiter Intelligence</span>
          <strong>{intelligenceCoverage}% Historien-Abdeckung</strong>
          <p>Historie, Skills und Memory machen Planungsvorschläge nachvollziehbar.</p>
          <div className="team-overview-signals">
            <span><i className="is-positive" /> {intelligenceSummary?.current_week_assignments ?? 0} Einsätze diese Woche</span>
            <span><i className={(intelligenceSummary?.current_week_conflicts ?? 0) ? "is-warning" : "is-positive"} /> {intelligenceSummary?.current_week_conflicts ?? 0} Konflikte</span>
          </div>
        </div>
        <div className="team-overview-stat is-active">
          <span>Aktiver Pool</span>
          <strong>{activeCount}</strong>
          <small>für Vorschläge</small>
        </div>
        <div className="team-overview-stat">
          <span>Mit Historie</span>
          <strong>{intelligenceSummary?.with_history ?? 0}<em>/{activeCount}</em></strong>
          <small>belegte Einsätze</small>
        </div>
        <div className="team-overview-stat">
          <span>Mit Skills</span>
          <strong>{intelligenceSummary?.with_skills ?? 0}<em>/{activeCount}</em></strong>
          <small>erklärbare Stärken</small>
        </div>
        <div className="team-overview-stat is-attention">
          <span>Daten prüfen</span>
          <strong>{intelligenceSummary?.attention_people ?? 0}</strong>
          <small>Hinweise oder Lücken</small>
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
        <div className="team-intelligence-filters" role="group" aria-label="Intelligence-Datenstatus">
          <span>Datenstatus</span>
          <button type="button" className={intelligenceView === "all" ? "is-active" : ""} onClick={() => setIntelligenceView("all")}>Alle</button>
          <button type="button" className={intelligenceView === "ready" ? "is-active" : ""} onClick={() => setIntelligenceView("ready")}>Planungsbereit</button>
          <button type="button" className={intelligenceView === "attention" ? "is-active" : ""} onClick={() => setIntelligenceView("attention")}>Daten prüfen</button>
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
              intelligence={intelligenceById.get(person.id)}
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
          onClose={() => {
            setProfilePersonId(null);
            void loadIntelligence();
          }}
        />
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        variant="danger"
        title={deleteTarget ? `${deleteTarget.name} löschen?` : "Mitarbeiter löschen?"}
        description={
          <p>
            {deleteTarget?.name} wird endgültig aus der Mitarbeiterverwaltung entfernt. Historische Dienstpläne
            bleiben unverändert erhalten.
          </p>
        }
        onDismiss={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        actions={[
          { label: "Abbrechen", variant: "default", autoFocus: true, disabled: deleting, onClick: () => setDeleteTarget(null) },
          { label: deleting ? "Löscht …" : "Endgültig löschen", variant: "danger", disabled: deleting, onClick: () => void confirmDelete() },
        ]}
      />
    </div>
  );
}

function TeamMemberRow({
  person,
  intelligence,
  departmentListId,
  showDelete,
  onSave,
  onStatusChange,
  onDelete,
  onNotice,
  onOpenProfile,
}: {
  person: Person;
  intelligence?: TeamIntelligencePerson;
  departmentListId: string;
  showDelete: boolean;
  onSave: (person: Person, name: string, department: string) => Promise<void>;
  onStatusChange: (person: Person, active: boolean) => Promise<void>;
  onDelete: (person: Person) => void;
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
    <article
      className={`team-member-card ${person.active ? "" : "is-inactive"}`}
      role="button"
      tabIndex={0}
      aria-label={`Intelligence-Profil von ${person.name} öffnen`}
      onClick={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("button, input, select, textarea, a, label")) return;
        onOpenProfile(person.id);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenProfile(person.id);
        }
      }}
    >
      <header className="team-member-card-head">
        <div className="team-member-identity">
          <span className="team-member-avatar">{initials || "MA"}</span>
          <span>
            <strong>{person.name}</strong>
            <small>{person.department || "Ohne Abteilung"}</small>
          </span>
        </div>
        <span className="team-member-card-meta">
          <span className={`team-data-status is-${intelligence?.data_status ?? "new"}`}>
            {intelligence?.data_status === "ready" ? "Planungsbereit" : intelligence?.data_status === "learning" ? "Lernt" : "Neue Datenbasis"}
          </span>
          <span className="team-member-open-cue" aria-hidden="true">›</span>
        </span>
      </header>

      <div className="team-member-intelligence">
        <div className="team-member-metrics">
          <span><strong>{intelligence?.current_week.assignments ?? 0}</strong><small>Diese Woche</small></span>
          <span><strong>{intelligence?.history_assignments ?? person.total_assignments}</strong><small>Historie</small></span>
          <span><strong>{intelligence?.memory_count ?? 0}</strong><small>Memory</small></span>
        </div>
        <div className="team-skill-strip">
          {intelligence?.top_skills.length ? intelligence.top_skills.map((skill) => (
            <span key={skill.id}>{skill.name}<small>{skill.level}★</small></span>
          )) : <span className="is-empty">Noch keine belegten Skills</span>}
        </div>
        {intelligence && (
          <div className={`team-planning-hint tone-${intelligence.planning_hint.tone}`}>
            <i aria-hidden="true" />
            <span><strong>{intelligence.planning_hint.label}</strong><small>{intelligence.planning_hint.text}</small></span>
          </div>
        )}
      </div>

      <div className="team-member-edit-grid">
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
      </div>

      <footer className="team-member-actions">
        <span className={`team-save-state is-${saveState}`} aria-live="polite">
          {saveState === "saving" && "Speichert …"}
          {saveState === "saved" && "Gespeichert"}
          {saveState === "error" && "Fehler"}
          {saveState === "idle" && (person.active ? "Aktiv" : "Inaktiv")}
        </span>
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
      </footer>
    </article>
  );
}
