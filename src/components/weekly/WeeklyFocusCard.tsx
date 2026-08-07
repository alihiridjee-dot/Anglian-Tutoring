import { useMemo, useState } from "react";
import { BookMarked } from "lucide-react";
import {
  useWeeklyFocus,
  useWeeklyFocusVideos,
  type RelatedVideo,
  type WeeklyFocusPlan,
} from "@/hooks/data/useWeeklyFocus";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { currentWeekKey, mondayOf, weekRangeLabel } from "@/lib/week";
import { parseVideoUrl } from "@/lib/videoEmbed";
import { VideoThumbnail, VideoModal } from "@/components/VideoPlayer";
import { LiveSessionsBanner } from "@/components/live/LiveSessionsBanner";
import { levelLabel, subjectLabel } from "@/lib/courseSummary";

/**
 * Student "This Week" widget. Shows the curriculum spec points the tutor has set
 * for the current Mon–Sun week (with the exact dates spelled out), grouped by
 * subject and limited to the student's enrolments, plus an AI focus summary, the
 * spec points in a dropdown, related videos, a live-session strip and quick
 * links to the homework, MCQ and live-session surfaces.
 */
export function WeeklyFocusCard({
  subjects,
  showLive = true,
}: {
  subjects: string[];
  showLive?: boolean;
}) {
  const weekKey = currentWeekKey();
  const rangeLabel = weekRangeLabel(mondayOf());
  // Only narrow to enrolments when we actually have some; an empty list would
  // otherwise hide every plan.
  const { plans, loading } = useWeeklyFocus(weekKey, subjects.length > 0 ? subjects : undefined);
  const demo = isDemoStudent();
  const linkTo = (to: string) => (demo ? `/demo/student${to}` : to);

  // Related videos: fetch everything linked to any focus point this week, then
  // show each under the plan whose points it matches.
  const allPointIds = useMemo(() => plans.flatMap((p) => p.points.map((pt) => pt.id)), [plans]);
  const { videos } = useWeeklyFocusVideos(allPointIds);
  const [playing, setPlaying] = useState<RelatedVideo | null>(null);

  return (
    <section className="mt-6 rounded-2xl premium-card overflow-hidden">
      {/* Compact header. Named for whose it is, not what week it is — the
          programme-driven plan above is already "this week", and two cards with
          the same title read as the same thing twice. */}
      <header className="flex flex-wrap items-center gap-2.5 px-4 sm:px-5 py-3 border-b border-border bg-muted/30">
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <BookMarked className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display font-semibold text-base leading-tight">From your tutor</h3>
          <p className="text-xs text-muted-foreground">Extra focus for {rangeLabel} · Mon–Sun</p>
        </div>
        {plans.length > 0 && (
          <span className="ml-auto text-xs font-semibold text-primary tabular-nums">
            {allPointIds.length} {allPointIds.length === 1 ? "point" : "points"}
          </span>
        )}
      </header>

      <div className="p-4 sm:p-5 space-y-4">
        {/* Live sessions — a mildly pulsing strip inside the This Week hub. On the
            dashboard this is hoisted into its own standalone banner (showLive =
            false here), so it isn't shown twice. */}
        {showLive && <LiveSessionsBanner to={linkTo("/live")} plansPresent={plans.length > 0} />}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing added for this week — your plan above is yours to get on with.
          </p>
        ) : (
          <div className="space-y-4">
            {plans.map((plan) => {
              const planPointIds = new Set(plan.points.map((p) => p.id));
              const planVideos = videos.filter((v) =>
                v.matchedPointIds.some((id) => planPointIds.has(id)),
              );
              return (
                <div key={plan.id} className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display font-semibold">{subjectLabel(plan.subject)}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wide font-bold bg-primary/10 text-primary">
                      {levelLabel(plan.level)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wide font-bold bg-accent/10 text-accent">
                      {plan.board.toUpperCase()}
                    </span>
                  </div>

                  {(plan.summary || plan.note) && (
                    <p className="text-sm text-foreground/90 leading-relaxed">
                      {plan.summary ?? plan.note}
                    </p>
                  )}

                  {/* The points themselves, in the open — they are the reason this
                      card exists, and a dropdown hid the tutor's actual choice. */}
                  <ul className="space-y-1.5">
                    {plan.points.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-start gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-2"
                      >
                        <span className="font-mono text-[11px] text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                          {p.code}
                        </span>
                        <span className="text-sm leading-snug">
                          <span className="font-medium text-foreground">{p.title}</span>
                          {p.topicLabel && (
                            <span className="text-muted-foreground"> — {p.topicLabel}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {planVideos.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {planVideos.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setPlaying(v)}
                          className="group text-left rounded-lg premium-card overflow-hidden hover:border-primary/40 transition"
                        >
                          <VideoThumbnail embed={parseVideoUrl(v.videoUrl)} />
                          <p className="text-xs font-medium p-1.5 line-clamp-2 leading-snug">
                            {v.title}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

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
