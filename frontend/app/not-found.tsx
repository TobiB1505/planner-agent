import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <div className="route-error-shell">
      <EmptyState
        title="Seite nicht gefunden"
        description="Die aufgerufene Adresse existiert nicht oder wurde verschoben."
        primaryAction={<Button href="/dashboard">Zum Dashboard</Button>}
      />
    </div>
  );
}
