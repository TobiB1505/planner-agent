"use client";

import type { CustomCellEditorProps } from "ag-grid-react";
import { useEffect, useRef } from "react";

export default function ArtistTextCellEditor({
  value,
  onValueChange,
  stopEditing,
}: CustomCellEditorProps<Record<string, string>, string>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  return (
    <div className="artist-text-editor">
      <textarea
        ref={textareaRef}
        value={value ?? ""}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            stopEditing();
          }
        }}
        placeholder="Künstler, DJ, Ort oder Uhrzeit …"
      />
      <div className="artist-text-editor-actions">
        <span>⌘ + Enter übernimmt</span>
        <button type="button" className="btn" onClick={() => onValueChange("")}>
          Leeren
        </button>
        <button type="button" className="btn btn-primary" onClick={() => stopEditing()}>
          Übernehmen
        </button>
      </div>
    </div>
  );
}
