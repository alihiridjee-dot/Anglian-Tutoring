import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SUBJECTS, BOARDS, LEVELS, type BoardV, type LevelV, type SubjectV } from "@/lib/taxonomy";
import { StepCard } from "@/components/onboarding/StepCard";
import { useCurriculumCoverage } from "@/hooks/data/useCurriculumCoverage";

type SearchParams = { board?: BoardV; level?: LevelV };

/**
 * Step 2 — subjects, and the exam board for each.
 *
 * The board picked on step 1 seeds every subject here, which covers almost
 * everyone; the per-subject dropdown is the escape hatch for a student sitting
 * two boards. This is where enrolments are actually written, and enrolment is
 * what RLS scopes curriculum by — so at least one subject is required.
 */
export const Route = createFileRoute("/onboarding/subjects")({
  head: () => ({ meta: [{ title: "Your subjects | Anglia Educate" }] }),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    board: BOARDS.some((b) => b.value === search.board) ? (search.board as BoardV) : undefined,
    level: LEVELS.some((l) => l.value === search.level) ? (search.level as LevelV) : undefined,
  }),
  component: SubjectsStep,
});

function SubjectsStep() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const defaultBoard: BoardV = search.board ?? "edexcel";
  const { coverage, isPending: coverageLoading } = useCurriculumCoverage();

  const [chosen, setChosen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SUBJECTS.map((s) => [s.value, false])),
  );
  const [boards, setBoards] = useState<Record<string, BoardV>>(() =>
    Object.fromEntries(SUBJECTS.map((s) => [s.value, defaultBoard])),
  );
  // Step 1 hands the level over in the URL; a student who deep-links or
  // refreshes straight into this step gets it from their profile instead.
  const [level, setLevel] = useState<LevelV | null>(search.level ?? null);
  const [saving, setSaving] = useState(false);

  /** Boards that can teach this subject at the student's level. */
  const boardsFor = (subject: SubjectV): BoardV[] =>
    level ? coverage.boardsForSubject(level, subject) : [];

  // Prefill from existing enrolments if they're revisiting the step; otherwise
  // fall back to whatever they picked on the pricing page (stashed in auth
  // metadata at signup). Either way every choice stays editable below.
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data }, { data: profile }] = await Promise.all([
        supabase.from("student_enrolments").select("subject, board").eq("student_id", u.user.id),
        supabase.from("profiles").select("level").eq("id", u.user.id).maybeSingle(),
      ]);
      if (!search.level && profile?.level) setLevel(profile.level as LevelV);
      if (data?.length) {
        setChosen((prev) => ({
          ...prev,
          ...Object.fromEntries(data.map((r) => [r.subject, true])),
        }));
        setBoards((prev) => ({
          ...prev,
          ...Object.fromEntries(data.map((r) => [r.subject, r.board as BoardV])),
        }));
        return;
      }

      const intended = u.user.user_metadata?.intended_subjects as string | undefined;
      const picked = (intended ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => SUBJECTS.some((sub) => sub.value === s));
      if (picked.length) {
        setChosen((prev) => ({ ...prev, ...Object.fromEntries(picked.map((s) => [s, true])) }));
      }
    })();
    // Prefill runs once on mount by design — re-running it would overwrite
    // choices the student has since made on this step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move each subject onto a board that can actually teach it, and drop any
  // subject we can't teach at this level at all. This runs after coverage
  // lands, and also catches a student who came back and changed level in step
  // 1 — their saved board may not exist under the new one.
  useEffect(() => {
    if (coverageLoading || !level || coverage.isEmpty) return;
    setBoards((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of SUBJECTS) {
        const options = boardsFor(s.value);
        if (options.length && !options.includes(next[s.value])) {
          next[s.value] = options.includes(defaultBoard) ? defaultBoard : options[0];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setChosen((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of SUBJECTS) {
        if (next[s.value] && !boardsFor(s.value).length) {
          next[s.value] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverageLoading, coverage, level, defaultBoard]);

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
          const options = boardsFor(s.value);
          // While coverage is in flight, leave everything enabled rather than
          // flashing the whole list as unavailable.
          const teachable = coverageLoading || options.length > 0;
          return (
            <div
              key={s.value}
              className={`rounded-xl border p-4 transition ${
                !teachable
                  ? "border-border bg-secondary/30 opacity-55"
                  : on
                    ? "border-primary bg-primary/[0.07] ring-2 ring-primary/15"
                    : "border-border bg-background hover:border-primary/40"
              }`}
            >
              <label
                className={`flex items-center gap-3 select-none ${
                  teachable ? "cursor-pointer" : "cursor-not-allowed"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!teachable}
                  onChange={(e) => setChosen((prev) => ({ ...prev, [s.value]: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-sm font-semibold flex-1">{s.label}</span>
                {!teachable && (
                  <span className="text-[11px] text-muted-foreground">
                    Not available at your level yet
                  </span>
                )}
              </label>

              {on && (
                <div className="mt-3 pl-7 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Exam board</span>
                  <select
                    value={boards[s.value]}
                    onChange={(e) =>
                      setBoards((prev) => ({ ...prev, [s.value]: e.target.value as BoardV }))
                    }
                    className="h-8 rounded-lg premium-card px-2 text-xs transition focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  >
                    {BOARDS.filter((b) => options.includes(b.value)).map((b) => (
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
