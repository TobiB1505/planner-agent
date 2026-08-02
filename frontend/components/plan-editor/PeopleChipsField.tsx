"use client";

import type { CandidateInfo } from "@/lib/recommendations";
import { useMemo, useRef, useState } from "react";

/**
 * Kompakte, inline-taugliche Variante der Personen-Zuweisung aus
 * PersonCellEditor/SoftsportCellEditor - dieselbe Chip-Logik (Personen als
 * Chips statt Kommaliste), aber ohne Popup-Rahmen/Dialog, damit sie innerhalb
 * einer Tagesplanung-Card sitzen kann.
 */
export default function PeopleChipsField({
  value,
  onChange,
  people,
  candidates = [],
  placeholder = "Mitarbeiter suchen …",
  ariaLabel = "Mitarbeiter",
  autoFocus,
  onSubmitRequest,
}: {
  value: string[];
  onChange: (names: string[]) => void;
  people: string[];
  candidates?: CandidateInfo[];
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** Leeres Enter im Suchfeld - Aufrufer entscheidet, ob das den ganzen Eintrag übernimmt. */
  onSubmitRequest?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("de");
  const selectedLower = useMemo(() => new Set(value.map((name) => name.toLocaleLowerCase("de"))), [value]);

  const candidateByName = useMemo(() => {
    const map = new Map<string, CandidateInfo>();
    for (const candidate of candidates) map.set(candidate.name.toLocaleLowerCase("de"), candidate);
    return map;
  }, [candidates]);

  const suggestions = useMemo(() => {
    const pool = candidates.length > 0 ? candidates.map((candidate) => candidate.name) : people;
    return pool
      .filter((name) => !selectedLower.has(name.toLocaleLowerCase("de")))
      .filter((name) => !normalizedQuery || name.toLocaleLowerCase("de").includes(normalizedQuery))
      .sort((a, b) => {
        const scoreA = candidateByName.get(a.toLocaleLowerCase("de"))?.score ?? 999;
        const scoreB = candidateByName.get(b.toLocaleLowerCase("de"))?.score ?? 999;
        return scoreA - scoreB || a.localeCompare(b, "de");
      })
      .slice(0, 12);
  }, [candidates, people, selectedLower, normalizedQuery, candidateByName]);

  const activeIndex = Math.min(active, Math.max(suggestions.length - 1, 0));

  function addName(name: string) {
    const clean = name.trim();
    if (!clean) return;
    const canonical = people.find((person) => person.toLocaleLowerCase("de") === clean.toLocaleLowerCase("de")) ?? clean;
    if (selectedLower.has(canonical.toLocaleLowerCase("de"))) {
      setQuery("");
      return;
    }
    onChange([...value, canonical]);
    setQuery("");
    setActive(0);
    setOpen(false);
    queueMicrotask(() => inputRef.current?.focus());
  }

  function removeName(name: string) {
    onChange(value.filter((selected) => selected !== name));
    queueMicrotask(() => inputRef.current?.focus());
  }

  return (
    <div className="people-chips-field">
      {value.length > 0 && (
        <div className="person-chips">
          {value.map((name) => {
            const candidate = candidateByName.get(name.toLocaleLowerCase("de"));
            const flagged = candidate?.status === "unavailable" || candidate?.status === "warning";
            return (
              <div key={name} className={`person-chip-wrap ${flagged ? "is-flagged" : ""}`}>
                <button
                  type="button"
                  className="person-chip"
                  title={`${name} entfernen`}
                  aria-label={`${name} entfernen`}
                  onClick={() => removeName(name)}
                >
                  {flagged && <span aria-hidden="true">⚠</span>}
                  {name}
                  <span aria-hidden="true">×</span>
                </button>
                {flagged && candidate?.reasons[0] && (
                  <span className="person-chip-warning">{candidate.reasons[0].text}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="people-chips-input-wrap">
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          aria-label={ariaLabel}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(index + 1, suggestions.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (!query.trim()) {
                onSubmitRequest?.();
                return;
              }
              const exact = people.find((name) => name.toLocaleLowerCase("de") === normalizedQuery);
              const selected = exact ?? suggestions[activeIndex] ?? query.trim();
              addName(selected);
            } else if (event.key === "Backspace" && !query && value.length > 0) {
              removeName(value[value.length - 1]);
            } else if (event.key === "Escape" && open) {
              event.stopPropagation();
              setOpen(false);
            }
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder}
        />
        {open && suggestions.length > 0 && (
          <ul className="people-chips-suggestions" role="listbox">
            {suggestions.map((name, index) => {
              const candidate = candidateByName.get(name.toLocaleLowerCase("de"));
              return (
                <li key={name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`${index === activeIndex ? "is-active" : ""} ${candidate ? `status-${candidate.status}` : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => addName(name)}
                  >
                    <span>{name}</span>
                    {candidate?.reasons[0] && <small>{candidate.reasons[0].text}</small>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
