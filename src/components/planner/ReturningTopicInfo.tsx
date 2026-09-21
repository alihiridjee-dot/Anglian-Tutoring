import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpLeft, Info } from "lucide-react";
import type { BacklogPoint } from "@/lib/planner/backlog";
import { plannerDateLabel, weekKeyToDate } from "@/lib/planner/week";

/** Topic context opens only from the information button. */
export function ReturningTopicInfo({
  title,
  points,
  onOriginalWeek,
}: {
  title: string;
  points: BacklogPoint[];
  onOriginalWeek?: (week: string, topicId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const show = () => {
    const bounds = root.current?.getBoundingClientRect();
    if (bounds) setAbove(bounds.bottom + 260 > window.innerHeight);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);

          event.stopPropagation();
        }
      }}
    >
      <div className="flex items-start gap-2">
        <h4 className="text-base font-bold leading-snug flex-1">{title}</h4>
        <button
          type="button"
          aria-label={`Why ${title} is returning`}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className="chip p-1.5 shrink-0"
          onClick={() => {
            if (open) setOpen(false);
            else show();
          }}
        >
          <Info className="size-4" aria-hidden />
        </button>
      </div>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label={`Original schedule for ${title}`}
          className={`absolute left-0 w-full sm:min-w-72 max-w-sm z-30 ${above ? "bottom-full pb-2" : "top-full pt-2"}`}
        >
          <div className="premium-card rounded-xl p-3 max-h-64 overflow-y-auto space-y-3 text-sm">
            <p className="font-bold">Returning from an earlier week</p>
            {points.map((point) => (
              <div key={point.specPointId} className="space-y-1.5">
                <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                  <span className="chip numeral">{point.code}</span>
                  Planned for{" "}
                  {plannerDateLabel(weekKeyToDate(point.plannedWeek), {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
                {onOriginalWeek && (
                  <button
                    type="button"
                    className="btn-premium rounded-lg px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5"
                    onClick={() => {
                      setOpen(false);

                      onOriginalWeek(point.plannedWeek, point.topicId);
                    }}
                  >
                    <ArrowUpLeft className="size-3.5" aria-hidden />
                    View original week<span className="sr-only"> for {point.code}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
