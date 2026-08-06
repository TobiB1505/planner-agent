// AP12 (Schritt 7): alle "schwebenden" Dialoge/Panels des Plan-Editors
// gebündelt - reduziert das JSX in page.tsx, ohne die Dialoglogik selbst
// neu zu schreiben (jede Aktion bleibt exakt dieselbe Callback-Kette wie
// vorher, nur als Props statt geschlossener Funktionen).
import ConfirmDialog from "@/components/ConfirmDialog";
import PlanIssuesPanel from "@/components/PlanIssuesPanel";
import PlanIntelligenceDialog from "@/components/plan-editor/PlanIntelligenceDialog";
import PlanPreviewDialog from "@/components/plan-editor/PlanPreviewDialog";
import type { PlanIssue, PlanValidationSummary } from "@/lib/planValidation";
import type { PlanQualityResult } from "@/lib/api";
import type { AutomationPreview, PendingAction } from "../types";

export interface EditorDialogsProps {
  pendingAction: PendingAction | null;
  changeCount: number;
  onCloseConfirmDialog: () => void;
  onApplyWeekChange: (date: string) => void;
  onPerformSave: () => Promise<boolean>;
  onPerformExport: () => Promise<void>;
  validationSummary: PlanValidationSummary;
  onOpenIssuesPanel: () => void;

  automationPreview: AutomationPreview | null;
  busy: boolean;
  onApplyAutomationPreview: () => void;
  onDismissAutomationPreview: () => void;

  issuesPanelOpen: boolean;
  validationIssues: PlanIssue[];
  validationFailed: boolean;
  onCloseIssuesPanel: () => void;
  onNavigateToIssue: (issue: PlanIssue) => void;
  onEditIssue: (issue: PlanIssue) => void;
  onRefreshValidation: () => void;

  intelligenceOpen: boolean;
  planQuality: PlanQualityResult | null;
  weekPlanId?: number;
  startDate: string;
  onCloseIntelligence: () => void;
}

export default function EditorDialogs({
  pendingAction,
  changeCount,
  onCloseConfirmDialog,
  onApplyWeekChange,
  onPerformSave,
  onPerformExport,
  validationSummary,
  onOpenIssuesPanel,
  automationPreview,
  busy,
  onApplyAutomationPreview,
  onDismissAutomationPreview,
  issuesPanelOpen,
  validationIssues,
  validationFailed,
  onCloseIssuesPanel,
  onNavigateToIssue,
  onEditIssue,
  onRefreshValidation,
  intelligenceOpen,
  planQuality,
  weekPlanId,
  startDate,
  onCloseIntelligence,
}: EditorDialogsProps) {
  return (
    <>
      {pendingAction?.kind === "week-change" && (
        <ConfirmDialog
          open
          title="Ungespeicherte Änderungen"
          description={
            <p>
              Für die aktuelle Woche gibt es {changeCount} ungespeicherte {changeCount === 1 ? "Änderung" : "Änderungen"}.
              Wenn du fortfährst, gehen diese verloren, sofern du sie nicht vorher speicherst.
            </p>
          }
          actions={[
            { label: "Abbrechen", onClick: onCloseConfirmDialog, variant: "default" },
            {
              label: "Änderungen verwerfen",
              variant: "danger",
              onClick: () => {
                const next = pendingAction.nextDate;
                onCloseConfirmDialog();
                onApplyWeekChange(next);
              },
            },
            {
              label: "Änderungen speichern",
              variant: "primary",
              autoFocus: true,
              onClick: async () => {
                const next = pendingAction.nextDate;
                onCloseConfirmDialog();
                const ok = await onPerformSave();
                if (ok) onApplyWeekChange(next);
              },
            },
          ]}
          onDismiss={onCloseConfirmDialog}
        />
      )}

      {pendingAction?.kind === "save-with-conflicts" && (
        <ConfirmDialog
          open
          title="Dienstplan mit Konflikten speichern?"
          description={
            <>
              <p>Der Plan enthält:</p>
              <ul>
                {validationSummary.errors > 0 && (
                  <li>
                    {validationSummary.errors} {validationSummary.errors === 1 ? "kritischen Konflikt" : "kritische Konflikte"}
                  </li>
                )}
                {validationSummary.understaffed > 0 && (
                  <li>
                    {validationSummary.understaffed} {validationSummary.understaffed === 1 ? "unbesetzten Pflichtdienst" : "unbesetzte Pflichtdienste"}
                  </li>
                )}
              </ul>
              <p>Der Plan kann trotzdem gespeichert werden.</p>
            </>
          }
          actions={[
            { label: "Abbrechen", onClick: onCloseConfirmDialog, variant: "default" },
            {
              label: "Planprüfung öffnen",
              variant: "default",
              onClick: () => { onCloseConfirmDialog(); onOpenIssuesPanel(); },
            },
            {
              label: "Trotzdem speichern",
              variant: "primary",
              autoFocus: true,
              onClick: () => { onCloseConfirmDialog(); void onPerformSave(); },
            },
          ]}
          onDismiss={onCloseConfirmDialog}
        />
      )}

      {pendingAction?.kind === "export-with-conflicts" && (
        <ConfirmDialog
          open
          title="Dienstplan mit Konflikten exportieren?"
          description={
            <p>
              Der Export enthält {validationSummary.errors}{" "}
              {validationSummary.errors === 1 ? "kritischen Konflikt" : "kritische Konflikte"}.
            </p>
          }
          actions={[
            { label: "Abbrechen", onClick: onCloseConfirmDialog, variant: "default" },
            {
              label: "Planprüfung öffnen",
              variant: "default",
              onClick: () => { onCloseConfirmDialog(); onOpenIssuesPanel(); },
            },
            {
              label: "Trotzdem exportieren",
              variant: "primary",
              autoFocus: true,
              onClick: () => { onCloseConfirmDialog(); void onPerformExport(); },
            },
          ]}
          onDismiss={onCloseConfirmDialog}
        />
      )}

      {automationPreview && (
        <PlanPreviewDialog
          open
          title={automationPreview.title}
          description={automationPreview.description}
          diff={automationPreview.diff}
          busy={busy}
          applyLabel={automationPreview.applyLabel}
          onApply={onApplyAutomationPreview}
          onDismiss={onDismissAutomationPreview}
        />
      )}

      <PlanIssuesPanel
        open={issuesPanelOpen}
        issues={validationIssues}
        summary={validationSummary}
        failed={validationFailed}
        onClose={onCloseIssuesPanel}
        onNavigate={(issue) => onNavigateToIssue(issue)}
        onEdit={(issue) => onEditIssue(issue)}
        onRefresh={onRefreshValidation}
      />
      <PlanIntelligenceDialog
        open={intelligenceOpen}
        quality={planQuality}
        weekPlanId={weekPlanId}
        startDate={startDate}
        onClose={onCloseIntelligence}
      />
    </>
  );
}
