import { ChevronDown, Repeat } from "lucide-react";

export function EmptyRevision({ isPast = false }: { isPast?: boolean }) {
  return (
    <details className="tint-rose group/revision">
      <summary className="eyebrow eyebrow-bare text-xs list-none cursor-pointer flex items-center gap-2 [&::-webkit-details-marker]:hidden">
        <Repeat className="size-4 shrink-0" aria-hidden />
        <span>Revision · {isPast ? "None shown" : "Nothing due"}</span>
        <ChevronDown
          className="size-4 ml-auto shrink-0 -rotate-90 group-open/revision:rotate-0"
          aria-hidden
        />
      </summary>
      <p className="mt-3 pl-6 text-sm text-muted-foreground">
        {isPast
          ? "No revision is shown for this week."
          : "No reviews are assigned. Your assessed practice determines when points return for revision."}
      </p>
    </details>
  );
}
