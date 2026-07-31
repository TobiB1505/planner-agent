"use client";

import type { CustomCellEditorProps } from "ag-grid-react";
import { useEffect, useMemo, useRef, useState } from "react";

type EditorProps = CustomCellEditorProps<Record<string, string | null>, string> & {
  people?: string[];
  recommendedPeople?: string[];
  blockedPeople?: string[];
  nearbyPeople?: string[];
  ruleHint?: string;
};

const SOFTSPORT_OPTIONS = [
  "Boccia",
  "Darts",
  "Freegolf",
  "Mölkky",
  "Wikinger-Schach",
  "TT/Kicker",
  "JeKaMi",
];

function parseValue(value: string): { activity: string; names: string[] } {
  if (!value.includes("|")) {
    const clean = value.trim();
    return SOFTSPORT_OPTIONS.includes(clean)
      ? { activity: clean, names: [] }
      : { activity: "", names: clean ? [clean] : [] };
  }
  const separator = value.indexOf("|");
  const activity = value.slice(0, separator).trim();
  const names = value
    .slice(separator + 1)
    .split(/[,;\n]+/)
    .map((name) => name.trim())
    .filter(Boolean);
  return { activity, names: [...new Set(names)] };
}

function composeValue(activity: string, names: string[]): string {
  if (!activity && !names.length) return "";
  if (!activity) return names.join(", ");
  if (!names.length) return activity;
  return `${activity} | ${names.join(", ")}`;
}

function recommendationLabel(rank?: number): string {
  if (rank === 1) return "Beste Wahl";
  if (rank === 2) return "Sehr gut";
  if (rank === 3) return "Gut";
  if (rank === 4) return "Passend";
  if (rank === 5) return "Alternative";
  return "Hinzufügen";
}

export default function SoftsportCellEditor({
  value,
  onValueChange,
  stopEditing,
  people = [],
  recommendedPeople = [],
  blockedPeople = [],
  nearbyPeople = [],
  ruleHint,
}: EditorProps) {
  const initial = useMemo(() => parseValue(value ?? ""), [value]);
  const [activity, setActivity] = useState(initial.activity);
  const [names, setNames] = useState(initial.names);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const closeWhenValueIs = useRef<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("de");
  const activities = useMemo(
    () =>
      initial.activity && !SOFTSPORT_OPTIONS.includes(initial.activity)
        ? [initial.activity, ...SOFTSPORT_OPTIONS]
        : SOFTSPORT_OPTIONS,
    [initial.activity],
  );
  const selectedLower = useMemo(
    () => new Set(names.map((name) => name.toLocaleLowerCase("de"))),
    [names],
  );
  const blockedLower = useMemo(
    () => new Set(blockedPeople.map((name) => name.toLocaleLowerCase("de"))),
    [blockedPeople],
  );
  const nearbyLower = useMemo(
    () => new Set(nearbyPeople.map((name) => name.toLocaleLowerCase("de"))),
    [nearbyPeople],
  );
  const recommendedRank = useMemo(
    () =>
      new Map(
        recommendedPeople.map((name, index) => [
          name.toLocaleLowerCase("de"),
          index + 1,
        ]),
      ),
    [recommendedPeople],
  );
  const suggestions = useMemo(
    () =>
      people
        .filter((name) => !blockedLower.has(name.toLocaleLowerCase("de")))
        .filter((name) => !selectedLower.has(name.toLocaleLowerCase("de")))
        .filter(
          (name) =>
            !normalizedQuery ||
            name.toLocaleLowerCase("de").includes(normalizedQuery),
        )
        .sort((a, b) => {
          const rankA = recommendedRank.get(a.toLocaleLowerCase("de")) ?? 999;
          const rankB = recommendedRank.get(b.toLocaleLowerCase("de")) ?? 999;
          return rankA - rankB || a.localeCompare(b, "de");
        })
        .slice(0, 7),
    [blockedLower, normalizedQuery, people, recommendedRank, selectedLower],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (
      closeWhenValueIs.current === null ||
      (value ?? "") !== closeWhenValueIs.current
    ) {
      return;
    }
    closeWhenValueIs.current = null;
    window.setTimeout(() => stopEditing(), 20);
  }, [stopEditing, value]);

  function commit(nextActivity: string, nextNames: string[]) {
    setActivity(nextActivity);
    setNames(nextNames);
    onValueChange(composeValue(nextActivity, nextNames));
  }

  function addName(name: string, closeAfter = false) {
    const clean = name.trim();
    if (!clean) return;
    const canonical =
      people.find(
        (person) =>
          person.toLocaleLowerCase("de") === clean.toLocaleLowerCase("de"),
      ) ?? clean;
    if (blockedLower.has(canonical.toLocaleLowerCase("de"))) {
      setError(ruleHint || `${canonical} ist für diesen Dienst nicht zulässig.`);
      return;
    }
    const exists = names.some(
      (selected) =>
        selected.toLocaleLowerCase("de") === canonical.toLocaleLowerCase("de"),
    );
    const nextNames = exists ? names : [...names, canonical];
    const nextValue = composeValue(activity, nextNames);
    if (closeAfter) closeWhenValueIs.current = nextValue;
    setError("");
    commit(activity, nextNames);
    setQuery("");
    setActive(0);
    if (!closeAfter) queueMicrotask(() => inputRef.current?.focus());
  }

  function removeName(name: string) {
    commit(activity, names.filter((selected) => selected !== name));
    queueMicrotask(() => inputRef.current?.focus());
  }

  return (
    <div className="person-editor softsport-person-editor">
      <div className="person-editor-title">Softsport zuweisen</div>
      <label className="softsport-activity-field">
        <span>Softsport-Art</span>
        <select
          value={activity}
          onChange={(event) => commit(event.target.value, names)}
        >
          <option value="">Art auswählen …</option>
          {activities.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>

      {names.length > 0 && (
        <div className="person-chips">
          {names.map((name) => (
            <button
              type="button"
              className="person-chip"
              key={name}
              title={`${name} entfernen`}
              onClick={() => removeName(name)}
            >
              {name}<span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setActive(0);
          setError("");
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, suggestions.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (!query.trim()) {
              stopEditing();
              return;
            }
            const exact = people.find(
              (name) => name.toLocaleLowerCase("de") === normalizedQuery,
            );
            addName(
              exact ?? suggestions[active] ?? query.trim(),
              Boolean(activity),
            );
            if (!activity) {
              setError("Bitte oben zuerst die Softsport-Art auswählen.");
            }
          } else if (event.key === "Backspace" && !query && names.length) {
            removeName(names[names.length - 1]);
          }
        }}
        placeholder="Namen tippen und Enter …"
      />

      {suggestions.length > 0 && (
        <div className="person-suggestions">
          {suggestions.map((name, index) => {
            const rank = recommendedRank.get(name.toLocaleLowerCase("de"));
            const hasNearbyRehearsal = nearbyLower.has(
              name.toLocaleLowerCase("de"),
            );
            return (
              <button
                type="button"
                key={name}
                className={`person-suggestion ${rank ? `rank-${rank}` : ""} ${hasNearbyRehearsal ? "has-rehearsal-nearby" : ""} ${index === active ? "is-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addName(name)}
              >
                <span className="person-suggestion-name">
                  {rank && <span className="recommendation-dot" aria-hidden="true" />}
                  {name}
                </span>
                <span className="person-suggestion-add">
                  {hasNearbyRehearsal ? (
                    <span className="rehearsal-nearby-badge">
                      <span aria-hidden="true">◷</span>
                      Probe nah
                    </span>
                  ) : recommendationLabel(rank)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {error && <div className="person-rule-error">{error}</div>}
      <div className="person-editor-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            closeWhenValueIs.current = "";
            commit("", []);
          }}
        >
          Leeren
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!activity || names.length === 0}
          onClick={() => stopEditing()}
        >
          Übernehmen
        </button>
      </div>
    </div>
  );
}
