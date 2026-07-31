"use client";

import PageHeader from "@/components/PageHeader";
import ArtistTextCellEditor from "@/components/ArtistTextCellEditor";
import FileDropzone from "@/components/FileDropzone";
import PlanReviewHeader from "@/components/PlanReviewHeader";
import ReadingProgress from "@/components/ReadingProgress";
import SavedPlanList from "@/components/SavedPlanList";
import WeekPicker from "@/components/WeekPicker";
import {
  createEmptyArtistPlan,
  deleteArtistPlan,
  exportArtistPlan,
  getArtistPlan,
  getArtistPlans,
  importArtistPlan,
  saveArtistPlan,
  uploadArtistPlanSheets,
  type ArtistPlanData,
  type ArtistPlanRow,
  type ArtistPlanSummary,
} from "@/lib/api";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useEffect, useMemo, useState } from "react";

ModuleRegistry.registerModules([AllCommunityModule]);

const groupColors: Record<string, string> = {
  "Tages-Entertainment": "#C67EBD",
  "Abend-Entertainment": "#95CA82",
  Zusatzinformationen: "#8D96A8",
};

const artistGridTheme = themeQuartz.withParams({
  accentColor: "#6c7bff",
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--foreground)",
  borderColor: "var(--border)",
  headerBackgroundColor: "var(--background)",
  oddRowBackgroundColor: "var(--surface)",
  rowHoverColor: "var(--accent-soft)",
  fontFamily: "var(--font-app)",
  fontSize: 13,
  headerFontSize: 12,
  spacing: 7,
});

function mondayIso(): string {
  const now = new Date();
  const weekday = now.getDay() || 7;
  // Auf 12 Uhr mittags verankern, sonst springt toISOString() in den Nachtstunden
  // einen Tag zurück und die Woche startet auf einem Sonntag.
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1, 12);
  return monday.toISOString().slice(0, 10);
}

const WEEKDAYS_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function dateIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shortDayLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return `${WEEKDAYS_DE[date.getDay()]} ${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.`;
}

function rgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

export default function ArtistPlanPage() {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState("");
  const [startDate, setStartDate] = useState(mondayIso);
  const [plan, setPlan] = useState<ArtistPlanData | null>(null);
  const [savedPlans, setSavedPlans] = useState<ArtistPlanSummary[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [processingSource, setProcessingSource] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "info";
    text: string;
  } | null>(null);

  async function refreshSaved() {
    const saved = await getArtistPlans();
    setSavedPlans(saved);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshSaved().catch((error) =>
        setMessage({ kind: "error", text: error.message }),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const columnDefs = useMemo<ColDef<ArtistPlanRow>[]>(() => {
    const fixed: ColDef<ArtistPlanRow> = {
      field: "label",
      headerName: "Künstlerprogramm",
      pinned: "left",
      lockPinned: true,
      width: 230,
      editable: false,
      cellStyle: (params) => {
        const color = groupColors[params.data?.group ?? ""] ?? "#6c7bff";
        return {
          backgroundColor: rgba(color, 0.22),
          borderLeft: `4px solid ${color}`,
          fontWeight: "720",
        };
      },
    };
    const dayColumns = (plan?.day_labels ?? []).map<ColDef<ArtistPlanRow>>((label) => ({
      field: label,
      headerName: label,
      minWidth: 165,
      flex: 1,
      editable: true,
      singleClickEdit: true,
      wrapText: true,
      autoHeight: true,
      cellEditor: ArtistTextCellEditor,
      cellEditorPopup: true,
      cellEditorPopupPosition: "under",
      suppressKeyboardEvent: (params) =>
        params.editing && params.event.key === "Enter",
      cellStyle: (params) => {
        const color = groupColors[params.data?.group ?? ""] ?? "#6c7bff";
        return {
          backgroundColor: rgba(color, 0.08),
          cursor: "text",
          lineHeight: "1.35",
        };
      },
    }));
    return [fixed, ...dayColumns];
  }, [plan?.day_labels]);

  async function chooseFile(nextFile: File | null) {
    setFile(nextFile);
    setPlan(null);
    setSheets([]);
    setSheet("");
    if (!nextFile) return;
    setSetupOpen(true);
    setBusy(true);
    setProcessingSource(true);
    setMessage({ kind: "info", text: "Wochenblätter werden gelesen …" });
    try {
      const result = await uploadArtistPlanSheets(nextFile);
      setSheets(result.sheets);
      setSheet(result.sheets.at(-1) ?? "");
      setMessage({
        kind: "success",
        text: `${result.sheets.length} Wochenblätter erkannt. Wähle jetzt die gewünschte Woche.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Datei konnte nicht gelesen werden.",
      });
    } finally {
      setBusy(false);
      setProcessingSource(false);
    }
  }

  async function importSelected() {
    if (!file || !sheet) return;
    setBusy(true);
    setProcessingSource(true);
    setMessage({ kind: "info", text: "Künstlerplan wird übernommen …" });
    try {
      const result = await importArtistPlan(file, sheet);
      setPlan(result);
      setStartDate(result.start_date);
      setSetupOpen(false);
      setMessage({
        kind: "success",
        text: "Woche erkannt. Bitte kurz prüfen und anschließend für den Dienstplan aktivieren.",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Import fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
      setProcessingSource(false);
    }
  }

  async function createEmpty() {
    setBusy(true);
    try {
      const result = await createEmptyArtistPlan(startDate);
      setPlan(result);
      setFile(null);
      setSheets([]);
      setSheet("");
      setSetupOpen(false);
      setMessage({
        kind: "success",
        text: "Leere Künstlerwoche erstellt. Du kannst alle Felder direkt befüllen.",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Woche konnte nicht erstellt werden.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function loadSaved(id: string) {
    setSelectedSavedId(id);
    if (!id) return;
    setBusy(true);
    try {
      const result = await getArtistPlan(Number(id));
      setPlan(result);
      setStartDate(result.start_date);
      setFile(null);
      setSheets([]);
      setSheet("");
      setSetupOpen(false);
      setMessage({ kind: "success", text: "Gespeicherter Künstlerplan geladen." });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Künstlerplan konnte nicht geladen werden.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveAndActivate() {
    if (!plan) return;
    setBusy(true);
    try {
      const saved = await saveArtistPlan(plan);
      setPlan({ ...plan, id: saved.artist_plan_id });
      setSelectedSavedId(String(saved.artist_plan_id));
      await refreshSaved();
      setMessage({
        kind: "success",
        text: "Künstlerplan gespeichert. Beim Erstellen derselben Woche wird er automatisch in den Dienstplan übernommen.",
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

  async function removeCurrent() {
    if (!plan?.id) return;
    if (!window.confirm("Diesen Künstlerplan wirklich löschen?")) return;
    setBusy(true);
    try {
      await deleteArtistPlan(plan.id);
      setPlan(null);
      setSelectedSavedId("");
      setSetupOpen(true);
      await refreshSaved();
      setMessage({ kind: "success", text: "Künstlerplan wurde gelöscht." });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Löschen fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function downloadExcel() {
    if (!plan?.id) return;
    setBusy(true);
    try {
      const blob = await exportArtistPlan(plan.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Künstlerplan_${plan.start_date}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage({ kind: "success", text: "Künstlerplan wurde als Excel heruntergeladen." });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Excel-Export fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
    }
  }

  const filledCount = plan
    ? plan.rows.reduce(
        (sum, row) =>
          sum + plan.day_labels.filter((label) => Boolean(row[label]?.trim())).length,
        0,
      )
    : 0;

  function changePlanWeek(nextStart: string) {
    if (!plan || !nextStart || nextStart === plan.start_date) return;
    const start = new Date(`${nextStart}T12:00:00`);
    const weekDates = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return dateIso(day);
    });
    const nextLabels = weekDates.map(shortDayLabel);
    const previousLabels = plan.day_labels;
    const nextRows = plan.rows.map((row) => {
      const nextRow = { ...row };
      previousLabels.forEach((oldLabel, index) => {
        const value = row[oldLabel] ?? "";
        delete nextRow[oldLabel];
        nextRow[nextLabels[index]] = value;
      });
      return nextRow;
    });
    setPlan({
      ...plan,
      id: undefined,
      start_date: weekDates[0],
      end_date: weekDates[6],
      week_dates_iso: weekDates,
      day_labels: nextLabels,
      rows: nextRows,
    });
    setStartDate(nextStart);
    setSelectedSavedId("");
  }

  return (
    <div className="mx-auto max-w-[1900px]">
      <PageHeader
        title="Künstlerplan"
        subtitle="Künstler, DJs, Orte und Uhrzeiten importieren oder direkt bearbeiten"
      />

      <section className={`plan-source-workspace ${!setupOpen && plan ? "is-collapsed" : ""}`}>
        <div className="source-workflow-head">
          <div>
            <span className="planner-week-eyebrow">Programm vorbereiten</span>
            <strong>Excel importieren oder leere Woche anlegen</strong>
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
                <strong>Excel-Woche einlesen</strong>
                <small>Bestehenden Künstlerplan übernehmen</small>
              </div>
            </div>
            <div className="source-card-body source-card-body-stack">
              <FileDropzone
                file={file}
                onFileChange={chooseFile}
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                title="Künstlerplan hier ablegen"
                description="Datei hineinziehen oder auf diesen Bereich klicken"
                formatLabel="Excel · .xlsx"
                busy={processingSource}
                busyLabel={sheets.length ? "Künstlerwoche wird übernommen …" : "Wochenblätter werden gelesen …"}
              />
              {sheets.length > 0 && (
                <div className="source-inline-actions">
                  <label className="field field-grow">
                    <span className="field-label">Erkannte Woche</span>
                    <select
                      className="control"
                      value={sheet}
                      onChange={(event) => setSheet(event.target.value)}
                    >
                      {sheets.map((name) => <option key={name}>{name}</option>)}
                    </select>
                  </label>
                  <button
                    className="btn btn-primary"
                    disabled={!file || !sheet || busy}
                    onClick={importSelected}
                  >
                    Woche übernehmen
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="source-card">
            <div className="source-card-head">
              <div>
                <strong>Wochenbibliothek</strong>
                <small>Leere Woche anlegen oder gespeicherten Plan öffnen</small>
              </div>
            </div>
            <div className="source-card-body source-card-body-stack">
              <div className="source-inline-actions">
                <WeekPicker
                  value={startDate}
                  onChange={setStartDate}
                  label="Wochenbeginn"
                />
                <button className="btn" disabled={!startDate || busy} onClick={createEmpty}>
                  Leere Woche anlegen
                </button>
              </div>
              <div className="saved-plan-section">
                <span className="field-label">Gespeicherte Künstlerpläne</span>
                <SavedPlanList
                  items={savedPlans.map((saved) => ({
                    id: saved.id,
                    startDate: saved.start_date,
                    endDate: saved.end_date,
                    title: saved.label,
                    detail: saved.sheet_name || saved.source_filename || "Künstlerplan",
                    meta: `${saved.filled_entries} ausgefüllte Einträge`,
                  }))}
                  selectedId={selectedSavedId ? Number(selectedSavedId) : null}
                  onSelect={(id) => void loadSaved(String(id))}
                  emptyText="Noch keine Künstlerpläne gespeichert"
                />
              </div>
            </div>
          </div>
        </div> : plan && (
          <div className="source-collapsed-summary">
            <span className="source-collapsed-check">✓</span>
            <div>
              <strong>{plan.sheet_name || plan.source_filename || "Künstlerplan geöffnet"}</strong>
              <span>{plan.day_labels[0]} – {plan.day_labels.at(-1)} · {filledCount} ausgefüllte Einträge</span>
            </div>
            <span className={plan.id ? "is-active" : ""}>{plan.id ? "Aktiv" : "In Bearbeitung"}</span>
          </div>
        )}
      </section>

      {busy && !processingSource && (
        <ReadingProgress
          label={message?.text ?? "Künstlerplan wird verarbeitet …"}
          detail="Wochenblätter und Programmdaten werden vorbereitet"
        />
      )}

      {message && (!busy || message.kind !== "info") && (
        <div className={`status status-${message.kind}`}>{message.text}</div>
      )}

      {plan && (
        <>
          <PlanReviewHeader
            eyebrow="Künstlerwoche prüfen"
            title={plan.sheet_name || "Künstlerprogramm der Woche"}
            description={`${plan.day_labels[0]} – ${plan.day_labels.at(-1)} · Zelle anklicken, um sie direkt zu bearbeiten.`}
            active={Boolean(plan.id)}
            metrics={[`${filledCount} gefüllte Felder`, `${plan.rows.length} Programmzeilen`]}
            weekPicker={
              <WeekPicker
                value={plan.start_date}
                onChange={changePlanWeek}
                label="Planwoche"
              />
            }
            primaryLabel={plan.id ? "Änderungen speichern" : "Für Dienstplan aktivieren"}
            onPrimary={saveAndActivate}
            busy={busy}
            secondaryHref="/plan-editor"
            menuItems={plan.id ? [
              { label: "Excel herunterladen", onClick: () => void downloadExcel() },
              { label: "Künstlerplan löschen", onClick: () => void removeCurrent(), danger: true },
            ] : []}
          />

          <section className="panel mt-3 overflow-hidden">
            <div className="overflow-x-auto">
              <div className="artist-plan-grid h-[calc(100vh-330px)] min-h-[520px] min-w-[1100px]">
                <AgGridReact<ArtistPlanRow>
                  theme={artistGridTheme}
                  rowData={plan.rows}
                  columnDefs={columnDefs}
                  defaultColDef={{ sortable: false, resizable: true }}
                  suppressFieldDotNotation
                  stopEditingWhenCellsLoseFocus
                  undoRedoCellEditing
                  undoRedoCellEditingLimit={30}
                  getRowId={(params) => params.data.field_key}
                  onCellValueChanged={() =>
                    setPlan((current) => current ? { ...current, rows: [...current.rows] } : current)
                  }
                />
              </div>
            </div>
          </section>

          <div className="plan-sync-note">
            <span>✓</span>
            <p>
              Show/Party, DJs, Chillout, Mittagsgrill, Gastrotainment, Specials und
              NITE CLUB werden automatisch übernommen. Interne MA-Zuweisungen bleiben erhalten.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
