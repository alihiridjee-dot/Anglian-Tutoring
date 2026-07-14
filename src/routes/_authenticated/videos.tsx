import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { supabase } from "@/integrations/supabase/client";
import { PlayCircle, ExternalLink } from "lucide-react";
import { SUBJECTS, BOARDS, LEVELS } from "@/lib/taxonomy";
import { isDemoStudent, DEMO_VIDEOS } from "@/lib/demo/studentDemo";

export const Route = createFileRoute("/_authenticated/videos")({
  head: () => ({ meta: [{ title: "Videos | StudyHub" }] }),
  component: Videos,
});

function tagLabel(kind: "subject" | "board" | "level", v: string) {
  const src = kind === "subject" ? SUBJECTS : kind === "board" ? BOARDS : LEVELS;
  return src.find((x) => x.value === v)?.label ?? v;
}

function Videos() {
  const [filters, setFilters] = useState<Filters>({});
  const { data, isLoading } = useQuery({
    queryKey: ["videos", filters],
    queryFn: async () => {
      if (isDemoStudent()) {
        return DEMO_VIDEOS.filter(
          (v) =>
            (!filters.subject || v.subject === filters.subject) &&
            (!filters.board || v.board === filters.board) &&
            (!filters.level || v.level === filters.level),
        );
      }
      let q = supabase
        .from("resources")
        .select("*")
        .eq("kind", "video")
        .order("created_at", { ascending: false });
      if (filters.subject) q = q.eq("subject", filters.subject);
      if (filters.board) q = q.eq("board", filters.board);
      if (filters.level) q = q.eq("level", filters.level);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppLayout title="Videos">
      <FilterBar value={filters} onChange={setFilters} />
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !data || data.length === 0 ? (
        <p className="text-muted-foreground">No videos yet for this selection.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((v) => {
            const videoUrl = v.video_url;
            const displayTitle = v.title;
            const displayDesc = v.description;

            return (
              <a
                key={v.id}
                href={videoUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="group rounded-2xl bg-card border border-border overflow-hidden hover:border-primary/40"
              >
                <div className="aspect-video bg-secondary flex items-center justify-center">
                  <PlayCircle className="w-12 h-12 text-primary/60 group-hover:text-primary" />
                </div>
                <div className="p-4">
                  <p className="font-semibold">{displayTitle}</p>
                  {displayDesc && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{displayDesc}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                    <span className="px-2 py-0.5 rounded-full bg-primary/15 text-primary uppercase tracking-wider font-semibold">
                      {tagLabel("subject", v.subject)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground uppercase tracking-wider font-semibold">
                      {tagLabel("board", v.board)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground uppercase tracking-wider font-semibold">
                      {tagLabel("level", v.level)}
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
                      <ExternalLink className="w-3 h-3" />
                      Watch
                    </span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
