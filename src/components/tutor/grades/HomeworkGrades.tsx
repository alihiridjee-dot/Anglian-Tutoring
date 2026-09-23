import { Inbox, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GradesSearch, GradesView } from "@/lib/homeworkReview";
import { OutgoingReview } from "./OutgoingReview";
import { GradingReview } from "./GradingReview";

/**
 * The tutor's Homework & Grades tab: what is about to go out, and what has come
 * back.
 *
 * Both halves are the same job at different ends of a piece of homework — the
 * model did the work, a tutor checks it before a student sees it — so they sit
 * behind one switch rather than in two places. Each keeps its own filters in
 * the URL, which means switching halves and coming back loses nothing.
 */
const VIEWS: { value: GradesView; label: string; hint: string; icon: typeof Send }[] = [
  { value: "outgoing", label: "Outgoing", hint: "Review homework before it publishes", icon: Send },
  {
    value: "incoming",
    label: "Incoming",
    hint: "Check marks before students see them",
    icon: Inbox,
  },
];

export function HomeworkGrades({
  userId,
  search,
  setSearch,
}: {
  userId: string | null;
  search: GradesSearch;
  setSearch: (changes: Partial<GradesSearch>) => void;
}) {
  const view: GradesView = search.view ?? "incoming";
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2" role="tablist" aria-label="Homework and grades">
        {VIEWS.map((v) => {
          const active = v.value === view;
          return (
            <button
              key={v.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSearch({ view: v.value })}
              className={cn(
                "premium-card flex items-center gap-3 rounded-2xl p-4 text-left transition",
                active ? "tint-primary" : "tint-slate opacity-70 hover:opacity-100",
              )}
            >
              <span className={cn("icon-tile size-10 shrink-0", active && "icon-tile-solid")}>
                <v.icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-base font-bold">{v.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{v.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {view === "outgoing" ? (
        <OutgoingReview userId={userId} search={search} setSearch={setSearch} />
      ) : (
        <GradingReview userId={userId} search={search} setSearch={setSearch} />
      )}
    </div>
  );
}
