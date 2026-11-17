import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/platform/errors";

// A student asks for a spec point's MCQs and task, whatever week it falls in.
// They are library content: written once by the practice queue and shared by
// every student, so a point asked for once is there for everyone after. The
// database decides everything here (public.practice_for_point and
// request_practice_for_point, 20261109170711): whether this student may ask
// (their own course, students only), whether the point already has them, and
// the day's 10 requests.

export type PracticeKind = "quiz" | "task";
type Kind = PracticeKind;
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

/**
 * A spec point's quiz and task, as the database sees them for this student,
 * and the way to ask for the ones it lacks. `enabled` is false for a tutor and
 * in the showcase, which have no student to ask as.
 */
export function usePractice(pointId: string, enabled: boolean, onReady: () => void) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: queryKey(pointId),
    enabled,
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

  const rows = enabled ? (data ?? []) : [];
  return {
    rows,
    /** Today's requests still to spend. */
    left: rows[0]?.requests_left ?? 0,
    ask: () => request.mutate(),
    asking: request.isPending,
  };
}

export type Practice = ReturnType<typeof usePractice>;

/** Where one kind stands, when the point doesn't have it yet. */
export function practiceWaiting(practice: Practice, kind: Kind): Exclude<State, "ready"> | null {
  const state = practice.rows.find((r) => r.kind === kind)?.state;
  return !state || state === "ready" ? null : state;
}

/** Two words for under a trail stop that has nothing behind it yet. */
export function practiceWord(practice: Practice, kind: Kind): string | null {
  const state = practiceWaiting(practice, kind);
  if (!state) return null;
  if (state === "writing") return "Being written";
  if (state === "failed") return "Not written";
  return practice.left > 0 ? "Request it" : "Ask tomorrow";
}

/**
 * What a Quiz or Task stop opens onto while the point has none: the Request
 * button, the pencil while it's written, or why it can't be asked for today.
 */
export function PracticePanel({ practice, kind }: { practice: Practice; kind: Kind }) {
  const state = practiceWaiting(practice, kind);
  if (!state) return null;
  const name = what([kind], false);
  const missing = practice.rows.filter((r) => r.state === "missing").map((r) => r.kind);

  if (state === "missing" && practice.left > 0)
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="font-display text-lg font-bold">No {name} yet</p>
        <button
          type="button"
          onClick={practice.ask}
          disabled={practice.asking}
          className="btn-solid min-h-11 rounded-xl px-4 py-2 text-sm"
        >
          {practice.asking ? "Asking…" : `Request ${what(missing)}`}
        </button>
      </div>
    );

  const [line, next] =
    state === "writing"
      ? [`Your ${name} ${plural([kind]) ? "are" : "is"} being written`, "Ready in a few minutes"]
      : state === "failed"
        ? [`The ${name} couldn't be written`, "Try again tomorrow"]
        : ["Today's 10 requests are used", "Ask again tomorrow"];
  return (
    <div className="flex items-center gap-4" role="status">
      {state === "writing" && (
        <span aria-hidden className="point-pencil">
          ✏️
        </span>
      )}
      <p className="font-display text-lg leading-snug font-bold">
        {line}
        <span className="block font-sans text-base font-semibold">{next}</span>
      </p>
    </div>
  );
}
