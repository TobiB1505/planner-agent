"use client";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import InlineStatus from "@/components/ui/InlineStatus";
import PageHeader from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import FileDropzone from "@/components/FileDropzone";
import PlanReviewHeader from "@/components/PlanReviewHeader";
import ReadingProgress from "@/components/ReadingProgress";
import SavedPlanList from "@/components/SavedPlanList";
import WeekPicker from "@/components/WeekPicker";
import {
  deleteRehearsalPlan,
  getRehearsalPlan,
  getRehearsalPlans,
  importRehearsalPlan,
  uploadRehearsalPlanSheets,
  saveRehearsalPlan,
  type RehearsalEntry,
  type RehearsalPlanData,
  type RehearsalPlanSummary,
} from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${iso}T12:00:00`));
}

function shiftIsoDate(iso: string, days: number): string {
  const value = new Date(`${iso}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

export default function RehearsalPlanPage() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<RehearsalPlanSummary[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState("");
  const [plan, setPlan] = useState<RehearsalPlanData | null>(null);
  const [busy, setBusy] = useState(false);
  const [processingSource, setProcessingSource] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "info";
    text: string;
  } | null>(null);
  // Sprint 0 (S1-Fix, C2): bislang ungeschützte Tabellen-Änderungen.
  const [isDirty, setIsDirty] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  useUnsavedChangesGuard(isDirty, {
    message: "Der Probenplan hat ungespeicherte Änderungen, die dabei verloren gehen.",
  });

  const refreshPlans = useCallback(async () => {
    setPlans(await getRehearsalPlans());
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshPlans().catch((error) =>
        setMessage({ kind: "error", text: error.message }),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshPlans]);

  const recognition = useMemo(() => {
    const bindings = plan?.rehearsals.flatMap((row) => row.people ?? []) ?? [];
    const recognized = new Set(
      bindings.map((person) => person.person_name).filter(Boolean),
    );
    const unresolved = new Set(
      bindings
        .filter((person) => !person.person_name)
        .map((person) => person.raw_name),
    );
    return { recognized: recognized.size, unresolved: [...unresolved] };
  }, [plan]);

  const isExcel = Boolean(file && file.name.toLocaleLowerCase().endsWith(".xlsx"));

  /** Bei Excel zuerst die Wochenblätter holen, damit die Woche gewählt werden kann. */
  async function chooseFile(nextFile: File | null) {
    setFile(nextFile);
    setPlan(null);
    setIsDirty(false);
    setSetupOpen(true);
    setSheets([]);
    setSheet("");
    if (!nextFile || !nextFile.name.toLocaleLowerCase().endsWith(".xlsx")) return;
    setBusy(true);
    try {
      const result = await uploadRehearsalPlanSheets(nextFile);
      setSheets(result.sheets);
      setSheet(result.sheets.at(-1) ?? "");
      setMessage({
        kind: "info",
        text: "Excel gelesen. Bitte die gewünschte Probenwoche auswählen.",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Excel konnte nicht gelesen werden.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    if (!file) {
      setMessage({ kind: "error", text: "Bitte zuerst eine Datei auswählen." });
      return;
    }
    if (isExcel && !sheet) {
      setMessage({ kind: "error", text: "Bitte zuerst eine Probenwoche auswählen." });
      return;
    }
    setBusy(true);
    setProcessingSource(true);
    setMessage({
      kind: "info",
      text: isExcel
        ? "Probenwoche wird aus der Excel-Datei gelesen …"
        : "Probenplan wird mit Gemini ausgelesen …",
    });
    try {
      const result = await importRehearsalPlan(file, isExcel ? sheet : undefined);
      setPlan(result);
      setIsDirty(false);
      setSetupOpen(false);
      const quelle = result.extraction_method === "gemini"
        ? "mit Gemini "
        : result.extraction_method === "excel"
          ? "aus der Excel-Datei "
          : "";
      setMessage({
        kind: "success",
        text: `${result.rehearsals.length} Proben ${quelle}erkannt. Bitte kurz prüfen und anschließend aktivieren.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Auswertung fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
      setProcessingSource(false);
    }
  }

  function updateRow(index: number, patch: Partial<RehearsalEntry>) {
    setPlan((current) =>
      current
        ? {
            ...current,
            rehearsals: current.rehearsals.map((row, rowIndex) =>
              rowIndex === index ? { ...row, ...patch } : row,
            ),
          }
        : current,
    );
    setIsDirty(true);
  }

  function changeWeekStart(nextStart: string) {
    setPlan((current) => {
      if (!current || !nextStart) return current;
      const previous = new Date(`${current.start_date}T12:00:00`);
      const next = new Date(`${nextStart}T12:00:00`);
      const delta = Math.round((next.getTime() - previous.getTime()) / 86400000);
      return {
        ...current,
        start_date: nextStart,
        end_date: shiftIsoDate(current.end_date, delta),
        rehearsals: current.rehearsals.map((row) => ({
          ...row,
          date: shiftIsoDate(row.date, delta),
        })),
      };
    });
    setIsDirty(true);
  }

  async function save() {
    if (!plan) return;
    setBusy(true);
    try {
      const result = await saveRehearsalPlan(plan);
      await refreshPlans();
      const stored = await getRehearsalPlan(result.rehearsal_plan_id);
      setPlan(stored);
      setIsDirty(false);
      setMessage({
        kind: "success",
        text: "Probenplan aktiviert. Die Dienstplan-Erstellung berücksichtigt ihn für diese Woche automatisch.",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Speichern fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function loadPlan(id: number) {
    setBusy(true);
    try {
      setPlan(await getRehearsalPlan(id));
      setIsDirty(false);
      setSetupOpen(false);
      setMessage({ kind: "success", text: "Gespeicherter Probenplan geladen." });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Laden fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removePlan(id: number) {
    setBusy(true);
    try {
      await deleteRehearsalPlan(id);
      if (plan?.id === id) {
        setPlan(null);
        setIsDirty(false);
      }
      setSetupOpen(true);
      await refreshPlans();
      toast({ variant: "success", title: "Probenplan wurde gelöscht" });
      setDeleteConfirmOpen(false);
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Löschen fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1900px]">
      <PageHeader
        title="Probenplan"
        subtitle="Probenplan als PDF oder Excel einlesen – die Proben werden automatisch als Zeitblockaden in der Dienstplanung berücksichtigt"
      />

      <section className={`plan-source-workspace ${!setupOpen && plan ? "is-collapsed" : ""}`}>
        <div className="source-workflow-head">
          <div>
            <span className="planner-week-eyebrow">Verfügbarkeit vorbereiten</span>
            <strong>Probenplan einlesen und erkannte Proben prüfen</strong>
          </div>
          <div className="source-head-actions">
            <div className="source-mini-steps" aria-label="Importfortschritt">
              <span className={file || plan ? "is-complete" : "is-active"}>{file || plan ? "✓" : "1"} Quelle</span>
              <span className={plan ? "is-complete" : file ? "is-active" : ""}>{plan ? "✓" : "2"} Prüfen</span>
              <span className={plan?.id ? "is-complete" : plan ? "is-active" : ""}>{plan?.id ? "✓" : "3"} Aktivieren</span>
            </div>
            {plan && (
              <button className="source-toggle" onClick={() => setSetupOpen((current) => !current)}>
                {setupOpen ? "Import ausblenden" : "Quelle wechseln"}
              </button>
            )}
          </div>
        </div>
        {setupOpen ? <div className="plan-source-grid">
          <div className="source-card">
            <div className="source-card-head">
              <div>
                <strong>Probenplan einlesen</strong>
                <small>
                  {isExcel
                    ? "Excel wird direkt gelesen – Zeiten, Teilnehmer und T&C"
                    : "Excel wird direkt gelesen, PDF automatisch mit Gemini ausgewertet"}
                </small>
              </div>
            </div>
            <div className="source-card-body source-card-body-stack">
              <FileDropzone
                file={file}
                onFileChange={chooseFile}
                accept=".pdf,application/pdf,.xlsx"
                title="Probenplan hier ablegen"
                description="PDF oder Excel hineinziehen oder auf diesen Bereich klicken"
                formatLabel="PDF .pdf · Excel .xlsx"
                busy={processingSource}
                busyLabel={isExcel
                  ? "Probenwoche wird aus der Excel-Datei gelesen …"
                  : "Probenplan wird mit Gemini ausgelesen …"}
              />
              {sheets.length > 0 && (
                <label className="field">
                  <span className="field-label">Probenwoche</span>
                  <select
                    className="control"
                    value={sheet}
                    onChange={(event) => setSheet(event.target.value)}
                  >
                    {sheets.map((name) => <option key={name}>{name}</option>)}
                  </select>
                </label>
              )}
              <button
                className="btn btn-primary"
                disabled={busy || !file || (isExcel && !sheet)}
                onClick={analyze}
              >
                {!file ? "Probenplan auslesen" : isExcel ? "Excel auslesen" : "PDF auslesen"}
              </button>
            </div>
          </div>

          <div className="source-card">
            <div className="source-card-head">
              <div>
                <strong>Wochenbibliothek</strong>
                <small>Bereits aktivierten Probenplan öffnen</small>
              </div>
            </div>
            <div className="source-card-body source-card-body-stack">
              <div className="saved-plan-section">
                <span className="field-label">Gespeicherte Probenpläne</span>
                <SavedPlanList
                  items={plans.map((item) => ({
                    id: item.id,
                    startDate: item.start_date,
                    endDate: item.end_date,
                    title: item.label,
                    detail: item.source_filename || "Probenplan",
                    meta: `${item.rehearsal_count} erkannte Proben`,
                  }))}
                  selectedId={plan?.id ?? null}
                  onSelect={(id) => void loadPlan(id)}
                  emptyText="Noch keine Probenpläne gespeichert"
                />
              </div>
            </div>
          </div>
        </div> : plan && (
          <div className="source-collapsed-summary">
            <span className="source-collapsed-check">✓</span>
            <div>
              <strong>{plan.source_filename || "Probenplan geöffnet"}</strong>
              <span>{formatDate(plan.start_date)} – {formatDate(plan.end_date)} · {plan.rehearsals.length} Proben</span>
            </div>
            <span className={plan.id ? "is-active" : ""}>{plan.id ? "Aktiv" : "In Prüfung"}</span>
          </div>
        )}
      </section>

      {busy && !processingSource && (
        <ReadingProgress
          label={message?.text ?? "Probenplan wird ausgelesen …"}
          detail="Seiten, Tabellen, Uhrzeiten und Mitarbeiter werden zusammengeführt"
        />
      )}

      {message && (!busy || message.kind !== "info") && (
        <InlineStatus
          variant={message.kind === "error" ? "danger" : message.kind}
          className="plan-page-status"
        >
          {message.text}
        </InlineStatus>
      )}

      {plan && (
        <>
          <PlanReviewHeader
            eyebrow="Proben und Verfügbarkeiten"
            title={plan.source_filename || "Probenplan der Woche"}
            description="Erkannte Zeiten und Teilnehmer kurz prüfen. Überschneidungen werden danach automatisch in der Dienstplanung berücksichtigt."
            active={Boolean(plan.id)}
            dirty={isDirty}
            metrics={[
              `${plan.rehearsals.length} Proben`,
              `${recognition.recognized} aktive MA erkannt`,
              `${formatDate(plan.start_date)} – ${formatDate(plan.end_date)}`,
            ]}
            weekPicker={
              <WeekPicker
                value={plan.start_date}
                onChange={changeWeekStart}
                label="Planwoche"
              />
            }
            primaryLabel={plan.id ? "Änderungen speichern" : "Für Dienstplan aktivieren"}
            onPrimary={save}
            busy={busy}
            secondaryHref="/plan-editor"
            menuItems={plan.id ? [
              {
                label: "Probenplan löschen",
                onClick: () => setDeleteConfirmOpen(true),
                danger: true,
              },
            ] : []}
          >
            {recognition.unresolved.length > 0 && (
              <div className="plan-review-warning">
                <strong>Nicht im aktiven Mitarbeiterpool:</strong>
                <span>{recognition.unresolved.join(", ")}</span>
              </div>
            )}
            {plan.warnings.length > 0 && (
              <div className="plan-review-warning">
                {plan.warnings.map((warning) => <div key={warning}>Hinweis: {warning}</div>)}
              </div>
            )}
          </PlanReviewHeader>

          <section className="panel mt-4 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="rehearsal-table min-w-[1320px]">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Zeit</th>
                    <th>Ort</th>
                    <th>Probe / Inhalt</th>
                    <th>Show</th>
                    <th>Teilnehmer</th>
                    <th>Tanzchoreograf</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {plan.rehearsals.map((row, index) => (
                    <tr key={`${row.date}-${row.start_time}-${index}`}>
                      <td>
                        <input type="date" value={row.date} onChange={(event) => updateRow(index, { date: event.target.value })} />
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <input type="time" value={row.start_time} onChange={(event) => updateRow(index, { start_time: event.target.value })} />
                          <span>–</span>
                          <input type="time" value={row.end_time} onChange={(event) => updateRow(index, { end_time: event.target.value, end_inferred: false })} />
                        </div>
                      </td>
                      <td>
                        <input value={row.location ?? ""} onChange={(event) => updateRow(index, { location: event.target.value })} />
                      </td>
                      <td>
                        <input value={row.activity ?? ""} onChange={(event) => updateRow(index, { activity: event.target.value })} />
                      </td>
                      <td>
                        <input value={row.show_code ?? ""} onChange={(event) => updateRow(index, { show_code: event.target.value })} />
                      </td>
                      <td>
                        <textarea value={row.participants_raw ?? ""} onChange={(event) => updateRow(index, { participants_raw: event.target.value })} />
                      </td>
                      <td>
                        <input value={row.choreographer_raw ?? ""} onChange={(event) => updateRow(index, { choreographer_raw: event.target.value })} />
                      </td>
                      <td>
                        <button
                          className="btn btn-icon"
                          title="Zeile entfernen"
                          onClick={() => {
                            setPlan((current) => current
                              ? { ...current, rehearsals: current.rehearsals.filter((_, rowIndex) => rowIndex !== index) }
                              : current
                            );
                            setIsDirty(true);
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <ConfirmDialog
        open={deleteConfirmOpen}
        variant="danger"
        title="Probenplan endgültig löschen?"
        description={<p>Der Probenplan für diese Woche wird unwiderruflich gelöscht. Bereits gespeicherte Dienstpläne bleiben unverändert erhalten.</p>}
        onDismiss={() => {
          if (!busy) setDeleteConfirmOpen(false);
        }}
        actions={[
          { label: "Abbrechen", variant: "default", autoFocus: true, disabled: busy, onClick: () => setDeleteConfirmOpen(false) },
          { label: busy ? "Löscht …" : "Endgültig löschen", variant: "danger", disabled: busy, onClick: () => plan?.id && void removePlan(plan.id) },
        ]}
      />
    </div>
  );
}
