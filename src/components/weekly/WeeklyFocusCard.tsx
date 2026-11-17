import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  useWeeklyFocus,
  useWeeklyFocusVideos,
  type RelatedVideo,
  type WeeklyFocusPlan,
} from "@/hooks/data/useWeeklyFocus";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { currentWeekKey } from "@/lib/planner/week";
import { parseVideoUrl } from "@/lib/curriculum/videoEmbed";
import { VideoThumbnail, VideoModal } from "@/components/VideoPlayer";
import { LiveSessionsBanner } from "@/components/live/LiveSessionsBanner";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { ErrorNote, SciText } from "@/components/Shared";
import { useSpecPointNotes, type SpecPointNote } from "@/hooks/data/useNotes";
import { cn } from "@/lib/utils";

/**
 * Student "From your tutor" card. Shows the spec points the tutor pinned into
 * this student's current Mon–Sun week, grouped by subject and limited to the
 * student's enrolments, with the tutor's note where there is one, the videos
 * linked to them and an optional live-session strip.
 *
 * Playful minimalism: one card per subject in that subject's tint, and nothing
 * boxed inside it. The note is plain dark text under the title, and each point
 * is a bare row — its video as a thumbnail, its title in bold and one solid
 * Read button. A week with nothing pinned draws nothing.
 */
export function WeeklyFocusCard({
  studentId,
  subjects,
  showLive = true,
}: {
  studentId: string | null;
  subjects: string[];
  showLive?: boolean;
}) {
  const weekKey = currentWeekKey();
  // Only narrow to enrolments when we actually have some; an empty list would
  // otherwise hide every plan.
  const { plans, error, reload } = useWeeklyFocus(
    studentId,
    weekKey,
    subjects.length > 0 ? subjects : undefined,
  );
  const demo = isDemoStudent();
  const linkTo = (to: string) => (demo ? `/demo/student${to}` : to);

  // Related videos: fetch everything linked to any focus point this week, then
  // show each beside the point it teaches.
  const allPointIds = useMemo(() => plans.flatMap((p) => p.points.map((pt) => pt.id)), [plans]);
  const { videos } = useWeeklyFocusVideos(allPointIds);
  const { data: notesByPoint } = useSpecPointNotes(allPointIds);
  const [playing, setPlaying] = useState<RelatedVideo | null>(null);

  // A failed read is not "nothing added": that one is said. Nothing pinned
  // this week draws nothing, rather than a grey sentence saying so.
  const hasBody = !!error || plans.length > 0;
  if (!hasBody && !showLive) return null;

  return (
    <section className="mt-6 space-y-6">
      {/* Live sessions — a mildly pulsing strip. On the dashboard this is
          hoisted into its own standalone banner (showLive = false here), so it
          isn't shown twice. */}
      {showLive && <LiveSessionsBanner to={linkTo("/live")} plansPresent={plans.length > 0} />}

      {error ? (
        <ErrorNote error={error} onRetry={() => void reload()} />
      ) : (
        plans.map((plan) => (
          <FocusPlanCard
            key={plan.id}
            plan={plan}
            multi={plans.length > 1}
            videos={videos}
            notesByPoint={notesByPoint}
            onPlay={setPlaying}
            demo={demo}
          />
        ))
      )}

      {playing && (
        <VideoModal
          embed={
            parseVideoUrl(playing.videoUrl) ?? {
              provider: "other",
              embedUrl: null,
              fileUrl: null,
              thumbnailUrl: null,
              originalUrl: playing.videoUrl ?? "",
            }
          }
          title={playing.title}
          description={playing.description}
          onClose={() => setPlaying(null)}
        />
      )}
    </section>
  );
}

/** Each video once, beside the first of the plan's points it teaches. */
function videosByPoint(plan: WeeklyFocusPlan, videos: RelatedVideo[]) {
  const out = new Map<string, RelatedVideo[]>();
  const placed = new Set<string>();
  for (const p of plan.points) {
    const mine = videos.filter((v) => !placed.has(v.id) && v.matchedPointIds.includes(p.id));
    mine.forEach((v) => placed.add(v.id));
    out.set(p.id, mine);
  }
  return out;
}

function FocusPlanCard({
  plan,
  multi,
  videos,
  notesByPoint,
  onPlay,
  demo,
}: {
  plan: WeeklyFocusPlan;
  /** More than one subject on show, so each card names its own. */
  multi: boolean;
  videos: RelatedVideo[];
  notesByPoint: Map<string, SpecPointNote[]> | undefined;
  onPlay: (v: RelatedVideo) => void;
  demo: boolean;
}) {
  const vids = videosByPoint(plan, videos);
  return (
    <div className={cn(SUBJECT_TINT[plan.subject], "premium-card focus-card p-5 sm:p-7")}>
      <div className="flex items-center gap-4">
        {/* The note is Ali's, so his photo says it, with a wave. A pin with no
            note could be any tutor's, so it gets a pin, not a face. */}
        {plan.note ? (
          <span aria-hidden className="focus-avatar">
            <span className="focus-wave">👋</span>
          </span>
        ) : (
          <span aria-hidden className="focus-pin">
            📌
          </span>
        )}
        <h2 className="text-2xl font-extrabold">
          {multi ? `${subjectLabel(plan.subject)} from your tutor` : "From your tutor"}
        </h2>
      </div>

      {plan.note && (
        <p className="mt-4 text-base leading-relaxed whitespace-pre-wrap">
          <SciText text={plan.note} />
        </p>
      )}

      <ul className="mt-5 space-y-5">
        {plan.points.map((p) => {
          const note = notesByPoint?.get(p.id)?.[0];
          const pv = vids.get(p.id) ?? [];
          return (
            <li key={p.id} className="flex flex-col gap-4 sm:flex-row sm:items-center">
              {pv.length > 0 && (
                <span className="flex flex-wrap gap-3">
                  {pv.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => onPlay(v)}
                      title={v.title}
                      aria-label={`Watch ${v.title}`}
                      className="focus-thumb group"
                    >
                      <VideoThumbnail embed={parseVideoUrl(v.videoUrl)} />
                    </button>
                  ))}
                </span>
              )}
              <span className="font-display min-w-0 flex-1 text-lg leading-snug font-bold">
                {p.title}
              </span>
              {/* The point's own revision note, one press away. */}
              {note && (
                <Link
                  to={demo ? "/demo/student/notes/$conceptId" : "/notes/$conceptId"}
                  params={{ conceptId: note.id }}
                  className="btn-solid focus-go inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-xl px-4 py-2 text-sm sm:self-auto"
                >
                  <span aria-hidden className="focus-emoji">
                    📖
                  </span>
                  Read
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
