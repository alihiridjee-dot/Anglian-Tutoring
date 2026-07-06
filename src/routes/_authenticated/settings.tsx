import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings | StudyHub" }] }),
  component: Settings,
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function Settings() {
  const { email, roles } = useRoles();
  return (
    <AppLayout title="Settings">
      <div className="max-w-2xl rounded-2xl bg-card border border-border p-6">
        <h2 className="font-display text-lg font-semibold tracking-tight">Account</h2>
        <Row label="Email" value={email ?? "—"} />
        <Row label="Roles" value={(roles ?? []).join(", ") || "—"} />
      </div>
    </AppLayout>
  );
}
