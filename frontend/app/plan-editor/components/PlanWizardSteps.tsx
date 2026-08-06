// AP12 (Schritt 7 sinngemäß auf den Wizard angewendet): die vier
// Wizard-Panels (Künstlerplan, Probenplan, Vorlagenwahl, Export) aus
// page.tsx extrahiert. Reines JSX + Callback-Weiterleitung, keine eigene
// Logik - unverändert gegenüber dem Original.
import PreparationStatusCard from "@/components/PreparationStatusCard";
import type { ArtistPlanSummary, PlanTemplate, RehearsalPlanSummary } from "@/lib/api";

export interface ArtistPlanStepProps {
  artistPlanForWeek: ArtistPlanSummary | undefined;
  onContinue: () => void;
}

export function ArtistPlanStep({ artistPlanForWeek, onContinue }: ArtistPlanStepProps) {
  return (
    <section className="panel wizard-stage">
      <div className="wizard-stage-head">
        <span className="wizard-stage-number">01</span>
        <div>
          <h2>Künstlerprogramm vorbereiten</h2>
          <p>Shows, Partys, DJs, Chillout und Aperitif werden später automatisch in den Dienstplan übernommen.</p>
        </div>
      </div>
      <PreparationStatusCard
        ready={Boolean(artistPlanForWeek)}
        readyLabel={artistPlanForWeek?.sheet_name || artistPlanForWeek?.source_filename || "Künstlerplan"}
        readyDetail={`${artistPlanForWeek?.filled_entries ?? 0} Programmeinträge`}
        emptyIcon="K"
        emptyTitle="Künstlerplan hochladen"
        emptyDescription="Excel-Datei auswählen, Woche prüfen und für den Dienstplan aktivieren."
        href="/artist-plan"
        openLabel="Künstlerplan öffnen"
      />
      <div className="wizard-actions">
        <span>Der Schritt wird automatisch abgehakt, sobald der Plan für diese Woche gespeichert ist.</span>
        <button className="btn btn-primary" onClick={onContinue}>
          Weiter zum Probenplan
        </button>
      </div>
    </section>
  );
}

export interface RehearsalPlanStepProps {
  rehearsalPlanForWeek: RehearsalPlanSummary | undefined;
  onBack: () => void;
  onContinue: () => void;
}

export function RehearsalPlanStep({ rehearsalPlanForWeek, onBack, onContinue }: RehearsalPlanStepProps) {
  return (
    <section className="panel wizard-stage">
      <div className="wizard-stage-head">
        <span className="wizard-stage-number">02</span>
        <div>
          <h2>Proben und Verfügbarkeiten einlesen</h2>
          <p>Teilnehmer und Tanzchoreografen werden während ihrer Probe automatisch für parallele Dienste gesperrt.</p>
        </div>
      </div>
      <PreparationStatusCard
        ready={Boolean(rehearsalPlanForWeek)}
        readyLabel={rehearsalPlanForWeek?.source_filename || "Probenplan"}
        readyDetail={`${rehearsalPlanForWeek?.rehearsal_count ?? 0} Proben`}
        emptyIcon="P"
        emptyTitle="Probenplan hochladen"
        emptyDescription="PDF lokal auswerten, erkannte Zeiten prüfen und für diese Woche aktivieren."
        href="/rehearsal-plan"
        openLabel="Probenplan öffnen"
      />
      <div className="wizard-actions">
        <button className="btn" onClick={onBack}>Zurück</button>
        <button className="btn btn-primary" onClick={onContinue}>
          Weiter zur Dienstplanung
        </button>
      </div>
    </section>
  );
}

export interface TemplateChoiceStepProps {
  templates: PlanTemplate[];
  templateCode: "A" | "B";
  onTemplateCodeChange: (code: "A" | "B") => void;
  hasRows: boolean;
  busy: boolean;
  onGenerate: () => void;
  artistPlanReady: boolean;
  rehearsalPlanReady: boolean;
  activePeopleCount: number;
}

export function TemplateChoiceStep({
  templates,
  templateCode,
  onTemplateCodeChange,
  hasRows,
  busy,
  onGenerate,
  artistPlanReady,
  rehearsalPlanReady,
  activePeopleCount,
}: TemplateChoiceStepProps) {
  return (
    <section className="panel wizard-stage">
      <div className="wizard-stage-head compact">
        <span className="wizard-stage-number">03</span>
        <div>
          <h2>Dienstplan erstellen und bearbeiten</h2>
          <p>Grundwoche wählen, Vorschlag erzeugen und Zuweisungen direkt im Plan anpassen.</p>
        </div>
      </div>
      <div className="planner-config">
        <div className="field field-grow planner-template-field">
          <span className="field-label">Programm-Rhythmus</span>
          <div className="template-choice-grid">
            {templates.map((template) => (
              <button
                key={template.code}
                type="button"
                className={`template-choice ${templateCode === template.code ? "is-selected" : ""}`}
                onClick={() => onTemplateCodeChange(template.code)}
              >
                <span>{template.name}</span>
                <strong>{template.program}</strong>
                <small>{template.code === "A" ? "Ungerade Kalenderwochen" : "Gerade Kalenderwochen"}</small>
              </button>
            ))}
          </div>
        </div>
        {!hasRows && (
          <div className="planner-config-actions">
            <button className="btn btn-primary" disabled={busy} onClick={onGenerate}>
              {busy && <span className="spinner" />}
              Dienstplan erstellen
            </button>
          </div>
        )}
      </div>
      <div className="planner-source-status">
        <span className={artistPlanReady ? "is-ready" : ""}>
          {artistPlanReady ? "✓" : "–"} Künstlerplan
        </span>
        <span className={rehearsalPlanReady ? "is-ready" : ""}>
          {rehearsalPlanReady ? "✓" : "–"} Probenplan
        </span>
        <span>✓ Planungsregeln</span>
        <span>✓ {activePeopleCount} aktive MA</span>
      </div>
    </section>
  );
}

export interface ExportStepProps {
  exported: boolean;
  hasRows: boolean;
  busy: boolean;
  onSave: () => void;
  onExport: () => void;
  xlsxSheet: string;
  onBackToStep3: () => void;
}

export function ExportStep({
  exported,
  hasRows,
  busy,
  onSave,
  onExport,
  xlsxSheet,
  onBackToStep3,
}: ExportStepProps) {
  return (
    <section className="panel wizard-stage">
      <div className="wizard-stage-head">
        <span className="wizard-stage-number">{exported ? "✓" : "04"}</span>
        <div>
          <h2>Dienstplan abschließen</h2>
          <p>Den geprüften Plan im Archiv sichern und im Originaldesign als Excel-Datei ausgeben.</p>
        </div>
      </div>
      {hasRows ? (
        <div className="export-choice-grid">
          <div className="export-choice">
            <span className="export-choice-icon">A</span>
            <div>
              <small>Interne Sicherung</small>
              <strong>Änderungen speichern</strong>
              <p>Der aktuelle Stand bleibt im Dashboard und in den Auswertungen verfügbar.</p>
            </div>
            <button className="btn" disabled={busy} onClick={onSave}>Speichern</button>
          </div>
          <div className={`export-choice is-primary ${exported ? "is-complete" : ""}`}>
            <span className="export-choice-icon">{exported ? "✓" : "X"}</span>
            <div>
              <small>{exported ? "Erfolgreich erstellt" : "Originalvorlage"}</small>
              <strong>Excel-Dienstplan herunterladen</strong>
              <p>Farben, Zeilen und verbundene Felder entsprechen der gewählten A-/B-Vorlage.</p>
            </div>
            <button className="btn btn-primary" disabled={busy || !xlsxSheet} onClick={onExport}>
              {exported ? "Erneut herunterladen" : "Excel erstellen"}
            </button>
          </div>
        </div>
      ) : (
        <div className="preparation-card">
          <span className="preparation-icon">!</span>
          <div className="preparation-copy">
            <small>Noch kein Dienstplan</small>
            <strong>Zuerst den Wochenplan erstellen</strong>
            <span>Nach der Erstellung erscheint hier der Excel-Export.</span>
          </div>
          <button className="btn btn-primary" onClick={onBackToStep3}>Zur Dienstplanung</button>
        </div>
      )}
      <div className="wizard-actions">
        <button className="btn" onClick={onBackToStep3}>Plan nochmals prüfen</button>
        {exported && <span className="wizard-complete-note">✓ Workflow abgeschlossen</span>}
      </div>
    </section>
  );
}
