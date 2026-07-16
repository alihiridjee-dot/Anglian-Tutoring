import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CalendarRange,
  BookMarked,
  ClipboardList,
  ListChecks,
  CalendarClock,
  ChevronRight,
  PlayCircle,
} from "lucide-react";
import { useWeeklyFocus, useWeeklyFocusVideos, type RelatedVideo } from "@/hooks/data/useWeeklyFocus";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { currentWeekKey, mondayOf, weekRangeLabel } from "@/lib/week";
import { parseVideoUrl } from "@/lib/videoEmbed";
import { VideoThumbnail, VideoModal } from "@/components/VideoPlayer";

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
 * Student "This Week" widget. Shows the curriculum spec points the tutor has set
 * for the current Mon–Sun week (with the exact dates spelled out), grouped by
 * subject and limited to the student's enrolments, plus quick links to the
 * homework, MCQ and live-session surfaces.
 */
export function WeeklyFocusCard({ subjects }: { subjects: string[] }) {
  const weekKey = currentWeekKey();
  const rangeLabel = weekRangeLabel(mondayOf());
  // Only narrow to enrolments when we actually have some; an empty list would
  // otherwise hide every plan.
  const { plans, loading } = useWeeklyFocus(weekKey, subjects.length > 0 ? subjects : undefined);
  const demo = isDemoStudent();
  const linkTo = (to: string) => (demo ? `/demo/student${to}` : to);

  // Related videos: fetch everything linked to any focus point this week, then
  // show each under the plan whose points it matches.
  const allPointIds = useMemo(
    () => plans.flatMap((p) => p.points.map((pt) => pt.id)),
    [plans],
  );
  const { videos } = useWeeklyFocusVideos(allPointIds);
  const [playing, setPlaying] = useState<RelatedVideo | null>(null);

  return (
    <section className="mt-6 rounded-2xl bg-card border border-border overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-border bg-muted/30">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <CalendarRange className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display font-bold text-lg leading-tight">This Week</h3>
          <p className="text-xs text-muted-foreground">{rangeLabel}</p>
        </div>
        <span className="ml-auto text-[10px] uppercase tracking-widest font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">
          Mon – Sun
        </span>
      </header>

      <div className="p-6 space-y-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading this week's focus…</p>
        ) : plans.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <BookMarked className="w-7 h-7 mx-auto mb-2 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No focus set for this week yet</p>
            <p className="text-xs text-muted-foreground mt-1">
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
              <div key={plan.id} className="rounded-xl border border-border bg-secondary/10 p-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="font-display font-semibold text-sm">
                    {subjectLabel[plan.subject] ?? plan.subject}
                  </span>
                  <span className="text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold bg-primary/10 text-primary">
                    {levelLabel[plan.level] ?? plan.level}
                  </span>
                  <span className="text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold bg-accent/10 text-accent">
                    {plan.board.toUpperCase()}
                  </span>
                </div>

                {plan.note && (
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{plan.note}</p>
                )}

                <ul className="space-y-1.5">
                  {plan.points.map((p) => (
                    <li key={p.id} className="flex items-start gap-2.5">
                      <span className="font-mono text-[11px] text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
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

                {/* Related videos — the tutor's videos tagged to this week's points. */}
                {planVideos.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border/60">
                    <div className="flex items-center gap-1.5 mb-2.5">
                      <PlayCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
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
                          <p className="text-xs font-medium p-2 line-clamp-2 leading-snug">{v.title}</p>
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
          embed={parseVideoUrl(playing.videoUrl) ?? {
            provider: "other",
            embedUrl: null,
            fileUrl: null,
            thumbnailUrl: null,
            originalUrl: playing.videoUrl ?? "",
          }}
          title={playing.title}
          description={playing.description}
          onClose={() => setPlaying(null)}
        />
      )}
    </section>
  );
}
