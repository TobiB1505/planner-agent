"use client";

import {
  getActivePeople,
  getKnownDepartmentTokens,
  saveImport,
  uploadPdf,
  uploadXlsx,
  uploadXlsxSheets,
  type ExtractedAbsence,
  type ExtractedAssignment,
  type ExtractionResult,
} from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import FileDropzone from "./FileDropzone";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";

type Notice = { kind: "success" | "error" | "info"; text: string };

export default function ArchiveImportFlow({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (weekPlanId: number) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState("");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [departmentTokens, setDepartmentTokens] = useState<string[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Datei wird vorbereitet …");
  const [notice, setNotice] = useState<Notice | null>(null);
  // Sprint 0 (S1-Fix, C2): reset() ("Andere Datei wählen") und der
  // X-Button verwarfen einen bereits geprüften, aber noch nicht im Archiv
  // gespeicherten Import bislang kommentarlos. "resetKind" merkt sich, WELCHE
  // der beiden Aktionen bestätigt werden soll.
  const [pendingReset, setPendingReset] = useState<"reset" | "close" | null>(null);
  useUnsavedChangesGuard(Boolean(result), {
    message: "Der geprüfte Import wurde noch nicht im Archiv gespeichert und geht dabei verloren.",
  });

  useEffect(() => {
    Promise.all([getActivePeople(), getKnownDepartmentTokens()])
      .then(([names, tokens]) => {
        setPeople(names);
        setDepartmentTokens(tokens);
      })
      .catch((error) => {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "Stammdaten konnten nicht geladen werden.",
        });
      });
  }, []);

  const isExcel = file?.name.toLocaleLowerCase("de").endsWith(".xlsx") ?? false;
  const rawNames = useMemo(() => {
    if (!result) return [];
    return Array.from(new Set([
      ...result.assignments.map((row) => row.person).filter(Boolean),
      ...result.absences.map((row) => row.person).filter(Boolean),
    ] as string[])).sort((a, b) => a.localeCompare(b, "de"));
  }, [result]);

  const completedResolutions = rawNames.filter((name) => Boolean(resolutions[name])).length;
  const activeStep = result
    ? (busy && busyLabel.includes("Archiv") ? 2 : 1)
    : 0;

  function reset() {
    setFile(null);
    setSheets([]);
    setSheet("");
    setResult(null);
    setResolutions({});
    setNotice(null);
  }

  function requestReset() {
    if (result) {
      setPendingReset("reset");
      return;
    }
    reset();
  }

  function requestClose() {
    if (result) {
      setPendingReset("close");
      return;
    }
    onClose();
  }

  async function chooseFile(selected: File | null) {
    setFile(selected);
    setResult(null);
    setSheets([]);
    setSheet("");
    setResolutions({});
    setNotice(null);

    if (!selected || !selected.name.toLocaleLowerCase("de").endsWith(".xlsx")) return;

    setBusy(true);
    setBusyLabel("Excel-Reiter werden gelesen …");
    try {
      const response = await uploadXlsxSheets(selected);
      setSheets(response.sheets);
      setSheet(response.sheets[0] ?? "");
      setNotice({
        kind: "info",
        text: response.sheets.length > 1
          ? "Datei erkannt. Wähle jetzt den Wochen-Reiter aus."
          : "Excel-Datei ist bereit zum Einlesen.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Excel-Datei konnte nicht gelesen werden.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function extract() {
    if (!file) return;
    setBusy(true);
    setBusyLabel(isExcel ? "Dienstplan wird eingelesen …" : "PDF wird mit Gemini ausgewertet …");
    setNotice({
      kind: "info",
      text: isExcel
        ? "Die ausgewählte Woche wird strukturiert eingelesen."
        : "Gemini erkennt jetzt Zeitraum, Dienste und Abwesenheiten.",
    });
    try {
      const extracted = isExcel
        ? await uploadXlsx(file, sheet || undefined)
        : await uploadPdf(file);
      setResult(extracted);

      const names = Array.from(new Set([
        ...extracted.assignments.map((row) => row.person).filter(Boolean),
        ...extracted.absences.map((row) => row.person).filter(Boolean),
      ] as string[]));
      const peopleLookup = new Map(people.map((name) => [name.toLocaleLowerCase("de"), name]));
      const departmentLookup = new Set(
        departmentTokens.map((token) => token.trim().toLocaleUpperCase("de")),
      );
      const initial: Record<string, string> = {};
      names.forEach((raw) => {
        const existing = peopleLookup.get(raw.trim().toLocaleLowerCase("de"));
        if (existing) initial[raw] = `existing:${existing}`;
        else if (departmentLookup.has(raw.trim().toLocaleUpperCase("de"))) initial[raw] = "department";
        else initial[raw] = "new";
      });
      setResolutions(initial);
      setNotice({
        kind: "success",
        text: "Auswertung abgeschlossen. Prüfe die erkannten Daten kurz vor dem Speichern.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Auswertung fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
    }
  }

  function updateAssignment(index: number, key: keyof ExtractedAssignment, value: string) {
    setResult((current) => current ? {
      ...current,
      assignments: current.assignments.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row),
    } : current);
  }

  function updateAbsence(index: number, key: keyof ExtractedAbsence, value: string) {
    setResult((current) => current ? {
      ...current,
      absences: current.absences.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row),
    } : current);
  }

  async function store() {
    if (!result || !file) return;
    setBusy(true);
    setBusyLabel("Dienstplan wird im Archiv gespeichert …");
    setNotice({ kind: "info", text: "Die geprüften Daten werden übernommen." });
    try {
      const saved = await saveImport({
        filename: `${file.name}${sheet ? ` · ${sheet}` : ""}`,
        kw: result.kw,
        start_date: result.start_date,
        end_date: result.end_date,
        assignments: result.assignments,
        absences: result.absences,
        resolutions,
      });
      reset();
      onSaved(saved.week_plan_id);
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Speichern fehlgeschlagen.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="archive-import-shell" aria-label="Alten Dienstplan archivieren">
      <div className="archive-import-head">
        <div>
          <span className="archive-eyebrow">Neuer Archiv-Eintrag</span>
          <h2>Alten Dienstplan archivieren</h2>
          <p>Excel wird direkt gelesen, PDF weiterhin automatisch mit Gemini ausgewertet.</p>
        </div>
        <button type="button" className="archive-close-button" onClick={requestClose} aria-label="Import schließen">
          ×
        </button>
      </div>

      <div className="archive-stepper" aria-label="Importfortschritt">
        {[
          ["01", "Datei"],
          ["02", "Prüfen"],
          ["03", "Speichern"],
        ].map(([number, label], index) => (
          <div
            className={`archive-step ${activeStep === index ? "is-active" : ""} ${activeStep > index ? "is-complete" : ""}`}
            key={number}
          >
            <span>{activeStep > index ? "✓" : number}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </div>

      <div className="archive-import-body">
        <div className="archive-upload-column">
          <FileDropzone
            file={file}
            onFileChange={chooseFile}
            accept=".xlsx,.pdf"
            title="Dienstplan hier ablegen"
            description="Datei hineinziehen oder direkt vom Computer auswählen"
            formatLabel="Excel .xlsx · PDF .pdf"
            busy={busy}
            busyLabel={busyLabel}
          />

          {sheets.length > 0 && (
            <label className="archive-sheet-picker">
              <span>
                <strong>Wochen-Reiter</strong>
                <small>{sheets.length} Reiter erkannt</small>
              </span>
              <select value={sheet} onChange={(event) => setSheet(event.target.value)}>
                {sheets.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          )}

          {!result && (
            <button
              type="button"
              className="btn btn-primary archive-extract-button"
              disabled={!file || busy || (isExcel && sheets.length > 0 && !sheet)}
              onClick={extract}
            >
              {busy && <span className="spinner" />}
              {isExcel ? "Ausgewählte Woche einlesen" : "PDF mit Gemini auswerten"}
            </button>
          )}
        </div>

        <div className="archive-import-guide">
          <span className="archive-guide-icon">{result ? "✓" : "i"}</span>
          <div>
            <strong>{result ? "Bereit zur Prüfung" : "Was passiert beim Import?"}</strong>
            <p>
              {result
                ? "Zeitraum, Dienste und Namen wurden erkannt. Du kannst jeden Wert vor dem Speichern korrigieren."
                : "Der Plan wird nur vorbereitet. Erst nach deiner Prüfung landet er dauerhaft im Archiv."}
            </p>
          </div>
        </div>
      </div>

      {notice && <div className={`archive-import-notice status-${notice.kind}`}>{notice.text}</div>}

      {result && (
        <div className="archive-review">
          <div className="archive-review-summary">
            <label>
              <span>Kalenderwoche</span>
              <input
                type="number"
                value={result.kw ?? ""}
                onChange={(event) => setResult({
                  ...result,
                  kw: event.target.value ? Number(event.target.value) : null,
                })}
              />
            </label>
            <label>
              <span>Von</span>
              <input
                type="date"
                value={result.start_date}
                onChange={(event) => setResult({ ...result, start_date: event.target.value })}
              />
            </label>
            <label>
              <span>Bis</span>
              <input
                type="date"
                value={result.end_date}
                onChange={(event) => setResult({ ...result, end_date: event.target.value })}
              />
            </label>
            <div className="archive-review-count">
              <strong>{result.assignments.length}</strong>
              <span>Zuweisungen</span>
            </div>
            <div className="archive-review-count">
              <strong>{result.absences.length}</strong>
              <span>Abwesenheiten</span>
            </div>
          </div>

          {rawNames.length > 0 && (
            <details className="archive-review-section" open>
              <summary>
                <span>
                  <strong>Namen und Abteilungen</strong>
                  <small>Erkannte Einträge bestehenden MA zuordnen oder neu anlegen</small>
                </span>
                <span className="archive-review-progress">{completedResolutions}/{rawNames.length}</span>
              </summary>
              <div className="archive-resolution-grid">
                {rawNames.map((raw) => (
                  <label key={raw}>
                    <span title={raw}>{raw}</span>
                    <select
                      value={resolutions[raw] ?? "new"}
                      onChange={(event) => setResolutions((current) => ({
                        ...current,
                        [raw]: event.target.value,
                      }))}
                    >
                      <option value="new">Als neuen MA anlegen</option>
                      <option value="department">Abteilung / kein einzelner MA</option>
                      {people.map((person) => (
                        <option key={person} value={`existing:${person}`}>Mit {person} verbinden</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </details>
          )}

          <details className="archive-review-section">
            <summary>
              <span>
                <strong>Zuweisungen prüfen</strong>
                <small>Dienst, Uhrzeit und erkannte Person oder Inhalt</small>
              </span>
              <span className="archive-review-progress">{result.assignments.length}</span>
            </summary>
            <div className="archive-assignment-list">
              {result.assignments.map((row, index) => {
                const valueKey: keyof ExtractedAssignment =
                  row.person === null || row.person === undefined ? "raw_text" : "person";
                return (
                <div className="archive-assignment-row" key={`${row.date}-${row.category}-${index}`}>
                  <input
                    aria-label="Datum"
                    type="date"
                    value={row.date}
                    onChange={(event) => updateAssignment(index, "date", event.target.value)}
                  />
                  <input
                    aria-label="Abschnitt"
                    value={row.category}
                    onChange={(event) => updateAssignment(index, "category", event.target.value)}
                  />
                  <input
                    aria-label="Zeile oder Uhrzeit"
                    value={row.subcategory ?? ""}
                    placeholder="Zeile / Uhrzeit"
                    onChange={(event) => updateAssignment(index, "subcategory", event.target.value)}
                  />
                  <input
                    aria-label="Mitarbeiter oder Inhalt"
                    value={row[valueKey] ?? ""}
                    placeholder="MA / Inhalt"
                    onChange={(event) => updateAssignment(index, valueKey, event.target.value)}
                  />
                </div>
                );
              })}
              {result.assignments.length === 0 && (
                <p className="archive-review-empty">Keine Zuweisungen erkannt.</p>
              )}
            </div>
          </details>

          {result.absences.length > 0 && (
            <details className="archive-review-section">
              <summary>
                <span>
                  <strong>Abwesenheiten prüfen</strong>
                  <small>Urlaub, Krank und Frei</small>
                </span>
                <span className="archive-review-progress">{result.absences.length}</span>
              </summary>
              <div className="archive-absence-list">
                {result.absences.map((row, index) => (
                  <div className="archive-absence-row" key={`${row.date}-${row.person}-${index}`}>
                    <input
                      aria-label="Datum"
                      type="date"
                      value={row.date}
                      onChange={(event) => updateAbsence(index, "date", event.target.value)}
                    />
                    <input
                      aria-label="Mitarbeiter"
                      value={row.person}
                      onChange={(event) => updateAbsence(index, "person", event.target.value)}
                    />
                    <select
                      aria-label="Art der Abwesenheit"
                      value={row.type}
                      onChange={(event) => updateAbsence(index, "type", event.target.value)}
                    >
                      <option>Frei</option>
                      <option>Urlaub</option>
                      <option>Krank</option>
                      <option>Urlaub/Krank</option>
                    </select>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="archive-review-actions">
            <button type="button" className="btn" onClick={requestReset}>
              Andere Datei wählen
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={store}>
              {busy && <span className="spinner" />}
              Im Archiv speichern
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingReset !== null}
        title="Geprüften Import verwerfen?"
        description="Dieser Import wurde noch nicht im Archiv gespeichert. Ohne Speichern gehen die geprüften Daten verloren."
        onDismiss={() => setPendingReset(null)}
        actions={[
          { label: "Abbrechen", onClick: () => setPendingReset(null) },
          {
            label: "Verwerfen",
            variant: "danger",
            autoFocus: true,
            onClick: () => {
              const kind = pendingReset;
              setPendingReset(null);
              reset();
              if (kind === "close") onClose();
            },
          },
        ]}
      />
    </section>
  );
}
