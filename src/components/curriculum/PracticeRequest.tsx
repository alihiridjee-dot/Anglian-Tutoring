import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Spinner } from "@/components/Shared";
import { dbError } from "@/lib/platform/errors";

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
  if (missing.length + inProgress.length + failed.length === 0) return null;
  const left = data[0].requests_left;

  const title =
    inProgress.length > 0
      ? `Writing your ${what(inProgress, false)}`
      : missing.length > 0
        ? `No ${what(missing, false).replace(" and ", " or ")} for this point yet`
        : `The ${what(failed, false)} couldn't be written`;

  return (
    <section className="premium-card flex flex-wrap items-center gap-3 rounded-2xl p-4">
      <span className="icon-tile size-11 shrink-0">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <span className="eyebrow eyebrow-bare block text-[10px]">Practice</span>
        <h3 className="text-base leading-tight font-extrabold">{title}</h3>
        {inProgress.length > 0 && (
          <p className="text-sm">
            {plural(inProgress) ? "They'll" : "It'll"} be here in a few minutes. You can leave this
            page.
          </p>
        )}
        {missing.length > 0 && left === 0 && (
          <p className="text-sm">
            You've used today's 10 requests. Ask for this point's {what(missing, false)} tomorrow.
          </p>
        )}
        {failed.length > 0 && (
          <p className="text-sm">
            {inProgress.length + missing.length > 0
              ? `The ${what(failed, false)} couldn't be written today. `
              : ""}
            Try again tomorrow.
          </p>
        )}
      </div>
      {inProgress.length > 0 && <Spinner label="Writing" className="py-0" />}
      {missing.length > 0 && left > 0 && (
        <button
          type="button"
          onClick={() => request.mutate()}
          disabled={request.isPending}
          className="btn-solid inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60 sm:w-auto"
        >
          <Sparkles className="size-4" aria-hidden />
          {request.isPending ? "Asking…" : `Request ${what(missing)}`}
        </button>
      )}
    </section>
  );
}
