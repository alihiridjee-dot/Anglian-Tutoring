import { useId, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Hourglass,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Scale,
} from "lucide-react";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { cn } from "@/lib/utils";
import { type PlanAttention as Attention } from "./formatSchedule";
import { useAddMissedToWeek } from "./useAddMissedToWeek";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Everything on the plan that wants the tutor, in one place, one line each.
 *
 * These used to be four separate boxes, each with its own paragraph: missed
 * work, a plan too big for the time left (shown twice, once per box), a
 * re-plan waiting to apply, and catch-up that will not fit. A tutor reading
 * forty students needs the list, not the essay — so each problem is a line
 * with its own action or its own "see which", and the detail stays folded
 * until asked for. Nothing renders when there is nothing to act on.
 */
export function PlanAttention({
  attention,
  studentName,
  course,
  onChanged,
}: {
  attention: Attention;
  studentName: string;
  course: { studentId: string; subject: SubjectV; board: BoardV; level: LevelV };
  onChanged: () => Promise<void> | void;
}) {
  const headingId = useId();
  const { busy, add } = useAddMissedToWeek({ course, onAdded: onChanged });
  const { missed, heldCount, overload, moved } = attention;

  // "2 reviews and 1 topic have no week left" — only the parts that exist.
  const overloadCount = overload ? overload.reviews.length + overload.topics.length : 0;
  const overloadParts = overload
    ? [
        overload.reviews.length > 0 && plural(overload.reviews.length, "review"),
        overload.topics.length > 0 && plural(overload.topics.length, "topic"),
      ].filter(Boolean)
    : [];

  return (
    <section
      aria-labelledby={headingId}
      className="tint-amber rounded-xl border border-[color:color-mix(in_oklab,var(--tint)_30%,var(--border))] bg-[color:color-mix(in_oklab,var(--tint)_5%,var(--card))]"
    >
      <h3 id={headingId} className="flex items-center gap-2 px-4 pb-1 pt-3 text-sm font-bold">
        <AlertTriangle className="size-4 text-[color:var(--tint)]" aria-hidden />
        Needs attention
      </h3>
      <ul className="divide-y divide-[color:color-mix(in_oklab,var(--tint)_18%,var(--border))]">
        {missed.map((topic) => (
          <AttentionItem
            key={topic.topicId}
            icon={History}
            title={`${topic.title}: ${plural(topic.specPointIds.length, "missed point")}`}
            meta={`Due since ${topic.since}`}
            action={
              <button
                type="button"
                onClick={() => add(topic)}
                disabled={busy !== null}
                className="btn-soft inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs"
              >
                {busy === topic.topicId ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Plus className="size-3.5" aria-hidden />
                )}
                Add to this week
              </button>
            }
          />
        ))}

        {heldCount > 0 && (
          <AttentionItem
            icon={Hourglass}
            title={`${plural(heldCount, "missed point")} won't fit before the exam`}
            meta="At the current catch-up pace"
          />
        )}

        {overload && (
          <AttentionItem
            icon={Scale}
            title="The plan doesn't fit before the exam"
            meta={
              overloadCount > 0
                ? `${overloadParts.join(" and ")} ${overloadCount === 1 ? "has" : "have"} no week left`
                : undefined
            }
            details={
              overloadCount > 0
                ? {
                    label: "See what's left over",
                    items: [
                      ...overload.reviews.map((p) => ({
                        key: p.specPointId,
                        content: (
                          <>
                            <span className="mr-1.5 text-[11px] font-semibold text-muted-foreground">
                              {p.code}
                            </span>
                            {p.title}
                          </>
                        ),
                      })),
                      ...overload.topics.map((t) => ({
                        key: `topic:${t}`,
                        content: (
                          <>
                            {t}
                            <span className="text-muted-foreground"> — needs teaching time</span>
                          </>
                        ),
                      })),
                    ],
                  }
                : undefined
            }
          />
        )}

        {moved && (
          <AttentionItem
            icon={RefreshCw}
            title={`The plan has changed: ${plural(moved.length, "topic")} moved`}
            meta={`Takes effect when ${studentName} next opens their planner`}
            details={{
              label: "See what moved",
              items: moved.map((m) => ({
                key: m.topicId,
                content: (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold">{m.title}</span>
                    <span className="text-muted-foreground">
                      {m.from ? `week of ${m.from}` : "newly added"}
                    </span>
                    <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
                    <span className="font-semibold text-[color:var(--tint)]">week of {m.to}</span>
                  </span>
                ),
              })),
            }}
          />
        )}
      </ul>
    </section>
  );
}

/** One problem: an icon, what it is, one line of fact, and its action or its list. */
function AttentionItem({
  icon: Icon,
  title,
  meta,
  action,
  details,
}: {
  icon: typeof History;
  title: string;
  meta?: string;
  action?: ReactNode;
  details?: { label: string; items: { key: string; content: ReactNode }[] };
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="icon-tile size-8 shrink-0">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-sm font-semibold leading-snug">{title}</p>
          {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
        </div>
        {action}
        {details && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            className="btn-ghost inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs"
          >
            {details.label}
            <ChevronDown
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
              aria-hidden
            />
          </button>
        )}
      </div>
      {open && details && (
        <ul id={listId} className="mt-2 space-y-1 pl-11 text-sm">
          {details.items.map((item) => (
            <li key={item.key}>{item.content}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
