export default function ReadingProgress({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
  return (
    <div className="reading-progress" role="status" aria-live="polite">
      <div className="reading-progress-copy">
        <span className="reading-progress-pulse" aria-hidden="true" />
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <div className="reading-progress-track" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
