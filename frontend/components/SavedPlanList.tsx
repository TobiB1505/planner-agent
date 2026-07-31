"use client";

import { useState } from "react";

export interface SavedPlanListItem {
  id: number;
  startDate: string;
  endDate?: string;
  title: string;
  detail: string;
  meta: string;
}

function weekNumber(iso: string): number {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function dateRange(startIso: string, endIso?: string): string {
  const start = new Date(`${startIso}T12:00:00`);
  const end = new Date(`${endIso || startIso}T12:00:00`);
  const formatter = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function dateParts(iso: string) {
  const date = new Date(`${iso}T12:00:00`);
  return {
    week: weekNumber(iso),
    year: date.getFullYear(),
  };
}

export default function SavedPlanList({
  items,
  selectedId,
  onSelect,
  emptyText,
}: {
  items: SavedPlanListItem[];
  selectedId?: number | null;
  onSelect: (id: number) => void;
  emptyText: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!items.length) {
    return <div className="saved-plan-empty">{emptyText}</div>;
  }

  const sortedItems = [...items].sort((a, b) =>
    b.startDate.localeCompare(a.startDate),
  );
  const visibleItems = expanded ? sortedItems : sortedItems.slice(0, 4);

  return (
    <div className="saved-plan-browser">
      <div className="saved-plan-list">
        {visibleItems.map((item) => {
          const date = dateParts(item.startDate);
          const selected = selectedId === item.id;
          return (
            <button
              type="button"
              key={item.id}
              className={`saved-plan-card ${selected ? "is-selected" : ""}`}
              onClick={() => onSelect(item.id)}
              aria-pressed={selected}
            >
              <span className="saved-plan-date" aria-hidden="true">
                <small>KW</small>
                <strong>{date.week}</strong>
              </span>
              <span className="saved-plan-copy">
                <strong>{item.title}</strong>
                <span>{dateRange(item.startDate, item.endDate)} · {date.year}</span>
                <small>{item.detail} · {item.meta}</small>
              </span>
              <span className="saved-plan-state">
                {selected ? "Geöffnet" : "Öffnen"}
              </span>
            </button>
          );
        })}
      </div>
      {sortedItems.length > 4 && (
        <button
          type="button"
          className="saved-plan-more"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Weniger anzeigen" : `${sortedItems.length - 4} weitere Wochen anzeigen`}
        </button>
      )}
    </div>
  );
}
