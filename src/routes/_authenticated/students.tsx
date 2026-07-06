import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useRoles } from "@/hooks/useRole";
import { supabase } from "@/integrations/supabase/client";
import { Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/students")({
  head: () => ({ meta: [{ title: "Students | Anglian Tutoring" }] }),
  component: Students,
});

type StudentRow = { id: string; display_name: string | null };

function Students() {
  const { actualIsTutor, loading: rolesLoading } = useRoles();
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id, display_name").limit(500);
      setRows(data ?? []);
      setLoading(false);
    })();
  }, []);

  if (rolesLoading) return <AppLayout title="Students">Loading…</AppLayout>;
  if (!actualIsTutor) {
    return (
      <AppLayout title="Students">
        <p className="text-muted-foreground">Tutor access required.</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Students">
      <p className="text-muted-foreground mb-6">
        Manage enrolments and see subscription status. Enrolment auto-syncs from Stripe once billing
        is enabled.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-2xl bg-card border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="text-left px-6 py-3">Name</th>
                <th className="text-left px-6 py-3">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-6 py-10 text-center text-muted-foreground">
                    <Users className="w-6 h-6 mx-auto opacity-50 mb-2" /> No students yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-6 py-3 font-medium">{r.display_name ?? "—"}</td>
                    <td className="px-6 py-3 font-mono text-xs text-muted-foreground">
                      {r.id.slice(0, 8)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </AppLayout>
  );
}
