import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SUBJECTS, BOARDS, type BoardV } from "@/lib/taxonomy";
import { StepCard } from "@/components/onboarding/StepCard";

type SearchParams = { board?: BoardV };

/**
 * Step 2 — subjects, and the exam board for each.
 *
 * The board picked on step 1 seeds every subject here, which covers almost
 * everyone; the per-subject dropdown is the escape hatch for a student sitting
 * two boards. This is where enrolments are actually written, and enrolment is
 * what RLS scopes curriculum by — so at least one subject is required.
 */
export const Route = createFileRoute("/onboarding/subjects")({
  head: () => ({ meta: [{ title: "Your subjects | Anglian Learning" }] }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    board: BOARDS.some((b) => b.value === search.board) ? (search.board as BoardV) : undefined,
  }),
  component: SubjectsStep,
});

function SubjectsStep() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const defaultBoard: BoardV = search.board ?? "edexcel";

  const [chosen, setChosen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SUBJECTS.map((s) => [s.value, false])),
  );
  const [boards, setBoards] = useState<Record<string, BoardV>>(() =>
    Object.fromEntries(SUBJECTS.map((s) => [s.value, defaultBoard])),
  );
  const [saving, setSaving] = useState(false);

  // Prefill from existing enrolments if they're revisiting the step.
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("student_enrolments")
        .select("subject, board")
        .eq("student_id", u.user.id);
      if (!data?.length) return;
      setChosen((prev) => ({
        ...prev,
        ...Object.fromEntries(data.map((r) => [r.subject, true])),
      }));
      setBoards((prev) => ({
        ...prev,
        ...Object.fromEntries(data.map((r) => [r.subject, r.board as BoardV])),
      }));
    })();
  }, []);

  const selected = SUBJECTS.filter((s) => chosen[s.value]);

  const handleContinue = async () => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("You need to be signed in.");
      const uid = u.user.id;

      // Drop de-selected subjects first: a student narrowing from three
      // subjects to one must actually lose access to the other two, and an
      // upsert alone would leave those rows in place.
      const keep = selected.map((s) => s.value);
      const del = supabase.from("student_enrolments").delete().eq("student_id", uid);
      const { error: delErr } = await (keep.length
        ? del.not("subject", "in", `(${keep.join(",")})`)
        : del);
      if (delErr) throw delErr;

      const { error: upErr } = await supabase.from("student_enrolments").upsert(
        selected.map((s) => ({
          student_id: uid,
          subject: s.value,
          board: boards[s.value],
        })),
        { onConflict: "student_id,subject" },
      );
      if (upErr) throw upErr;

      // enrolled_courses is the denormalised subject list many reads still use;
      // it has to move in step with the enrolment rows or the two disagree.
      const { error: profErr } = await supabase
        .from("profiles")
        .update({ enrolled_courses: keep })
        .eq("id", uid);
      if (profErr) throw profErr;

      queryClient.invalidateQueries({ queryKey: ["user-enrolments-and-profile"] });
      navigate({ to: "/onboarding/learning" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your subjects — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepCard
      title="What do you need help with?"
      subtitle="Pick every subject you're studying with us. You can add more later."
      onBack={() => navigate({ to: "/onboarding/board" })}
      onContinue={handleContinue}
      continueDisabled={selected.length === 0}
      saving={saving}
    >
      <div className="space-y-2">
        {SUBJECTS.map((s) => {
          const on = chosen[s.value];
          return (
            <div
              key={s.value}
              className={`rounded-xl border p-4 transition ${
                on ? "border-primary bg-primary/10" : "border-border bg-muted/40"
              }`}
            >
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setChosen((prev) => ({ ...prev, [s.value]: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-sm font-semibold flex-1">{s.label}</span>
              </label>

              {on && (
                <div className="mt-3 pl-7 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Exam board</span>
                  <select
                    value={boards[s.value]}
                    onChange={(e) =>
                      setBoards((prev) => ({ ...prev, [s.value]: e.target.value as BoardV }))
                    }
                    className="h-8 rounded-lg bg-card border border-border px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {BOARDS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                  {boards[s.value] !== defaultBoard && (
                    <span className="text-[11px] text-muted-foreground">
                      differs from your main board
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="text-xs text-muted-foreground">Pick at least one subject to continue.</p>
      )}
    </StepCard>
  );
}
