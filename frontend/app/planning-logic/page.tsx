"use client";

import PageHeader from "@/components/ui/PageHeader";
import Button from "@/components/ui/Button";
import MetricCard from "@/components/ui/MetricCard";
import InlineStatus from "@/components/ui/InlineStatus";
import PlanningRulesPanel from "@/components/PlanningRulesPanel";
import { getPlanningRules, type PlanningRule } from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function PlanningLogicPage() {
  const [rules, setRules] = useState<PlanningRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRules(await getPlanningRules());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Planungslogik konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

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

      <section className="planning-logic-metrics" aria-label="Übersicht Planungslogik">
        <MetricCard title="Aktiv" value={loading ? "…" : String(rules.length)} change={{ label: "Regeln insgesamt", tone: "neutral" }} />
        <MetricCard
          title="Grundlogik"
          value={loading ? "…" : String(counts.info)}
          change={{ label: "Fairness, Abteilungen und Zeitfenster", tone: "neutral" }}
        />
        <MetricCard
          title="Zu beachten"
          value={loading ? "…" : String(counts.warning)}
          status={counts.warning > 0 ? { label: "Prüfen", tone: "warning" } : undefined}
          change={{ label: "Besondere Einschränkungen", tone: "neutral" }}
        />
      </section>

      {loading ? (
        <InlineStatus variant="loading" className="mt-3">Planungsregeln werden geladen …</InlineStatus>
      ) : error ? (
        <div className="planning-logic-error-row">
          <InlineStatus variant="danger">{error}</InlineStatus>
          <Button variant="secondary" onClick={() => void load()}>
            Erneut versuchen
          </Button>
        </div>
      ) : (
        <PlanningRulesPanel rules={rules} defaultOpen />
      )}
    </div>
  );
}
