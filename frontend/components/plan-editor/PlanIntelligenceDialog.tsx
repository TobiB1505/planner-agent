"use client";

import { getPlanAudit, type PlanAuditEvent, type PlanQualityResult } from "@/lib/api";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type IntelligenceTab = "quality" | "why" | "audit";

const CAUSE_LABELS: Record<string, string> = {
  manual_edit: "Manuelle Änderung",
  recommendation: "Empfehlung übernommen",
  automation: "Automatische Vorschau übernommen",
  undo: "Rückgängig",
  redo: "Wiederholt",
  manual_save: "Plan gespeichert",
};

export default function PlanIntelligenceDialog({
  open,
  quality,
  weekPlanId,
  startDate,
  onClose,
}: {
  open: boolean;
  quality: PlanQualityResult | null;
  weekPlanId?: number;
  startDate: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<IntelligenceTab>("quality");
  const [audit, setAudit] = useState<PlanAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    if (!open || tab !== "audit") return;
    getPlanAudit({ weekPlanId, startDate, limit: 150 })
      .then(setAudit)
      .catch(() => setAudit([]))
      .finally(() => setAuditLoading(false));
  }, [open, tab, weekPlanId, startDate]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="intelligence-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="plan-intelligence-dialog" role="dialog" aria-modal="true" aria-label="Plan Intelligence">
        <header className="plan-intelligence-head">
          <div>
            <span className="intelligence-eyebrow">Planner Intelligence</span>
            <h2>Planqualität &amp; Entscheidungen</h2>
            <p>Jede Bewertung stammt aus Plan, Regeln und dokumentierter Historie.</p>
          </div>
          <button type="button" className="btn-icon" aria-label="Schließen" onClick={onClose}>×</button>
        </header>
        <nav className="plan-intelligence-tabs" aria-label="Analysebereiche">
          <button type="button" className={tab === "quality" ? "is-active" : ""} onClick={() => setTab("quality")}>Planqualität</button>
          <button type="button" className={tab === "why" ? "is-active" : ""} onClick={() => setTab("why")}>Warum dieser Plan?</button>
          <button type="button" className={tab === "audit" ? "is-active" : ""} onClick={() => { setAuditLoading(true); setTab("audit"); }}>Änderungsverlauf</button>
        </nav>
        <div className="plan-intelligence-body">
          {!quality && tab !== "audit" && <div className="intelligence-empty"><span className="spinner" /> Plan wird bewertet …</div>}

          {quality && tab === "quality" && (
            <>
              <div className={`plan-quality-hero is-${quality.status}`}>
                <div className="plan-quality-ring" style={{ "--quality": `${quality.score * 3.6}deg` } as React.CSSProperties}>
                  <strong>{quality.score}</strong><span>/ 100</span>
                </div>
                <div><span>Planqualität</span><h3>{quality.status === "good" ? "Gute Planbasis" : quality.status === "warning" ? "Plan sollte geprüft werden" : "Wichtige Konflikte vorhanden"}</h3><p>{quality.issues.length ? `${quality.issues.length} konkrete Hinweise in der Bewertung.` : "Keine harten Konflikte erkannt."}</p></div>
              </div>
              <div className="quality-dimensions">
                {quality.dimensions.map((dimension) => (
                  <article key={dimension.key} className={`quality-dimension is-${dimension.status}`}>
                    <header><strong>{dimension.label}</strong><span>{dimension.score} / {dimension.max_score}</span></header>
                    <div><i style={{ width: `${(dimension.score / dimension.max_score) * 100}%` }} /></div>
                    {dimension.explanations.map((text) => <p key={text}>{text}</p>)}
                    {dimension.neutral && <small>Neutral bewertet – keine Daten erfunden</small>}
                  </article>
                ))}
              </div>
              {quality.issues.length > 0 && <section className="quality-issues"><h3>Konkrete Prüfpunkte</h3>{quality.issues.slice(0, 12).map((issue, index) => <p key={`${issue.code}-${index}`}><span>!</span>{issue.message}</p>)}</section>}
            </>
          )}

          {quality && tab === "why" && (
            <>
              <section className="intelligence-section">
                <h3>Optimierungsziele</h3>
                <div className="optimization-goals">{quality.analysis.optimization_goals.map((goal) => <article key={goal.key}><strong>{goal.weight}%</strong><span>{goal.label}</span></article>)}</div>
              </section>
              <section className="intelligence-section">
                <h3>Nachvollziehbare Entscheidungen</h3>
                <div className="decision-list">{quality.analysis.decisions.slice(0, 20).map((decision, index) => <article key={`${decision.employee}-${decision.date}-${decision.category}-${index}`}><header><strong>{decision.employee}</strong><span>{decision.category}{decision.subcategory ? ` · ${decision.subcategory}` : ""}</span></header>{decision.reasons.map((reason) => <p key={reason}>✓ {reason}</p>)}</article>)}</div>
                {!quality.analysis.decisions.length && <p className="intelligence-empty">Noch keine ausreichend belegte Einzelentscheidung.</p>}
              </section>
              <footer className="intelligence-data-basis">Datenbasis: {quality.analysis.data_basis.assignments} Zuweisungen · {quality.analysis.data_basis.active_people} aktive MA · {quality.analysis.data_basis.historical_weeks} historische Wochen</footer>
            </>
          )}

          {tab === "audit" && (
            <section className="intelligence-section">
              <h3>Änderungsverlauf</h3>
              {auditLoading && <div className="intelligence-empty"><span className="spinner" /> Verlauf wird geladen …</div>}
              {!auditLoading && audit.map((event) => (
                <article className="audit-event" key={event.id}>
                  <time>{new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(`${event.created_at.replace(" ", "T")}Z`))}</time>
                  <div><strong>{CAUSE_LABELS[event.cause] ?? event.cause}</strong>{event.cell_key && <span>{event.cell_key}</span>}{event.previous_value !== undefined && event.previous_value !== event.new_value && <p><del>{event.previous_value || "leer"}</del><span aria-hidden="true">→</span><ins>{event.new_value || "leer"}</ins></p>}</div>
                </article>
              ))}
              {!auditLoading && !audit.length && <p className="intelligence-empty">Noch keine gespeicherten Änderungen für diese Woche.</p>}
            </section>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
