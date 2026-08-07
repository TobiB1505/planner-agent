"use client";

import { useRef } from "react";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  /** Für Icon-only-Optionen zusätzlich zum sichtbaren Label benötigt. */
  "aria-label"?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/**
 * Für wenige exklusive Ansichten/Modi (z.B. Woche/Tag) - kein Ersatz für
 * Seiten-Navigation. Echte Buttons mit `aria-pressed`, volle Pfeiltasten-
 * Bedienung (Home/End/Arrow), responsive (bricht bei Bedarf um).
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  function focusIndex(index: number) {
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons || buttons.length === 0) return;
    const clamped = (index + buttons.length) % buttons.length;
    buttons[clamped]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusIndex(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusIndex(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusIndex(options.length - 1);
    }
  }

  return (
    <div ref={groupRef} role="group" aria-label={label} className={["ui-segmented", className].filter(Boolean).join(" ")}>
      {options.map((option, index) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={["ui-segmented-option", isActive ? "is-active" : ""].filter(Boolean).join(" ")}
            aria-pressed={isActive}
            aria-label={option["aria-label"]}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
