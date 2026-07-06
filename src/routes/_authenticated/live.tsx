import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { supabase } from "@/integrations/supabase/client";
import { Video, Calendar } from "lucide-react";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({ meta: [{ title: "Live Sessions | StudyHub" }] }),
  component: Live,
});

function Live() {
  const [filters, setFilters] = useState<Filters>({});
  const { data, isLoading } = useQuery({
    queryKey: ["live", filters],
    queryFn: async () => {
      let q = supabase
        .from("resources")
        .select("*")
        .eq("kind", "live_session")
        .order("starts_at", { ascending: true });
      if (filters.subject) q = q.eq("subject", filters.subject);
      if (filters.board) q = q.eq("board", filters.board);
      if (filters.level) q = q.eq("level", filters.level);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const now = Date.now();
  const upcoming = (data ?? []).filter(
    (s) => s.starts_at && new Date(s.starts_at).getTime() >= now,
  );
  const past = (data ?? []).filter((s) => s.starts_at && new Date(s.starts_at).getTime() < now);

  return (
    <AppLayout title="Live Sessions">
      <FilterBar value={filters} onChange={setFilters} />
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (data ?? []).length === 0 ? (
        <p className="text-muted-foreground">No sessions scheduled.</p>
      ) : (
        <>
          <h3 className="font-display text-lg font-semibold mb-3">Upcoming</h3>
          <div className="grid gap-3 mb-8">
            {upcoming.length === 0 && (
              <p className="text-sm text-muted-foreground">No upcoming sessions.</p>
            )}
            {upcoming.map((s) => (
              <div
                key={s.id}
                className="rounded-xl bg-card border border-border p-5 flex flex-col lg:flex-row lg:items-center gap-4"
              >
                <div className="flex items-center gap-3 lg:w-64">
                  <div className="w-11 h-11 rounded-lg bg-secondary flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(s.starts_at!).toLocaleString()}
                    </p>
                    <p className="font-medium capitalize">
                      {s.subject} · {s.level}
                    </p>
                  </div>
                </div>
                <p className="flex-1 font-medium">{s.title}</p>
                {s.join_url ? (
                  <a
                    href={s.join_url}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
                  >
                    <Video className="w-4 h-4" />
                    Join
                  </a>
                ) : null}
              </div>
            ))}
          </div>
          {past.length > 0 && (
            <>
              <h3 className="font-display text-lg font-semibold mb-3">Past</h3>
              <div className="grid gap-3">
                {past.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-xl bg-card border border-border p-5 flex items-center gap-4 opacity-70"
                  >
                    <Calendar className="w-5 h-5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground w-48">
                      {new Date(s.starts_at!).toLocaleString()}
                    </p>
                    <p className="flex-1 font-medium">{s.title}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </AppLayout>
  );
}
