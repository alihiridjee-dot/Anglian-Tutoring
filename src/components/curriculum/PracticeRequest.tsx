import { useEffect, useRef, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, Plus, Sparkles, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Spinner } from "@/components/Shared";
import { dbError } from "@/lib/platform/errors";
import { cn } from "@/lib/utils";

// A student asks for a spec point's MCQs and task, whatever week it falls in.
// They are library content: written once by the practice queue and shared by
// every student, so a point asked for once is there for everyone after. The
// database decides everything here (public.practice_for_point and
// request_practice_for_point, 20261109170711): whether this student may ask
// (their own course, students only), whether the point already has them, and
// the day's 10 requests.

type Kind = "quiz" | "task";
type State = "ready" | "writing" | "failed" | "missing";
type Row = { kind: Kind; state: State; requests_left: number };

/** While anything is being written, look again this often. */
const POLL_MS = 15_000;

const queryKey = (pointId: string) => ["practice-for-point", pointId] as const;

/** "MCQs and a task", "MCQs", "a task". */
function what(kinds: Kind[], article = true) {
  const words = kinds.map((k) => (k === "quiz" ? "MCQs" : article ? "a task" : "task"));
  return words.join(" and ");
}

/** "MCQs or task", "MCQs", "task": for "No … yet". */
const whatOr = (kinds: Kind[]) => what(kinds, false).replace(" and ", " or ");

/** MCQs are plural; a task on its own isn't. */
const plural = (kinds: Kind[]) => kinds.length > 1 || kinds[0] === "quiz";

export function PracticeRequest({ pointId, onReady }: { pointId: string; onReady: () => void }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: queryKey(pointId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("practice_for_point", {
        _spec_point_id: pointId,
      });
      if (error) throw dbError(error);
      return (data ?? []) as Row[];
    },
    // Looked at afresh each time the point opens: another student may have
    // asked for it, or it may have arrived, since.
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.some((r) => r.state === "writing") ? POLL_MS : false),
  });

  const request = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("request_practice_for_point", {
        _spec_point_id: pointId,
      });
      if (error) throw dbError(error);
      return (data ?? []) as Row[];
    },
    onSuccess: (rows) => queryClient.setQueryData(queryKey(pointId), rows),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't ask for them"),
  });

  // Something that was being written while the page was open has arrived:
  // load the point's quizzes and tasks again, and say so.
  const writing = useRef<Set<Kind>>(new Set());
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (!data) return;
    const arrived = data.filter((r) => r.state === "ready" && writing.current.has(r.kind));
    writing.current = new Set(data.filter((r) => r.state === "writing").map((r) => r.kind));
    if (arrived.length === 0) return;
    onReadyRef.current();
    const kinds = arrived.map((r) => r.kind);
    toast.success(`Your ${what(kinds, false)} ${plural(kinds) ? "are" : "is"} ready`);
  }, [data]);

  if (!data || data.length === 0) return null;
  const of = (state: State) => data.filter((r) => r.state === state).map((r) => r.kind);
  const missing = of("missing");
  const inProgress = of("writing");
  const failed = of("failed");
  const left = data[0].requests_left;

  // One tile per thing to say. Usually that's one: Request, then Writing,
  // then nothing (the point's MCQs and task are in the sections below).
  return (
    <>
      {missing.length > 0 && left > 0 && (
        <button
          type="button"
          onClick={() => request.mutate()}
          disabled={request.isPending}
          className={TILE}
        >
          <TileBody
            icon={Sparkles}
            label={`No ${whatOr(missing)} yet`}
            line={request.isPending ? "Asking…" : `Request ${what(missing)}`}
            end={
              <span className="when-link-arrow" aria-hidden>
                <Plus className="size-4" strokeWidth={3} />
              </span>
            }
          />
        </button>
      )}
      {inProgress.length > 0 && (
        <div className={TILE} role="status">
          <TileBody
            icon={Sparkles}
            label={`Writing your ${what(inProgress, false)}`}
            line="Ready in a few minutes"
            end={<Spinner compact label={`Writing your ${what(inProgress, false)}`} />}
          />
        </div>
      )}
      {missing.length > 0 && left === 0 && (
        <div className={cn(TILE, "tint-slate")}>
          <TileBody icon={Clock} label="Today's 10 requests used" line="Ask again tomorrow" />
        </div>
      )}
      {failed.length > 0 && (
        <div className={cn(TILE, "tint-rose")}>
          <TileBody
            icon={AlertTriangle}
            label={`${what(failed, false)} couldn't be written`}
            line="Try again tomorrow"
          />
        </div>
      )}
    </>
  );
}

/** The "Planned for" tile's shape (WhenLink), so the two sit side by side. */
const TILE =
  "when-link flex w-full items-center gap-3 p-2.5 pr-3 text-left sm:w-auto sm:min-w-72 sm:inline-flex";

function TileBody({
  icon: Icon,
  label,
  line,
  end,
}: {
  icon: LucideIcon;
  label: string;
  line: string;
  end?: ReactNode;
}) {
  return (
    <>
      <span className="icon-tile size-11 shrink-0">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="eyebrow eyebrow-bare block text-[10px]">{label}</span>
        <span className="font-display mt-1 block text-base leading-tight font-extrabold">
          {line}
        </span>
      </span>
      {end}
    </>
  );
}
