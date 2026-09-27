import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** One expandable point row across the weekly assignment and the full plan. */
export function PlannerPointItem({
  code,
  title,
  status,
  children,
}: {
  code: string;
  title: string;
  status?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <details className="premium-card planner-point-row group/point">
      <summary className="list-none cursor-pointer px-2.5 py-2 min-h-11 sm:min-h-0 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="size-4 mt-0.5 shrink-0 -rotate-90 transition-transform group-open/point:rotate-0"
        />
        <span className="flex-1 min-w-0">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">{code}</span>
          <span className="text-sm">{title}</span>
        </span>
      </summary>
      <div className="mx-2.5 mb-2.5 pt-3 border-t border-border space-y-3 text-sm">
        {status}
        {children}
      </div>
    </details>
  );
}
