import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { EmptyState, Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { supabase } from "@/integrations/supabase/client";
import { SUBJECTS, BOARDS, LEVELS } from "@/lib/curriculum/taxonomy";
import { isDemoStudent, DEMO_VIDEOS } from "@/lib/demo/studentDemo";
import { parseVideoUrl } from "@/lib/curriculum/videoEmbed";
import {
  ownCourseFilters,
  withOwnBoard,
  type VideoSearchParams,
} from "@/lib/curriculum/videoFilters";
import { dbError } from "@/lib/platform/errors";
import { VideoThumbnail, VideoModal } from "@/components/VideoPlayer";
import { useRoles } from "@/hooks/useRole";
import { useEntitlements } from "@/hooks/data/useEntitlements";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useActiveSubject } from "@/hooks/useActiveSubject";

function tagLabel(kind: "subject" | "board" | "level", v: string) {
  const src = kind === "subject" ? SUBJECTS : kind === "board" ? BOARDS : LEVELS;
  return src.find((x) => x.value === v)?.label ?? v;
}

type PlayingVideo = { title: string; description: string | null; url: string | null };

/** Videos per page. One course holds a few hundred, and a read returns at most 1,000. */
const PAGE = 48;

export function Videos() {
  const { isTutor } = useRoles();
  const ent = useEntitlements();
  const { level, loading: enrolLoading } = useEnrolments();
  const { subject: activeSubject } = useActiveSubject();
  // Read loosely: the showcase mounts this page under /demo/student as well.
  const search = useSearch({ strict: false }) as VideoSearchParams;
  const navigate = useNavigate();
  // A student opens on their own course and a tutor on everything. The first
  // filter they touch takes over from there.
  const [picked, setPicked] = useState<Filters | null>(null);
  const filters: Filters =
    picked ??
    (isTutor
      ? {}
      : ownCourseFilters({ subject: activeSubject, boardBySubject: ent.boardBySubject, level }));
  const setFilters = (next: Filters) =>
    setPicked(isTutor ? next : withOwnBoard(filters, next, ent.boardBySubject));
  const [playing, setPlaying] = useState<PlayingVideo | null>(null);
  const videos = useInfiniteQuery({
    queryKey: ["videos", filters],
    // A student's course isn't known until their profile has been read.
    enabled: isTutor || !enrolLoading,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
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
        // Named, not "*": a browser may not select every column of resources
        // (join_url is withheld), and "*" asks for all of them.
        .select("id, title, description, subject, board, level, video_url")
        .eq("kind", "video")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(pageParam, pageParam + PAGE - 1);
      if (filters.subject) q = q.eq("subject", filters.subject);
      if (filters.board) q = q.eq("board", filters.board);
      if (filters.level) q = q.eq("level", filters.level);
      const { data, error } = await q;
      if (error) throw dbError(error);
      return data;
    },
    getNextPageParam: (last, pages) =>
      isDemoStudent() || last.length < PAGE ? undefined : pages.length * PAGE,
    // The grid stays up while the next filter's videos land.
    placeholderData: (prev) => prev,
  });
  const data = videos.data?.pages.flat();
  // Offline, a read waits ("paused") instead of failing. One with no videos of
  // its own reads as failed, never as a spinner that never stops or the last
  // filter's grid.
  const unreachable = videos.isPaused && (!data || videos.isPlaceholderData);

  // A search hit links to one video, which opens over the page.
  const linkedId = isDemoStudent() ? undefined : search.video;
  const { data: linked } = useQuery({
    queryKey: ["video", linkedId],
    enabled: !!linkedId,
    queryFn: async (): Promise<PlayingVideo | null> => {
      const { data, error } = await supabase
        .from("resources")
        .select("title, description, video_url")
        .eq("id", linkedId!)
        .eq("kind", "video")
        .maybeSingle();
      if (error) throw dbError(error);
      return data && { title: data.title, description: data.description, url: data.video_url };
    },
  });
  const shown = playing ?? (linkedId ? linked : null) ?? null;
  const closePlayer = () => {
    setPlaying(null);
    if (linkedId)
      navigate({
        search: (prev: VideoSearchParams) => ({ ...prev, video: undefined }),
        replace: true,
      } as never);
  };

  return (
    <AppLayout title="Videos">
      <FilterBar
        value={filters}
        onChange={setFilters}
        subjects={isTutor || ent.entitledSubjects.length === 0 ? undefined : ent.entitledSubjects}
      />
      {videos.isPending && !unreachable ? (
        <Spinner label="Loading the video library" />
      ) : (videos.isError && !data) || unreachable ? (
        <EmptyState
          compact
          title="The videos didn't load"
          body="Check your connection and refresh the page."
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          mascot="rocket"
          mood="sleepy"
          title="No videos for this selection"
          body={
            isTutor
              ? "Nothing has been published for this subject, board and level yet. Try widening the filters above."
              : "Nothing has been published for this subject, board and level yet. Try widening the filters above, or come back once your tutor has recorded the next topic."
          }
        />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.map((v) => {
              const embed = parseVideoUrl(v.video_url);
              return (
                <button
                  data-guide="video-watch"
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
          {videos.hasNextPage && (
            <button
              type="button"
              onClick={() => void videos.fetchNextPage()}
              disabled={videos.isFetchingNextPage}
              className="btn-soft mx-auto mt-6 flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold"
            >
              {videos.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
              Show more
            </button>
          )}
        </>
      )}

      {shown && (
        <VideoModal
          embed={
            parseVideoUrl(shown.url) ?? {
              provider: "other",
              embedUrl: null,
              fileUrl: null,
              thumbnailUrl: null,
              originalUrl: shown.url ?? "",
            }
          }
          title={shown.title}
          description={shown.description}
          onClose={closePlayer}
        />
      )}
    </AppLayout>
  );
}
