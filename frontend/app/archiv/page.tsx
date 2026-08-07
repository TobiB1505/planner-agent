"use client";

import ArchiveImportFlow from "@/components/ArchiveImportFlow";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import InlineStatus from "@/components/ui/InlineStatus";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import {
  deleteWeek,
  getWeekDetail,
  getWeeks,
  type WeekDetail,
  type WeekSummary,
} from "@/lib/api";
import { useScrollDetailIntoView } from "@/lib/useScrollDetailIntoView";
import { useEffect, useMemo, useState } from "react";

type ArchiveFilter = "all" | "imported" | "generated";

function germanDate(value: unknown, withWeekday = false): string {
  if (!value || typeof value !== "string") return "–";
  return new Intl.DateTimeFormat("de-DE", {
    ...(withWeekday ? { weekday: "short" } : {}),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function isGenerated(week: WeekSummary): boolean {
  return (week.source ?? "").toLocaleLowerCase("de").includes("generiert");
}

function valueOf(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return "";
}

export default function ArchivPage() {
  const { toast } = useToast();
  const [weeks, setWeeks] = useState<WeekSummary[]>([]);
  const [details, setDetails] = useState<Record<number, WeekDetail>>({});
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ArchiveFilter>("all");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WeekSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showAllAssignments, setShowAllAssignments] = useState(false);
  const markUserSelection = useScrollDetailIntoView(selectedWeekId, ".archive-detail");

  async function load() {
    setLoading(true);
    try {
      setWeeks(await getWeeks());
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Archiv konnte nicht geladen werden.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    getWeeks()
      .then(setWeeks)
      .catch((error) => {
        setMessage({
          kind: "error",
          text: error instanceof Error ? error.message : "Archiv konnte nicht geladen werden.",
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredWeeks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de");
    return weeks.filter((week) => {
      if (filter === "generated" && !isGenerated(week)) return false;
      if (filter === "imported" && isGenerated(week)) return false;
      if (!needle) return true;
      return `${week.label} ${week.source ?? ""} ${week.start_date} ${week.end_date}`
        .toLocaleLowerCase("de")
        .includes(needle);
    });
  }, [filter, query, weeks]);

  const selectedWeek = weeks.find((week) => week.id === selectedWeekId) ?? null;
  const selectedDetail = selectedWeekId ? details[selectedWeekId] : undefined;
  const totalAssignments = weeks.reduce((sum, week) => sum + (week.assignment_count ?? 0), 0);
  const importedCount = weeks.filter((week) => !isGenerated(week)).length;

  async function selectWeek(weekId: number) {
    markUserSelection();
    setSelectedWeekId(weekId);
    setMessage(null);
    setShowAllAssignments(false);
    if (details[weekId]) return;
    setDetailLoading(true);
    try {
      const detail = await getWeekDetail(weekId);
      setDetails((current) => ({ ...current, [weekId]: detail }));
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Plan konnte nicht geladen werden.",
      });
    } finally {
      setDetailLoading(false);
    }
  }

  function remove(week: WeekSummary) {
    setDeleteTarget(week);
  }

  async function confirmRemove() {
    const week = deleteTarget;
    if (!week) return;
    setDeleting(true);
    try {
      await deleteWeek(week.id);
      setSelectedWeekId(null);
      setDetails((current) => {
        const next = { ...current };
        delete next[week.id];
        return next;
      });
      toast({ variant: "success", title: "Woche wurde aus dem Archiv gelöscht" });
      setDeleteTarget(null);
      await load();
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Woche konnte nicht gelöscht werden.",
      });
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaved(weekPlanId: number) {
    setImportOpen(false);
    setMessage({ kind: "success", text: "Der alte Dienstplan wurde geprüft und im Archiv gespeichert." });
    await load();
    setSelectedWeekId(weekPlanId);
    setDetailLoading(true);
    try {
      const detail = await getWeekDetail(weekPlanId);
      setDetails((current) => ({ ...current, [weekPlanId]: detail }));
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error
          ? `Der Plan wurde archiviert, aber die Vorschau konnte nicht geladen werden: ${error.message}`
          : "Der Plan wurde archiviert, aber die Vorschau konnte nicht geladen werden.",
      });
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="archive-page">
      <PageHeader
        title="Archiv"
        subtitle="Gespeicherte Dienstpläne schnell finden, prüfen und als Grundlage weiterverwenden"
        primaryAction={
          <button
            type="button"
            className={`btn btn-primary archive-import-trigger ${importOpen ? "is-open" : ""}`}
            onClick={() => setImportOpen((current) => !current)}
          >
            <span aria-hidden="true">{importOpen ? "×" : "+"}</span>
            {importOpen ? "Import schließen" : "Alten Dienstplan archivieren"}
          </button>
        }
      />

      <section className="archive-overview" aria-label="Archivübersicht">
        <div className="archive-overview-main">
          <span className="archive-eyebrow">Wochenbibliothek</span>
          <strong>{weeks.length} gespeicherte Wochen</strong>
          <p>Historische und selbst erstellte Pläne an einem Ort.</p>
        </div>
        <div className="archive-overview-stat">
          <span>Importiert</span>
          <strong>{importedCount}</strong>
        </div>
        <div className="archive-overview-stat">
          <span>Generiert</span>
          <strong>{weeks.length - importedCount}</strong>
        </div>
        <div className="archive-overview-stat">
          <span>Zuweisungen</span>
          <strong>{totalAssignments}</strong>
        </div>
      </section>

      {importOpen && (
        <ArchiveImportFlow onClose={() => setImportOpen(false)} onSaved={handleSaved} />
      )}

      {message && (
        <InlineStatus
          variant={message.kind === "error" ? "danger" : message.kind}
          className="archive-status"
        >
          {message.text}
        </InlineStatus>
      )}

      <section className="archive-library">
        <div className="archive-library-head">
          <div>
            <span className="archive-eyebrow">Gespeicherte Dienstpläne</span>
            <h2>Wochen durchsuchen</h2>
          </div>
          <div className="archive-library-tools">
            <label className="archive-search">
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="KW, Quelle oder Zeitraum suchen"
                aria-label="Archiv durchsuchen"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="Suche leeren">×</button>
              )}
            </label>
            <div className="archive-filter" role="group" aria-label="Archiv filtern">
              {([
                ["all", "Alle"],
                ["imported", "Importiert"],
                ["generated", "Generiert"],
              ] as [ArchiveFilter, string][]).map(([value, label]) => (
                <button
                  type="button"
                  className={filter === value ? "is-active" : ""}
                  onClick={() => setFilter(value)}
                  key={value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={`archive-library-layout ${selectedWeek ? "has-detail" : ""}`}>
          <div className="archive-week-list">
            {loading && (
              <InlineStatus variant="loading" className="archive-list-status">
                Archiv wird geladen …
              </InlineStatus>
            )}
            {!loading && filteredWeeks.map((week) => {
              const detail = details[week.id];
              const selected = selectedWeekId === week.id;
              return (
                <button
                  type="button"
                  className={`archive-week-card ${selected ? "is-selected" : ""}`}
                  onClick={() => void selectWeek(week.id)}
                  key={week.id}
                >
                  <span className="archive-week-calendar">
                    <small>KW</small>
                    <strong>{week.kw ?? "–"}</strong>
                  </span>
                  <span className="archive-week-copy">
                    <span className="archive-week-title">
                      <strong>{week.label}</strong>
                      <small className={isGenerated(week) ? "is-generated" : ""}>
                        {isGenerated(week) ? "Generiert" : "Importiert"}
                      </small>
                    </span>
                    <span>{germanDate(week.start_date)} – {germanDate(week.end_date)}</span>
                    <small title={week.source ?? ""}>{week.source || "Ohne Quellenangabe"}</small>
                  </span>
                  <span className="archive-week-counts">
                    <span><strong>{detail?.assignments.length ?? week.assignment_count ?? 0}</strong> Dienste</span>
                    <span><strong>{detail?.absences.length ?? week.absence_count ?? 0}</strong> Abwesenheiten</span>
                  </span>
                  <span className="archive-week-arrow" aria-hidden="true">›</span>
                </button>
              );
            })}
            {!loading && filteredWeeks.length === 0 && (
              <EmptyState
                variant={query || filter !== "all" ? "filtered" : "empty"}
                title={
                  query || filter !== "all"
                    ? "Keine passende Woche gefunden"
                    : "Noch keine gespeicherten Wochen"
                }
                description={
                  query || filter !== "all"
                    ? "Ändere Suche oder Filter – oder archiviere oben einen alten Dienstplan."
                    : "Archiviere oben einen alten Dienstplan oder speichere eine Woche im Editor."
                }
                primaryAction={
                  query || filter !== "all" ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuery("");
                        setFilter("all");
                      }}
                    >
                      Filter zurücksetzen
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>

          {selectedWeek && (
            <aside className="archive-detail" aria-label={`Details zu ${selectedWeek.label}`}>
              <div className="archive-detail-head">
                <div>
                  <span className="archive-eyebrow">Wochenansicht</span>
                  <h3>{selectedWeek.label}</h3>
                  <p>{germanDate(selectedWeek.start_date, true)} – {germanDate(selectedWeek.end_date, true)}</p>
                </div>
                <button
                  type="button"
                  className="archive-close-button"
                  onClick={() => setSelectedWeekId(null)}
                  aria-label="Detailansicht schließen"
                >
                  ×
                </button>
              </div>

              <div className="archive-detail-source">
                <span>Quelle</span>
                <strong title={selectedWeek.source ?? ""}>{selectedWeek.source || "Ohne Quellenangabe"}</strong>
              </div>

              {detailLoading && !selectedDetail ? (
                <div className="archive-detail-loading">
                  <span className="spinner" />
                  <span>Woche wird geladen …</span>
                </div>
              ) : selectedDetail ? (
                <>
                  <div className="archive-detail-metrics">
                    <div><strong>{selectedDetail.assignments.length}</strong><span>Zuweisungen</span></div>
                    <div><strong>{selectedDetail.absences.length}</strong><span>Abwesenheiten</span></div>
                  </div>

                  <div className="archive-detail-content">
                    <div className="archive-detail-section">
                      <h4>Zuweisungen</h4>
                      <div className="archive-detail-list">
                        {(showAllAssignments
                          ? selectedDetail.assignments
                          : selectedDetail.assignments.slice(0, 120)
                        ).map((row, index) => (
                          <div className="archive-detail-row" key={`assignment-${index}`}>
                            <span>{germanDate(valueOf(row, "date"))}</span>
                            <div>
                              <strong>{valueOf(row, "category") || "Ohne Abschnitt"}</strong>
                              <small>
                                {[valueOf(row, "subcategory"), valueOf(row, "person", "raw_text")]
                                  .filter(Boolean)
                                  .join(" · ") || "Kein Inhalt"}
                              </small>
                            </div>
                          </div>
                        ))}
                        {!showAllAssignments && selectedDetail.assignments.length > 120 && (
                          <button
                            type="button"
                            className="archive-detail-more"
                            onClick={() => setShowAllAssignments(true)}
                          >
                            Alle {selectedDetail.assignments.length} Zuweisungen anzeigen
                            ({selectedDetail.assignments.length - 120} weitere)
                          </button>
                        )}
                        {selectedDetail.assignments.length === 0 && (
                          <p className="archive-detail-empty">Keine Zuweisungen gespeichert.</p>
                        )}
                      </div>
                    </div>

                    {selectedDetail.absences.length > 0 && (
                      <div className="archive-detail-section">
                        <h4>Abwesenheiten</h4>
                        <div className="archive-detail-list">
                          {selectedDetail.absences.map((row, index) => (
                            <div className="archive-detail-row is-absence" key={`absence-${index}`}>
                              <span>{germanDate(valueOf(row, "date"))}</span>
                              <div>
                                <strong>{valueOf(row, "person") || "Unbekannter MA"}</strong>
                                <small>{valueOf(row, "typ", "type") || "Abwesenheit"}</small>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : null}

              <div className="archive-detail-actions">
                <Button href={`/plan-editor?start=${selectedWeek.start_date}`}>
                  Im Editor öffnen
                </Button>
                <button type="button" className="btn btn-danger" onClick={() => void remove(selectedWeek)}>
                  Woche löschen
                </button>
              </div>
            </aside>
          )}
        </div>
      </section>
      <ConfirmDialog
        open={deleteTarget !== null}
        variant="danger"
        title={deleteTarget ? `${deleteTarget.label} aus dem Archiv löschen?` : "Woche löschen?"}
        description={<p>Die archivierte Woche wird unwiderruflich gelöscht und kann nicht mehr als Grundlage für neue Dienstpläne verwendet werden.</p>}
        onDismiss={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        actions={[
          { label: "Abbrechen", variant: "default", autoFocus: true, disabled: deleting, onClick: () => setDeleteTarget(null) },
          { label: deleting ? "Löscht …" : "Endgültig löschen", variant: "danger", disabled: deleting, onClick: () => void confirmRemove() },
        ]}
      />
    </div>
  );
}
