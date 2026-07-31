"use client";

import type { PlanningRule } from "@/lib/api";
import { useMemo, useState } from "react";

type RuleFilter = "all" | "info" | "warning";

export default function PlanningRulesPanel({
  rules,
  defaultOpen = false,
}: {
  rules: PlanningRule[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [filter, setFilter] = useState<RuleFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => ({
    all: rules.length,
    warning: rules.filter((rule) => rule.tone === "warning").length,
    info: rules.filter((rule) => rule.tone === "info").length,
  }), [rules]);

  const visibleRules = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de");
    return rules.filter((rule) => {
      if (filter !== "all" && rule.tone !== filter) return false;
      if (!needle) return true;
      return `${rule.title} ${rule.description}`.toLocaleLowerCase("de").includes(needle);
    });
  }, [filter, query, rules]);

  const filters: Array<{ value: RuleFilter; label: string }> = [
    { value: "all", label: "Alle" },
    { value: "warning", label: "Zu beachten" },
    { value: "info", label: "Grundlogik" },
  ];

  return (
    <section className={`panel dashboard-rules-panel ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="dashboard-rules-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="planning-rules-content"
      >
        <span className="dashboard-rules-mark" aria-hidden="true">⌁</span>
        <span className="dashboard-rules-heading">
          <small>Aktive Planungslogik</small>
          <strong>Regeln, die bei Vorschlägen mitdenken</strong>
          <span>Verfügbarkeit, Fairness und Entlastung werden automatisch berücksichtigt.</span>
        </span>
        <span className="dashboard-rules-summary" aria-label={`${rules.length} Regeln aktiv`}>
          {counts.warning > 0 && (
            <span className="tone-warning"><i aria-hidden="true">!</i>{counts.warning}</span>
          )}
          {counts.info > 0 && (
            <span className="tone-info"><i aria-hidden="true">i</i>{counts.info}</span>
          )}
        </span>
        <span className="dashboard-rules-count">{rules.length} aktiv</span>
        <span className="dashboard-rules-chevron" aria-hidden="true" />
      </button>

      <div id="planning-rules-content" hidden={!open}>
        {rules.length ? (
          <>
            <div className="dashboard-rules-tools">
              <div className="dashboard-rule-filters" role="group" aria-label="Planungsregeln filtern">
                {filters.map((item) => (
                  <button
                    type="button"
                    key={item.value}
                    className={filter === item.value ? "is-active" : ""}
                    onClick={() => setFilter(item.value)}
                    aria-pressed={filter === item.value}
                  >
                    {item.label}
                    <span>{counts[item.value]}</span>
                  </button>
                ))}
              </div>
              <label className="dashboard-rule-search">
                <span className="dashboard-visually-hidden">Planungsregeln durchsuchen</span>
                <span aria-hidden="true">⌕</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Regel suchen"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Regelsuche leeren"
                  >
                    ×
                  </button>
                )}
              </label>
            </div>

            <div className="dashboard-rule-list">
              {visibleRules.map((rule) => (
                <details key={rule.id} className={`dashboard-rule-row tone-${rule.tone}`}>
                  <summary>
                    <span className="dashboard-rule-tone" aria-hidden="true">
                      {rule.tone === "warning" ? "!" : "i"}
                    </span>
                    <span className="dashboard-rule-title">
                      <strong>{rule.title}</strong>
                      <small>{ruleToneLabel(rule.tone)}</small>
                    </span>
                    <span className="dashboard-rule-row-chevron" aria-hidden="true" />
                  </summary>
                  <p>{rule.description}</p>
                </details>
              ))}
              {!visibleRules.length && (
                <div className="dashboard-rule-no-results">
                  <span aria-hidden="true">⌕</span>
                  <p>Keine Regel passt zu diesem Filter.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setFilter("all");
                      setQuery("");
                    }}
                  >
                    Filter zurücksetzen
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="dashboard-empty">
            <span aria-hidden="true">–</span>
            <p>Noch keine Planungsregeln vorhanden.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ruleToneLabel(tone: PlanningRule["tone"]): string {
  if (tone === "warning") return "Zu beachten";
  return "Grundlogik";
}
