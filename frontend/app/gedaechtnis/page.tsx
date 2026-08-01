"use client";

import PageHeader from "@/components/PageHeader";
import {
  getMemory,
  setMemoryFree,
  setMemoryShow,
  setMemoryTask,
  type MemoryOverview,
  type PersonMemory,
} from "@/lib/api";
import Link from "next/link";
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

export default function GedaechtnisPage() {
  const [data, setData] = useState<MemoryOverview | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addShow, setAddShow] = useState("");

  useEffect(() => {
    getMemory()
      .then((result) => {
        setData(result);
        const first = result.people.find((p) => p.active);
        setSelectedId(first ? first.person_id : result.people[0]?.person_id ?? null);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Gedächtnis konnte nicht geladen werden."))
      .finally(() => setLoading(false));
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

  const summary = useMemo(() => {
    const active = people.filter((p) => p.active);
    return {
      total: active.length,
      withPattern: active.filter((p) => p.free.weekdays.length > 0).length,
      withShows: active.filter((p) => p.shows.length > 0).length,
      coldStart: active.filter((p) => p.data_quality.cold_start).length,
    };
  }, [people]);

  /** Alle Mutationen liefern die frische PersonMemory zurück - nie lokal nachbauen. */
  function applyUpdate(updated: PersonMemory) {
    setData((current) => current && ({
      ...current,
      people: current.people.map((p) => p.person_id === updated.person_id ? updated : p),
    }));
  }

  async function mutate(action: () => Promise<PersonMemory>) {
    setBusy(true);
    setError("");
    try {
      applyUpdate(await action());
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
    return mutate(() => setMemoryFree(person.person_id, [...current].sort((a, b) => a - b)));
  }

  return (
    <div className="memory-page">
      <div className="memory-page-head">
        <PageHeader
          title="MA-Gedächtnis"
          subtitle="Was die Planung über jeden Mitarbeiter gelernt hat – und was du korrigierst"
        />
        <Link href="/team" className="btn">Zur Teamverwaltung</Link>
      </div>

      <section className="planning-logic-overview" aria-label="Übersicht Gedächtnis">
        <article>
          <span>Im Gedächtnis</span>
          <strong>{loading ? "…" : summary.total}</strong>
          <small>aktive Mitarbeiter</small>
        </article>
        <article>
          <span>Frei-Muster</span>
          <strong>{loading ? "…" : summary.withPattern}</strong>
          <small>mit erkennbarem Muster</small>
        </article>
        <article>
          <span>Show-Besetzung</span>
          <strong>{loading ? "…" : summary.withShows}</strong>
          <small>aus {data?.meta.rehearsal_weeks ?? 0} Probenwoche(n)</small>
        </article>
      </section>

      {error && <div className="status status-error">{error}</div>}

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
                onClick={() => setShowInactive(false)}
              >Aktiv</button>
              <button
                type="button" role="tab" aria-selected={showInactive}
                className={showInactive ? "is-active" : ""}
                onClick={() => setShowInactive(true)}
              >Inaktiv</button>
            </div>
          </div>

          {loading && <div className="dashboard-empty">Gedächtnis wird geladen …</div>}
          {!loading && visible.length === 0 && (
            <div className="dashboard-empty">Keine Mitarbeiter gefunden.</div>
          )}
          {visible.map((person) => (
            <button
              type="button"
              key={person.person_id}
              className={`memory-person-card ${person.person_id === selectedId ? "is-active" : ""}`}
              onClick={() => { setSelectedId(person.person_id); setAddShow(""); }}
            >
              <span className="team-member-avatar" aria-hidden="true">{initials(person.person)}</span>
              <span className="memory-person-copy">
                <strong>{person.person}</strong>
                <small>{person.department || "Ohne Abteilung"}</small>
              </span>
              <span className="memory-person-tags">
                {person.shows.length > 0 && (
                  <span className="badge">{person.shows.length} Shows</span>
                )}
                <span className="badge">{patternLabel(person)}</span>
              </span>
            </button>
          ))}
        </div>

        {selected && (
          <div className="memory-detail">
            <div className="memory-detail-head">
              <div>
                <span className="memory-eyebrow">Gedächtnis</span>
                <h2>{selected.person}</h2>
                <p>
                  {selected.data_quality.assignments} Dienste aus{" "}
                  {selected.data_quality.duty_weeks} Wochen
                  {selected.department ? ` · ${selected.department}` : ""}
                </p>
              </div>
            </div>

            {selected.data_quality.cold_start && (
              <div className="status status-warning">
                Für {selected.person} gibt es noch keine Dienste in der Historie. Ergänze unten von
                Hand, welche Aufgaben und Shows übernommen werden können.
              </div>
            )}
            {(data?.meta.rehearsal_weeks ?? 0) < 2 && selected.shows.length > 0 && (
              <div className="status status-warning">
                Erst {data?.meta.rehearsal_weeks} Probenwoche importiert – die Show-Besetzung ist
                bisher nur eine Vermutung. Sie wird mit jedem weiteren Probenplan genauer.
              </div>
            )}

            {/* ① Shows & Partys */}
            <section className="panel memory-card">
              <div className="memory-card-head">
                <h3>Shows &amp; Partys</h3>
                <small>Wer auf der Bühne steht, wird für Abenddienste niedriger priorisiert.</small>
              </div>

              {selected.shows.length === 0 && (
                <div className="dashboard-empty">
                  Keine Show-Besetzung bekannt. Unten von Hand ergänzen.
                </div>
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
                        onClick={() => mutate(() => setMemoryShow(
                          selected.person_id, show.show_key,
                          show.source === "abgeleitet" ? "confirmed" : null,
                        ))}
                        title={show.source === "abgeleitet" ? "Bestätigen" : "Auf Automatik zurücksetzen"}
                      >
                        {show.source === "abgeleitet" ? "✓ Bestätigen" : "↺ Automatik"}
                      </button>
                      <button
                        type="button" className="btn btn-danger" disabled={busy}
                        onClick={() => mutate(() =>
                          setMemoryShow(selected.person_id, show.show_key, "removed"))}
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
                  onClick={() => mutate(async () => {
                    const result = await setMemoryShow(selected.person_id, addShow, "added");
                    setAddShow("");
                    return result;
                  })}
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
                        onClick={() => mutate(() =>
                          setMemoryShow(selected.person_id, show.show_key, null))}
                      >Zurückholen</button>
                    </div>
                  ))}
                </details>
              )}
            </section>

            {/* ② Frei-Muster */}
            <section className="panel memory-card">
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
                <div className="status status-info">Von dir festgelegt – Automatik ist überschrieben.</div>
              )}
              {selected.free.source === "abgeleitet" && selected.free.pattern === "flat" && (
                <div className="dashboard-empty">
                  Kein klares Muster erkennbar – dieser MA bekommt keinen automatischen
                  Frei-Vorschlag. Du kannst unten selbst Tage festlegen.
                </div>
              )}
              {selected.free.source === "abgeleitet" && selected.free.pattern === "insufficient" && (
                <div className="dashboard-empty">
                  Noch zu wenige Daten ({selected.free.total_free_days} Frei-Tage). Ab etwa 6
                  Frei-Tagen wird ein Muster erkannt.
                </div>
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
                  onClick={() => mutate(() => setMemoryFree(selected.person_id, null))}
                >Auf Automatik zurücksetzen</button>
              )}
            </section>

            {/* ③ Aufgaben-Profil */}
            <section className="panel memory-card">
              <div className="memory-card-head">
                <h3>Aufgaben-Profil</h3>
                <small>Bei sonst gleicher Belastung wird eine vertraute Aufgabe leicht bevorzugt.</small>
              </div>

              {selected.tasks.length === 0 && (
                <div className="dashboard-empty">Noch keine Dienste in der Historie.</div>
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
                    onClick={() => mutate(() => setMemoryTask(
                      selected.person_id, task.category,
                      task.state === "removed" ? null : "removed",
                    ))}
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
                        onClick={() => mutate(() =>
                          setMemoryTask(selected.person_id, category, "added"))}
                      >Kann er trotzdem</button>
                    </div>
                  ))}
                </details>
              )}
            </section>
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
    </div>
  );
}
