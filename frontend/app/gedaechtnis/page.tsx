"use client";

import EmployeeIntelligenceDialog from "@/components/EmployeeIntelligenceDialog";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InlineStatus from "@/components/ui/InlineStatus";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import {
  getMemory,
  getTeamIntelligenceOverview,
  setMemoryFree,
  setMemoryShow,
  setMemoryTask,
  type MemoryOverview,
  type PersonMemory,
  type TeamIntelligenceOverview,
  type TeamIntelligencePerson,
} from "@/lib/api";
import { useScrollDetailIntoView } from "@/lib/useScrollDetailIntoView";
import { useEffect, useMemo, useState } from "react";

const SHOW_CHOICES = [
  { key: "MR", label: "Moulin Rouge" },
  { key: "NY", label: "New York" },
  { key: "ROR", label: "Royals of Rock" },
  { key: "TGS", label: "The Greatest Show" },
  { key: "WI", label: "What If" },
  { key: "FYS", label: "Paradise on Fire" },
  { key: "BN", label: "Black Night" },
  { key: "WW", label: "Weiß-Weiß" },
];

const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
type MemorySection = "overview" | "shows" | "availability" | "tasks";

const MEMORY_SECTIONS: Array<{ id: MemorySection; label: string }> = [
  { id: "overview", label: "Überblick" },
  { id: "shows", label: "Shows & Partys" },
  { id: "availability", label: "Frei-Muster" },
  { id: "tasks", label: "Aufgaben-Profil" },
];

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

function germanDate(value: string | null): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" })
    .format(new Date(`${value}T12:00:00`));
}

function patternLabel(person: PersonMemory): string {
  const { pattern, weekdays, source } = person.free;
  if (source === "manuell") {
    return weekdays.length
      ? `Von dir festgelegt: ${weekdays.map((d) => WEEKDAYS_SHORT[d]).join(", ")}`
      : "Von dir festgelegt: kein festes Muster";
  }
  if (pattern === "insufficient") return "Noch zu wenige Daten";
  if (pattern === "flat") return "Kein klares Muster";
  return weekdays.map((d) => WEEKDAYS_SHORT[d]).join(", ");
}

function currentMonday(): string {
  const now = new Date();
  const weekday = now.getDay() || 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1, 12);
  return monday.toLocaleDateString("sv-SE");
}

function dataStatusLabel(status?: TeamIntelligencePerson["data_status"]): string {
  if (status === "ready") return "Datenbereit";
  if (status === "learning") return "Lernt";
  return "Neu";
}

export default function GedaechtnisPage() {
  const [data, setData] = useState<MemoryOverview | null>(null);
  const [teamIntelligence, setTeamIntelligence] = useState<TeamIntelligenceOverview | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [profilePersonId, setProfilePersonId] = useState<number | null>(null);
  const [section, setSection] = useState<MemorySection>("overview");
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addShow, setAddShow] = useState("");
  const { toast } = useToast();
  const markUserSelection = useScrollDetailIntoView(selectedId, ".memory-detail");

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      getMemory(),
      getTeamIntelligenceOverview({ currentWeekStart: currentMonday() }),
    ]).then(([memoryResult, intelligenceResult]) => {
      if (!active) return;
      if (memoryResult.status === "fulfilled") {
        setData(memoryResult.value);
        const first = memoryResult.value.people.find((person) => person.active);
        setSelectedId(first?.person_id ?? memoryResult.value.people[0]?.person_id ?? null);
      } else {
        setError(
          memoryResult.reason instanceof Error
            ? memoryResult.reason.message
            : "Gedächtnis konnte nicht geladen werden.",
        );
      }
      if (intelligenceResult.status === "fulfilled") {
        setTeamIntelligence(intelligenceResult.value);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const people = useMemo(() => data?.people ?? [], [data]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de");
    return people
      .filter((person) => person.active === !showInactive)
      .filter((person) =>
        !needle || `${person.person} ${person.department ?? ""}`
          .toLocaleLowerCase("de").includes(needle));
  }, [people, query, showInactive]);

  const selected = people.find((person) => person.person_id === selectedId) ?? null;
  const intelligenceByPerson = useMemo(
    () => new Map((teamIntelligence?.people ?? []).map((person) => [person.person_id, person])),
    [teamIntelligence],
  );
  const selectedIntelligence = selectedId === null
    ? null
    : intelligenceByPerson.get(selectedId) ?? null;

  const summary = useMemo(() => {
    const active = people.filter((p) => p.active);
    return {
      total: active.length,
      ready: teamIntelligence?.summary.with_history ?? 0,
      withSkills: teamIntelligence?.summary.with_skills ?? 0,
      attention: teamIntelligence?.summary.attention_people
        ?? active.filter((person) => person.data_quality.cold_start).length,
    };
  }, [people, teamIntelligence]);

  async function refreshIntelligence() {
    try {
      setTeamIntelligence(
        await getTeamIntelligenceOverview({ currentWeekStart: currentMonday() }),
      );
    } catch {
      // Die klassische Gedächtnis-Funktion bleibt auch bei fehlender Intelligence erreichbar.
    }
  }

  /** Alle Mutationen liefern die frische PersonMemory zurück - nie lokal nachbauen. */
  function applyUpdate(updated: PersonMemory) {
    setData((current) => current && ({
      ...current,
      people: current.people.map((p) => p.person_id === updated.person_id ? updated : p),
    }));
  }

  async function mutate(action: () => Promise<PersonMemory>, successTitle: string) {
    setBusy(true);
    setError("");
    try {
      applyUpdate(await action());
      toast({ variant: "success", title: successTitle });
      void refreshIntelligence();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Änderung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  function toggleWeekday(person: PersonMemory, weekday: number) {
    const current = new Set(person.free.weekdays);
    if (current.has(weekday)) current.delete(weekday);
    else current.add(weekday);
    return mutate(
      () => setMemoryFree(person.person_id, [...current].sort((a, b) => a - b)),
      "Frei-Muster gespeichert",
    );
  }

  function choosePool(inactive: boolean) {
    setShowInactive(inactive);
    const first = people.find((person) => person.active === !inactive);
    setSelectedId(first?.person_id ?? null);
    setAddShow("");
    setSection("overview");
  }

  return (
    <div className="memory-page">
      <PageHeader
        title="MA-Gedächtnis"
        subtitle="Was die Planung über jeden Mitarbeiter gelernt hat – und was du korrigierst"
        secondaryActions={<Button variant="secondary" href="/team">Zur Teamverwaltung</Button>}
      />

      <section className="memory-overview-grid" aria-label="Übersicht Gedächtnis">
        <article className="memory-overview-card is-primary">
          <span>Aktive Mitarbeiter</span>
          <strong>{loading ? "…" : summary.total}</strong>
          <small>im Planungspool</small>
        </article>
        <article className="memory-overview-card">
          <span>Historisch belegt</span>
          <strong>{loading ? "…" : `${summary.ready}/${summary.total}`}</strong>
          <small>mit auswertbaren Einsätzen</small>
        </article>
        <article className="memory-overview-card">
          <span>Skill-Profile</span>
          <strong>{loading ? "…" : summary.withSkills}</strong>
          <small>automatisch oder manuell belegt</small>
        </article>
        <article className={`memory-overview-card ${summary.attention ? "is-warning" : "is-positive"}`}>
          <span>Aufmerksamkeit</span>
          <strong>{loading ? "…" : summary.attention}</strong>
          <small>
            {summary.attention
              ? "Profile mit Hinweisen oder Datenlücken"
              : "keine Hinweise oder Datenlücken"}
          </small>
        </article>
      </section>

      {error && <InlineStatus variant="danger" className="memory-status">{error}</InlineStatus>}

      <section className="panel memory-layout">
        <div className="memory-list">
          <div className="memory-list-tools">
            <label className="team-search">
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Mitarbeiter suchen"
                aria-label="Mitarbeiter suchen"
              />
            </label>
            <div className="team-tabs" role="tablist">
              <button
                type="button" role="tab" aria-selected={!showInactive}
                className={!showInactive ? "is-active" : ""}
                onClick={() => choosePool(false)}
              >Aktiv</button>
              <button
                type="button" role="tab" aria-selected={showInactive}
                className={showInactive ? "is-active" : ""}
                onClick={() => choosePool(true)}
              >Inaktiv</button>
            </div>
          </div>

          {loading && (
            <InlineStatus variant="loading" className="memory-status">
              Gedächtnis wird geladen …
            </InlineStatus>
          )}
          {!loading && visible.length === 0 && (
            <EmptyState
              variant={query ? "filtered" : "empty"}
              title="Keine Mitarbeiter gefunden"
              description={
                query
                  ? "Kein Treffer für die aktuelle Suche."
                  : `Im Pool „${showInactive ? "Inaktiv" : "Aktiv"}“ gibt es keine Mitarbeiter.`
              }
              primaryAction={
                query ? (
                  <Button variant="secondary" onClick={() => setQuery("")}>
                    Suche zurücksetzen
                  </Button>
                ) : undefined
              }
            />
          )}
          {visible.map((person) => {
            const personIntelligence = intelligenceByPerson.get(person.person_id);
            return (
            <button
              type="button"
              key={person.person_id}
              className={`memory-person-card ${person.person_id === selectedId ? "is-active" : ""}`}
              onClick={() => {
                markUserSelection();
                setSelectedId(person.person_id);
                setAddShow("");
                setSection("overview");
              }}
            >
              <span className="team-member-avatar" aria-hidden="true">{initials(person.person)}</span>
              <span className="memory-person-copy">
                <strong>{person.person}</strong>
                <small>{person.department || "Ohne Abteilung"} · {person.data_quality.assignments} Dienste</small>
              </span>
              <span className="memory-person-tags">
                <span className={`memory-data-status is-${personIntelligence?.data_status ?? "new"}`}>
                  {dataStatusLabel(personIntelligence?.data_status)}
                </span>
                <small>
                  {personIntelligence?.skill_count ?? 0} {(personIntelligence?.skill_count ?? 0) === 1 ? "Skill" : "Skills"}
                  {" · "}
                  {personIntelligence?.memory_count ?? 0} {(personIntelligence?.memory_count ?? 0) === 1 ? "Signal" : "Signale"}
                </small>
              </span>
            </button>
            );
          })}
        </div>

        {selected && (
          <div className="memory-detail">
            <div className="memory-detail-head">
              <div className="memory-profile-identity">
                <span className="memory-profile-avatar" aria-hidden="true">{initials(selected.person)}</span>
                <div>
                  <span className="memory-eyebrow">Mitarbeiter Intelligence</span>
                  <h2>{selected.person}</h2>
                  <p>{selected.department || "Keine Abteilung hinterlegt"}</p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary memory-profile-open"
                onClick={() => setProfilePersonId(selected.person_id)}
              >
                Intelligence-Profil öffnen
              </button>
              <div className="memory-profile-metrics" aria-label="Profildaten">
                <span><strong>{selected.data_quality.assignments}</strong>Dienste</span>
                <span><strong>{selected.data_quality.duty_weeks}</strong>Wochen</span>
                <span><strong>{selectedIntelligence?.skill_count ?? 0}</strong>Skills</span>
                <span><strong>{selectedIntelligence?.memory_count ?? 0}</strong>Signale</span>
              </div>
            </div>

            {selected.data_quality.cold_start && (
              <InlineStatus variant="warning" className="memory-status">
                Für {selected.person} gibt es noch keine Dienste in der Historie. Ergänze unten von
                Hand, welche Aufgaben und Shows übernommen werden können.
              </InlineStatus>
            )}
            {(data?.meta.rehearsal_weeks ?? 0) < 2 && selected.shows.length > 0 && (
              <InlineStatus variant="warning" className="memory-status">
                Erst {data?.meta.rehearsal_weeks} Probenwoche importiert – die Show-Besetzung ist
                bisher nur eine Vermutung. Sie wird mit jedem weiteren Probenplan genauer.
              </InlineStatus>
            )}

            <nav className="memory-section-tabs" aria-label="Gedächtnisbereiche">
              {MEMORY_SECTIONS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={section === item.id ? "is-active" : ""}
                  onClick={() => setSection(item.id)}
                >
                  {item.label}
                  {item.id === "shows" && <small>{selected.shows.length}</small>}
                  {item.id === "tasks" && <small>{selected.tasks.length}</small>}
                </button>
              ))}
            </nav>

            {section === "overview" && (
              <section className="memory-summary-grid" aria-label="Profilübersicht">
                <article className={`memory-summary-card is-${selectedIntelligence?.planning_hint.tone ?? "neutral"}`}>
                  <span className="memory-summary-icon" aria-hidden="true">✦</span>
                  <div>
                    <small>Planungshinweis</small>
                    <strong>{selectedIntelligence?.planning_hint.label ?? "Profil wird aufgebaut"}</strong>
                    <p>{selectedIntelligence?.planning_hint.text ?? "Noch keine ausreichend belegte Empfehlung vorhanden."}</p>
                  </div>
                </article>
                <button type="button" className="memory-summary-card" onClick={() => setSection("shows")}>
                  <span className="memory-summary-icon" aria-hidden="true">◉</span>
                  <div><small>Abendplanung</small><strong>{selected.shows.length} Shows &amp; Partys</strong><p>Beeinflusst Empfehlungen für Abenddienste.</p></div>
                  <span className="memory-summary-arrow" aria-hidden="true">→</span>
                </button>
                <button type="button" className="memory-summary-card" onClick={() => setSection("availability")}>
                  <span className="memory-summary-icon" aria-hidden="true">◷</span>
                  <div><small>Verfügbarkeit</small><strong>{patternLabel(selected)}</strong><p>{selected.free.total_free_days} belegte Frei-Tage aus {selected.free.weeks_observed} Wochen.</p></div>
                  <span className="memory-summary-arrow" aria-hidden="true">→</span>
                </button>
                <button type="button" className="memory-summary-card" onClick={() => setSection("tasks")}>
                  <span className="memory-summary-icon" aria-hidden="true">◇</span>
                  <div><small>Aufgabenprofil</small><strong>{selected.tasks.length} bekannte Aufgaben</strong><p>Erfahrung bricht Gleichstände, Fairness bleibt stärker.</p></div>
                  <span className="memory-summary-arrow" aria-hidden="true">→</span>
                </button>
              </section>
            )}

            {/* ① Shows & Partys */}
            {section === "shows" && <section className="panel memory-card">
              <div className="memory-card-head">
                <h3>Shows &amp; Partys</h3>
                <small>Wer auf der Bühne steht, wird für Abenddienste niedriger priorisiert.</small>
              </div>

              {selected.shows.length === 0 && (
                <EmptyState
                  title="Keine Show-Besetzung bekannt"
                  description="Unten von Hand ergänzen."
                />
              )}

              <div className="memory-show-list">
                {selected.shows.map((show) => (
                  <div key={show.show_key} className={`memory-show ${show.counts_for_planning ? "is-active-signal" : ""}`}>
                    <div className="memory-show-copy">
                      <strong>{show.label}</strong>
                      <small>
                        {show.appearances > 0
                          ? `${show.appearances} Probentag(e) · zuletzt ${germanDate(show.last_date)}`
                          : "Von dir ergänzt"}
                      </small>
                    </div>
                    <div className="memory-show-tags">
                      {show.kind === "party" && <span className="badge">Party</span>}
                      <span className={`badge memory-confidence-${show.confidence}`}>
                        {show.confidence}
                      </span>
                      {!show.counts_for_planning && (
                        <span className="badge">wirkt nicht</span>
                      )}
                    </div>
                    <div className="memory-show-actions">
                      <button
                        type="button" className="btn" disabled={busy}
                        onClick={() => mutate(
                          () => setMemoryShow(
                            selected.person_id, show.show_key,
                            show.source === "abgeleitet" ? "confirmed" : null,
                          ),
                          show.source === "abgeleitet"
                            ? `${show.label} bestätigt`
                            : `${show.label} wieder automatisch`,
                        )}
                        title={show.source === "abgeleitet" ? "Bestätigen" : "Auf Automatik zurücksetzen"}
                      >
                        {show.source === "abgeleitet" ? "✓ Bestätigen" : "↺ Automatik"}
                      </button>
                      <button
                        type="button" className="btn btn-danger" disabled={busy}
                        onClick={() => mutate(
                          () => setMemoryShow(selected.person_id, show.show_key, "removed"),
                          `${show.label} entfernt`,
                        )}
                      >× Entfernen</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="memory-add-row">
                <select
                  className="control"
                  value={addShow}
                  onChange={(event) => setAddShow(event.target.value)}
                  aria-label="Show ergänzen"
                >
                  <option value="">Show ergänzen …</option>
                  {SHOW_CHOICES
                    .filter((choice) => !selected.shows.some((s) => s.show_key === choice.key))
                    .map((choice) => (
                      <option key={choice.key} value={choice.key}>{choice.label}</option>
                    ))}
                </select>
                <button
                  type="button" className="btn btn-primary"
                  disabled={!addShow || busy}
                  onClick={() => mutate(
                    async () => {
                      const result = await setMemoryShow(selected.person_id, addShow, "added");
                      setAddShow("");
                      return result;
                    },
                    `${SHOW_CHOICES.find((choice) => choice.key === addShow)?.label ?? "Show"} ergänzt`,
                  )}
                >Hinzufügen</button>
              </div>

              {selected.removed_shows.length > 0 && (
                <details className="memory-removed">
                  <summary>Von dir entfernt ({selected.removed_shows.length})</summary>
                  {selected.removed_shows.map((show) => (
                    <div key={show.show_key} className="memory-removed-row">
                      <span>
                        {show.label}
                        {show.appearances > 0 && (
                          <small> · inzwischen {show.appearances} Probentag(e)</small>
                        )}
                      </span>
                      <button
                        type="button" className="btn" disabled={busy}
                        onClick={() => mutate(
                          () => setMemoryShow(selected.person_id, show.show_key, null),
                          `${show.label} zurückgeholt`,
                        )}
                      >Zurückholen</button>
                    </div>
                  ))}
                </details>
              )}
            </section>}

            {/* ② Frei-Muster */}
            {section === "availability" && <section className="panel memory-card">
              <div className="memory-card-head">
                <h3>Frei-Muster</h3>
                <small>
                  {selected.free.source === "manuell"
                    ? `Automatisch erkannt wäre: ${
                        selected.free.derived_weekdays.length
                          ? selected.free.derived_weekdays.map((d) => WEEKDAYS_SHORT[d]).join(", ")
                          : "kein Muster"}`
                    : `${selected.free.total_free_days} Frei-Tage aus ${selected.free.weeks_observed} Wochen`}
                </small>
              </div>

              {selected.free.source === "manuell" && (
                <InlineStatus variant="info" className="memory-status">
                  Von dir festgelegt – Automatik ist überschrieben.
                </InlineStatus>
              )}
              {selected.free.source === "abgeleitet" && selected.free.pattern === "flat" && (
                <InlineStatus variant="info" className="memory-status">
                  Kein klares Muster erkennbar – dieser MA bekommt keinen automatischen
                  Frei-Vorschlag. Du kannst unten selbst Tage festlegen.
                </InlineStatus>
              )}
              {selected.free.source === "abgeleitet" && selected.free.pattern === "insufficient" && (
                <InlineStatus variant="info" className="memory-status">
                  Noch zu wenige Daten ({selected.free.total_free_days} Frei-Tage). Ab etwa 6
                  Frei-Tagen wird ein Muster erkannt.
                </InlineStatus>
              )}

              <div className="memory-weekdays">
                {selected.free.distribution.map((bucket) => {
                  const active = selected.free.weekdays.includes(bucket.weekday);
                  return (
                    <button
                      type="button"
                      key={bucket.weekday}
                      className={`memory-weekday ${active ? "is-active" : ""}`}
                      disabled={busy}
                      onClick={() => toggleWeekday(selected, bucket.weekday)}
                      title={`${bucket.label}: ${bucket.count} Frei-Tage`}
                    >
                      <span className="memory-weekday-label">{WEEKDAYS_SHORT[bucket.weekday]}</span>
                      <span className="memory-weekday-track">
                        <span
                          className="memory-weekday-fill"
                          style={{ height: `${Math.round(bucket.share * 100)}%` }}
                        />
                      </span>
                      <span className="memory-weekday-count">{bucket.count}</span>
                    </button>
                  );
                })}
              </div>

              {selected.free.source === "manuell" && (
                <button
                  type="button" className="btn" disabled={busy}
                  onClick={() => mutate(
                    () => setMemoryFree(selected.person_id, null),
                    "Frei-Muster wieder automatisch",
                  )}
                >Auf Automatik zurücksetzen</button>
              )}
            </section>}

            {/* ③ Aufgaben-Profil */}
            {section === "tasks" && <section className="panel memory-card">
              <div className="memory-card-head">
                <h3>Aufgaben-Profil</h3>
                <small>Bei sonst gleicher Belastung wird eine vertraute Aufgabe leicht bevorzugt.</small>
              </div>

              {selected.tasks.length === 0 && (
                <EmptyState
                  title="Noch keine Dienste in der Historie"
                  description="Das Aufgabenprofil entsteht automatisch aus gespeicherten Dienstplänen."
                />
              )}

              {selected.tasks.map((task) => (
                <div key={task.category} className="memory-task-row">
                  <span className="memory-task-name">
                    {task.category}
                    {task.state === "added" && <span className="badge">ergänzt</span>}
                    {task.state === "removed" && <span className="badge">abgewertet</span>}
                  </span>
                  <span className="memory-task-count">{task.count}×</span>
                  <span className="dashboard-department-track" aria-hidden="true">
                    <span style={{ width: `${Math.round(task.team_share * 100)}%` }} />
                  </span>
                  <span className="memory-task-last">{germanDate(task.last_date)}</span>
                  <button
                    type="button" className="btn" disabled={busy}
                    onClick={() => mutate(
                      () => setMemoryTask(
                        selected.person_id, task.category,
                        task.state === "removed" ? null : "removed",
                      ),
                      task.state === "removed"
                        ? `${task.category} wieder automatisch`
                        : `${task.category} wird selten eingeplant`,
                    )}
                  >{task.state === "removed" ? "↺ Automatik" : "Selten einplanen"}</button>
                </div>
              ))}

              {selected.never_done.length > 0 && (
                <details className="memory-removed">
                  <summary>Noch nie gemacht ({selected.never_done.length})</summary>
                  {selected.never_done.map((category) => (
                    <div key={category} className="memory-removed-row">
                      <span>{category}</span>
                      <button
                        type="button" className="btn" disabled={busy}
                        onClick={() => mutate(
                          () => setMemoryTask(selected.person_id, category, "added"),
                          `${category} als Aufgabe ergänzt`,
                        )}
                      >Kann er trotzdem</button>
                    </div>
                  ))}
                </details>
              )}
            </section>}
          </div>
        )}
      </section>

      {(data?.unmatched_rehearsal_names.length ?? 0) > 0 && (
        <p className="memory-footnote">
          {data!.unmatched_rehearsal_names.length} Namen aus dem Probenplan konnten keinem MA
          zugeordnet werden (meist andere Abteilungen):{" "}
          {data!.unmatched_rehearsal_names.map((entry) => entry.raw_name).join(", ")}
        </p>
      )}

      {profilePersonId !== null && (
        <EmployeeIntelligenceDialog
          personId={profilePersonId}
          onClose={() => {
            setProfilePersonId(null);
            void refreshIntelligence();
          }}
        />
      )}
    </div>
  );
}
