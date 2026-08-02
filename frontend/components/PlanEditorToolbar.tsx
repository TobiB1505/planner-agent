"use client";

import PlanValidationSummary, { type ValidationStatus } from "@/components/PlanValidationSummary";
import type { PlanValidationSummary as ValidationSummaryData } from "@/lib/planValidation";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface PlanToolbarTool {
  label: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
}

export default function PlanEditorToolbar({
  weekLabel,
  rowCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  saveState,
  isDirty,
  changeCount,
  lastSavedAt,
  saveError,
  onSave,
  saveLabel = "Änderungen speichern",
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
  weekLabel: string;
  rowCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  saveState: SaveState;
  isDirty: boolean;
  changeCount: number;
  lastSavedAt: Date | null;
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

  const statusText = (() => {
    if (saveState === "saving") return "Änderungen werden gespeichert …";
    if (saveState === "error") return "Speichern fehlgeschlagen";
    if (isDirty) return `● ${changeCount} ungespeicherte ${changeCount === 1 ? "Änderung" : "Änderungen"}`;
    if (lastSavedAt) {
      const time = lastSavedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      return `✓ Alle Änderungen gespeichert · ${time} Uhr`;
    }
    return "Keine ungespeicherten Änderungen";
  })();

  const statusTone = saveState === "error" ? "is-error" : isDirty ? "is-dirty" : "is-clean";
  const shortStatusText = (() => {
    if (saveState === "saving") return "Speichert …";
    if (saveState === "error") return "Speicherfehler";
    if (isDirty) return `${changeCount} ungespeichert`;
    if (lastSavedAt) {
      return `Gespeichert · ${lastSavedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
    }
    return "Gespeichert";
  })();

  return (
    <div className="plan-editor-toolbar" role="toolbar" aria-label="Dienstplan-Werkzeuge">
      <div className="plan-editor-toolbar-primary">
        <div className="plan-editor-toolbar-context">
          <div className="plan-editor-toolbar-identity">
            <span className="plan-editor-toolbar-week">{weekLabel}</span>
            <span className="plan-editor-toolbar-count">{rowCount} Planzeilen</span>
          </div>
          <span className={`plan-editor-save-status ${statusTone}`} role="status">
            <span className="plan-editor-save-status-long">{statusText}</span>
            <span className="plan-editor-save-status-short">{shortStatusText}</span>
          </span>
          {saveState === "error" && saveError && (
            <span className="plan-editor-save-error">{saveError}</span>
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
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !isDirty}
            title={!isDirty ? "Alle Änderungen sind bereits gespeichert" : undefined}
            onClick={onSave}
          >
            {saveState === "saving" && <span className="spinner" />}
            <span className="plan-toolbar-label-long">{saveLabel}</span>
            <span className="plan-toolbar-label-short">Speichern</span>
          </button>
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
