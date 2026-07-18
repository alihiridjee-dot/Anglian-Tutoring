import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarRange,
  BookMarked,
  ClipboardList,
  ListChecks,
  CalendarClock,
  ChevronRight,
  ChevronDown,
  PlayCircle,
  Sparkles,
} from "lucide-react";
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

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

const levelLabel: Record<string, string> = { gcse: "GCSE", alevel: "A-Level" };

// Quick links to the week's deliverables. Kept as the three student surfaces the
// widget promises — homework, MCQs and live sessions — so everything the student
// needs sits in one view.
const quickLinks = [
  { to: "/homework", label: "Homework", icon: ClipboardList },
  { to: "/mcqs", label: "MCQs", icon: ListChecks },
  { to: "/live", label: "Live Sessions", icon: CalendarClock },
] as const;

/**
 * "What you'll focus on this week" blurb for one plan. The summary is generated
 * once by the tutor's save (Anthropic Claude) and stored on the weekly_focus
 * row, so here it's a plain read — no per-view AI call. Falls back to a prompt
 * toward the spec-point dropdown when a plan predates the feature or generation
 * failed.
 */
function PlanSummary({ plan }: { plan: WeeklyFocusPlan }) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-bold text-foreground">Your focus this week</span>
      </div>
      {plan.summary ? (
        <p className="text-[15px] text-foreground/90 leading-relaxed">{plan.summary}</p>
      ) : (
        <p className="text-sm text-muted-foreground leading-relaxed">
          Review the spec points below to see what this week covers.
        </p>
      )}
    </div>
  );
}

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
    <section className="mt-6 rounded-2xl bg-card border border-border overflow-hidden">
      <header className="flex flex-wrap items-center gap-4 px-6 py-5 border-b border-border bg-muted/30">
        <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <CalendarRange className="w-6 h-6 text-primary" />
        </div>
        <h3 className="font-display font-bold text-xl leading-tight">This Week</h3>
        {/* Combined, highlighted date range + Mon–Sun scope, boxed on the left. */}
        <div className="ml-auto inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2">
          <span className="text-sm font-bold text-primary">{rangeLabel}</span>
          <span className="text-primary/40">·</span>
          <span className="text-sm font-bold uppercase tracking-wide text-primary">Mon–Sun</span>
        </div>
      </header>

      <div className="p-6 space-y-5">
        {/* Live sessions — a mildly pulsing strip inside the This Week hub. On the
            dashboard this is hoisted into its own standalone banner (showLive =
            false here), so it isn't shown twice. */}
        {showLive && <LiveSessionsBanner to={linkTo("/live")} plansPresent={plans.length > 0} />}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading this week's focus…</p>
        ) : plans.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <BookMarked className="w-7 h-7 mx-auto mb-2 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No focus set for this week yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Your tutor will choose this week's curriculum points on Monday. Check back soon.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {plans.map((plan) => {
              const planPointIds = new Set(plan.points.map((p) => p.id));
              const planVideos = videos.filter((v) =>
                v.matchedPointIds.some((id) => planPointIds.has(id)),
              );
              return (
                <div key={plan.id} className="rounded-2xl border border-border bg-secondary/10 p-5">
                  {/* Subject banner — subject name plus level & board badges, all
                    on one line and comfortably readable. */}
                  <div className="flex flex-wrap items-center gap-2.5 mb-4">
                    <span className="font-display font-bold text-lg">
                      {subjectLabel[plan.subject] ?? plan.subject}
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full uppercase tracking-wide font-bold bg-primary/10 text-primary">
                      {levelLabel[plan.level] ?? plan.level}
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full uppercase tracking-wide font-bold bg-accent/10 text-accent">
                      {plan.board.toUpperCase()}
                    </span>
                  </div>

                  {plan.note && (
                    <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                      {plan.note}
                    </p>
                  )}

                  {/* AI focus summary, where the spec points used to sit. */}
                  <PlanSummary plan={plan} />

                  {/* Spec points — kept, but tucked into a neat dropdown since a
                    single week can cover many. */}
                  <details className="group mt-4 rounded-xl border border-border bg-card">
                    <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer list-none select-none">
                      <BookMarked className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm font-semibold">
                        Spec points
                        <span className="ml-1.5 text-muted-foreground font-normal">
                          ({plan.points.length})
                        </span>
                      </span>
                      <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto transition-transform group-open:rotate-180" />
                    </summary>
                    <ul className="px-4 pb-4 pt-1 space-y-2 border-t border-border">
                      {plan.points.map((p) => (
                        <li key={p.id} className="flex items-start gap-2.5">
                          <span className="font-mono text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
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
                  </details>

                  {/* Related videos — the tutor's videos tagged to this week's points. */}
                  {planVideos.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border/60">
                      <div className="flex items-center gap-1.5 mb-3">
                        <PlayCircle className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground">
                          Related videos
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {planVideos.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setPlaying(v)}
                            className="group text-left rounded-lg border border-border bg-card overflow-hidden hover:border-primary/40 transition"
                          >
                            <VideoThumbnail embed={parseVideoUrl(v.videoUrl)} />
                            <p className="text-sm font-medium p-2 line-clamp-2 leading-snug">
                              {v.title}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Direct links to the week's deliverables — always shown so the widget
            is a hub even before a plan is set. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          {quickLinks.map((q) => (
            <Link
              key={q.to}
              to={linkTo(q.to)}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 hover:border-primary/50 hover:shadow-sm transition group"
            >
              <span className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <q.icon className="w-4 h-4 text-primary" />
              </span>
              <span className="text-sm font-medium flex-1">{q.label}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-primary transition" />
            </Link>
          ))}
        </div>
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
