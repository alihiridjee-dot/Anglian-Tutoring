import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEntryState } from "@/hooks/useEntryState";

/**
 * One topic of a Marked tab: a slim bar with the topic's name and how much is
 * in it, opening onto the same cards Due shows.
 *
 * Folded to begin with, so a term of marks opens as a short list of topics
 * rather than one long page of cards (Ali, 7 Oct 2026). Open or folded is kept
 * with the visit, as Due's lanes are, so Back from a sheet or a quiz finds the
 * topic as it was left.
 *
 * Tasks and MCQs both use it, so the two Marked tabs read as one.
 */
export function MarkedTopic({
  stateKey,
  title,
  count,
  noun,
  children,
}: {
  /** Names the open/folded state for the visit; unique on the page. */
  stateKey: string;
  title: string;
  count: number;
  /** What the count counts, as [one, many]: ["task", "tasks"]. */
  noun: [string, string];
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useEntryState(stateKey, false);
  return (
    <section>
      <h3 className="text-sm leading-tight font-bold sm:text-base">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          className="premium-card flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left"
        >
          <span className="min-w-0 flex-1">{title}</span>
          <span className="chip shrink-0">
            <span className="numeral">{count}</span> {count === 1 ? noun[0] : noun[1]}
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-[color:var(--tint)] transition-transform",
              !open && "-rotate-90",
            )}
            aria-hidden
          />
        </button>
      </h3>
      <div id={id} hidden={!open} className="mt-3">
        {children}
      </div>
    </section>
  );
}
