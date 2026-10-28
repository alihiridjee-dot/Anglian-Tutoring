import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { useViewer } from "@/hooks/useViewer";
import { UserRole } from "@/types/user";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings | Anglia Educate" }] }),
  component: Settings,
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-4 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * The account type in words. Read off the role the app routes on, not the raw
 * `user_roles` rows: every sign-up gets a "student" row there, parents included,
 * so a parent was told they were a student.
 */
const ACCOUNT_TYPE: Record<UserRole, string> = {
  [UserRole.STUDENT]: "Student",
  [UserRole.PARENT]: "Parent",
  [UserRole.TUTOR]: "Tutor",
  [UserRole.ADMIN]: "Admin",
};

function Settings() {
  const { email } = useRoles();
  const viewer = useViewer();
  return (
    <AppLayout title="Settings">
      <div className="max-w-2xl rounded-2xl premium-card p-4 sm:p-6">
        <h2 className="font-display text-lg font-bold tracking-tight">Account</h2>
        <Row label="Email" value={email ?? "—"} />
        <Row label="Account type" value={viewer ? ACCOUNT_TYPE[viewer.appRole] : "—"} />
      </div>
    </AppLayout>
  );
}
