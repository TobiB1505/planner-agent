"use client";

import PlanValidationSummary, { type ValidationStatus } from "@/components/PlanValidationSummary";
import Button from "@/components/ui/Button";
import type { PlanValidationSummary as ValidationSummaryData } from "@/lib/planValidation";
import { formatSaveStatus, type SaveState } from "@/lib/plan-editor/saveStatus";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type { SaveState };

export interface PlanToolbarTool {
  label: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Editor-Toolbar (Sprint 3 restrukturiert). Zwei Gruppen-Zeilen:
 *
 *   Zeile 1 - Status & Bearbeitung: Speicherstatus, Undo/Redo,
 *             Speichern (einzige Primäraktion, mit sichtbarem Label),
 *             Planqualität- und Konflikt-Status als ruhige Chips.
 *   Zeile 2 - Ansicht & Sekundäres: Woche/Tag-Umschalter, Dichte,
 *             "Plan optimieren"-Menü, Excel-Export.
 *
 * Wochenlabel und Zeilenanzahl wurden entfernt - beides steht bereits im
 * Seitenkopf (PlanEditorSummary bzw. Wochen-Kontextkarte) und hatte hier
 * keinen operativen Nutzen (siehe EDITOR_VISUAL_BASELINE.md, Frage 2).
 */
export default function PlanEditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  saveState,
  isDirty,
  saveError,
  onSave,
  saveLabel = "Speichern",
  onExport,
  exportDisabled,
  exportLabel = "Excel exportieren",
  busy,
  tools,
  validationSummary,
  validationStatus,
  onOpenValidation,
  qualityScore,
  qualityStatus,
  qualityLoading = false,
  onOpenIntelligence,
  viewControls,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  saveState: SaveState;
  isDirty: boolean;
  saveError: string;
  onSave: () => void;
  saveLabel?: string;
  onExport: () => void;
  exportDisabled?: boolean;
  exportLabel?: string;
  busy: boolean;
  tools: PlanToolbarTool[];
  validationSummary: ValidationSummaryData;
  validationStatus: ValidationStatus;
  onOpenValidation: () => void;
  qualityScore?: number;
  qualityStatus?: "good" | "warning" | "critical";
  qualityLoading?: boolean;
  onOpenIntelligence?: () => void;
  viewControls: ReactNode;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolsOpen) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setToolsOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolsOpen]);

  const { text: statusText, tone: statusTone } = formatSaveStatus({ saveState, isDirty });

  return (
    <div className="plan-editor-toolbar" role="toolbar" aria-label="Dienstplan-Werkzeuge">
      <div className="plan-editor-toolbar-primary">
        <div className="plan-editor-toolbar-context">
          <span className={`plan-editor-save-status ${statusTone}`} role="status">
            <span aria-hidden="true" />
            {statusText}
          </span>
          {saveState === "error" && saveError && (
            <span className="plan-editor-save-error" role="alert">{saveError}</span>
          )}
        </div>

        <div className="plan-editor-toolbar-actions">
          <div className="plan-editor-toolbar-undo">
            <button
              type="button"
              className="btn-icon"
              onClick={onUndo}
              disabled={!canUndo}
              title="Rückgängig (Strg/Cmd+Z)"
              aria-label="Rückgängig"
            >
              ↶
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={onRedo}
              disabled={!canRedo}
              title="Wiederholen (Strg/Cmd+Umschalt+Z)"
              aria-label="Wiederholen"
            >
              ↷
            </button>
          </div>
          <Button
            variant="primary"
            className="plan-save-button"
            loading={saveState === "saving"}
            disabled={busy || !isDirty}
            title={isDirty ? `${saveLabel} (Strg/Cmd+S)` : "Alle Änderungen sind bereits gespeichert"}
            onClick={onSave}
          >
            {saveLabel}
          </Button>
          {onOpenIntelligence && (
            <button
              type="button"
              className={`plan-quality-toolbar is-${qualityStatus ?? "loading"}`}
              onClick={onOpenIntelligence}
              aria-label="Planqualität und Begründungen öffnen"
            >
              <span>Planqualität</span>
              <strong>{qualityLoading || qualityScore === undefined ? "…" : `${qualityScore}/100`}</strong>
            </button>
          )}
          <PlanValidationSummary
            summary={validationSummary}
            status={validationStatus}
            onOpen={onOpenValidation}
            compact
          />
        </div>
      </div>

      <div className="plan-editor-toolbar-view">
        {viewControls}
        <div className="plan-editor-toolbar-secondary-actions">
          {tools.length > 0 && (
            <div ref={toolsRef} className="plan-editor-tools-menu">
              <button
                type="button"
                className="btn"
                aria-haspopup="menu"
                aria-expanded={toolsOpen}
                onClick={() => setToolsOpen((current) => !current)}
              >
                <span className="plan-toolbar-label-long">Plan optimieren</span>
                <span className="plan-toolbar-label-short">Optimieren</span>
                <span aria-hidden="true">▾</span>
              </button>
              {toolsOpen && (
                <div role="menu" aria-label="Plan optimieren">
                  {tools.map((tool) => (
                    <button
                      key={tool.label}
                      type="button"
                      role="menuitem"
                      disabled={tool.disabled}
                      title={tool.description}
                      onClick={() => {
                        setToolsOpen(false);
                        tool.onClick();
                      }}
                    >
                      <strong>{tool.label}</strong>
                      {tool.description && <span>{tool.description}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn btn-excel-export"
            disabled={busy || exportDisabled}
            onClick={onExport}
          >
            <svg className="btn-excel-export-icon" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M7 2.5h9.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7" />
              <path d="M11 6h6.5M11 10h6.5M11 14h6.5M13.5 6v8" />
              <rect x="2.5" y="5" width="9" height="10" rx="1.5" />
              <path className="btn-excel-export-x" d="m5 8 4 4m0-4-4 4" />
            </svg>
            <span className="plan-toolbar-label-long">{exportLabel}</span>
            <span className="plan-toolbar-label-short">Excel</span>
          </button>
        </div>
      </div>
    </div>
  );
}
