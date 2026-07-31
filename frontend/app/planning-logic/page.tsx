"use client";

import PageHeader from "@/components/PageHeader";
import PlanningRulesPanel from "@/components/PlanningRulesPanel";
import { getPlanningRules, type PlanningRule } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";

export default function PlanningLogicPage() {
  const [rules, setRules] = useState<PlanningRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getPlanningRules()
      .then((result) => {
        if (active) setRules(result);
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Planungslogik konnte nicht geladen werden.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => ({
    warning: rules.filter((rule) => rule.tone === "warning").length,
    info: rules.filter((rule) => rule.tone === "info").length,
  }), [rules]);

  return (
    <div className="planning-logic-page">
      <PageHeader
        title="Planungslogik"
        subtitle="Alle Regeln, die bei automatischer Verteilung und Empfehlungen mitdenken"
      />

      <section className="planning-logic-overview" aria-label="Übersicht Planungslogik">
        <article>
          <span>Aktiv</span>
          <strong>{loading ? "…" : rules.length}</strong>
          <small>Regeln insgesamt</small>
        </article>
        <article className="tone-info">
          <span>Grundlogik</span>
          <strong>{loading ? "…" : counts.info}</strong>
          <small>Fairness, Abteilungen und Zeitfenster</small>
        </article>
        <article className="tone-warning">
          <span>Zu beachten</span>
          <strong>{loading ? "…" : counts.warning}</strong>
          <small>Besondere Einschränkungen</small>
        </article>
      </section>

      {loading ? (
        <section className="panel planning-logic-loading" role="status">
          Planungsregeln werden geladen …
        </section>
      ) : error ? (
        <section className="panel planning-logic-error" role="alert">{error}</section>
      ) : (
        <PlanningRulesPanel rules={rules} defaultOpen />
      )}
    </div>
  );
}
