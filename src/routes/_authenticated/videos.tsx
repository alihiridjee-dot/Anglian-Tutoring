import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { supabase } from "@/integrations/supabase/client";
import { SUBJECTS, BOARDS, LEVELS } from "@/lib/taxonomy";
import { isDemoStudent, DEMO_VIDEOS } from "@/lib/demo/studentDemo";
import { parseVideoUrl } from "@/lib/videoEmbed";
import { VideoThumbnail, VideoModal } from "@/components/VideoPlayer";

export const Route = createFileRoute("/_authenticated/videos")({
  head: () => ({ meta: [{ title: "Videos | Anglia Educate" }] }),
  component: Videos,
});

function tagLabel(kind: "subject" | "board" | "level", v: string) {
  const src = kind === "subject" ? SUBJECTS : kind === "board" ? BOARDS : LEVELS;
  return src.find((x) => x.value === v)?.label ?? v;
}

type PlayingVideo = { title: string; description: string | null; url: string | null };

export function Videos() {
  const [filters, setFilters] = useState<Filters>({});
  const [playing, setPlaying] = useState<PlayingVideo | null>(null);
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
        <Spinner label="Loading the video library" />
      ) : !data || data.length === 0 ? (
        <EmptyState
          mascot="rocket"
          mood="sleepy"
          title="No videos for this selection"
          body="Nothing has been published for this subject, board and level yet. Try widening the filters above, or come back once your tutor has recorded the next topic."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.map((v) => {
            const embed = parseVideoUrl(v.video_url);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() =>
                  setPlaying({ title: v.title, description: v.description, url: v.video_url })
                }
                className="pop-card pop-card-interactive group overflow-hidden text-left"
              >
                <VideoThumbnail embed={embed} />
                <div className="p-4">
                  <p className="font-display font-bold">{v.title}</p>
                  {v.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {v.description}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                    <span className="chip text-[10px] tracking-wider uppercase">
                      {tagLabel("subject", v.subject)}
                    </span>
                    {v.board && (
                      <span className="chip tint-slate text-[10px] tracking-wider uppercase">
                        {tagLabel("board", v.board)}
                      </span>
                    )}
                    <span className="chip tint-slate text-[10px] tracking-wider uppercase">
                      {tagLabel("level", v.level)}
                    </span>
                    <span className="text-primary ml-auto inline-flex items-center gap-1 font-bold">
                      Watch
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {playing && (
        <VideoModal
          embed={
            parseVideoUrl(playing.url) ?? {
              provider: "other",
              embedUrl: null,
              fileUrl: null,
              thumbnailUrl: null,
              originalUrl: playing.url ?? "",
            }
          }
          title={playing.title}
          description={playing.description}
          onClose={() => setPlaying(null)}
        />
      )}
    </AppLayout>
  );
}
