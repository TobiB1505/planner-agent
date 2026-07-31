"use client";

import { useId, useState } from "react";

export default function FileDropzone({
  file,
  onFileChange,
  accept,
  title,
  description,
  formatLabel,
  busy = false,
  busyLabel = "Datei wird ausgewertet …",
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  accept: string;
  title: string;
  description: string;
  formatLabel: string;
  busy?: boolean;
  busyLabel?: string;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  function acceptsFile(nextFile: File): boolean {
    const rules = accept.split(",").map((value) => value.trim().toLowerCase());
    const fileName = nextFile.name.toLowerCase();
    const fileType = nextFile.type.toLowerCase();
    return rules.some((rule) =>
      rule.startsWith(".") ? fileName.endsWith(rule) : rule === fileType,
    );
  }

  function selectFile(nextFile: File | null) {
    if (nextFile && !acceptsFile(nextFile)) {
      setError(`Dieses Dateiformat passt nicht. Erlaubt sind: ${formatLabel}.`);
      return;
    }
    setError("");
    onFileChange(nextFile);
  }

  return (
    <div
      className={`file-dropzone ${dragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
      aria-busy={busy}
      onDragEnter={(event) => {
        if (busy) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!busy) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!busy) selectFile(event.dataTransfer.files?.[0] ?? null);
      }}
    >
      <label className="file-dropzone-main" htmlFor={inputId}>
        <input
          id={inputId}
          type="file"
          accept={accept}
          disabled={busy}
          onChange={(event) => {
            selectFile(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
        <span className="file-dropzone-icon" aria-hidden="true">
          {busy ? "…" : file ? "✓" : "↑"}
        </span>
        <span className="file-dropzone-copy">
          <strong>{busy ? busyLabel : file?.name || title}</strong>
          <span>
            {busy
              ? "Die Inhalte werden vorbereitet. Das dauert nur einen Moment."
              : file
                ? `${Math.max(file.size / 1024 / 1024, 0.01).toFixed(2)} MB · bereit zum Einlesen`
                : description}
          </span>
          <small>{formatLabel}</small>
        </span>
        {!busy && (
          <span className="file-dropzone-action">
            {file ? "Datei wechseln" : "Datei auswählen"}
          </span>
        )}
      </label>
      {busy && (
        <span className="file-dropzone-progress" aria-hidden="true">
          <span />
        </span>
      )}
      {file && !busy && (
        <button
          type="button"
          className="file-dropzone-remove"
          onClick={() => selectFile(null)}
        >
          Auswahl entfernen
        </button>
      )}
      {error && <span className="file-dropzone-error" role="alert">{error}</span>}
    </div>
  );
}
