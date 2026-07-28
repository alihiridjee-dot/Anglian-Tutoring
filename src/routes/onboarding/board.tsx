import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { LEVELS, BOARDS, type LevelV, type BoardV } from "@/lib/taxonomy";
import { StepCard, ChoiceTile } from "@/components/onboarding/StepCard";
import { useCurriculumCoverage } from "@/hooks/data/useCurriculumCoverage";

/**
 * Step 1 — level and exam board.
 *
 * The board chosen here is the student's default; it rides to the subjects step
 * in the URL rather than a column, because the board is ultimately stored *per
 * subject* (a student may sit Biology with AQA and Physics with OCR) and there
 * are no enrolment rows to write it to until subjects are picked. Keeping it in
 * the URL also means a refresh mid-flow doesn't lose the answer.
 */
export const Route = createFileRoute("/onboarding/board")({
  head: () => ({ meta: [{ title: "Your exam board | Anglia Educate" }] }),
  component: BoardStep,
});

function BoardStep() {
  const navigate = useNavigate();
  const [level, setLevel] = useState<LevelV>("gcse");
  const [board, setBoard] = useState<BoardV>("edexcel");
  const [saving, setSaving] = useState(false);
  const { coverage, isPending: coverageLoading } = useCurriculumCoverage();

  const teachableLevels = coverage.levels();
  const teachableBoards = coverage.boardsFor(level);

  // Coverage arrives after the first paint, and the student may have saved a
  // combination that has since lost its curriculum. Once we know what is
  // teachable, move any stranded selection onto something that is — silently,
  // because they have not chosen anything yet at this point.
  useEffect(() => {
    if (coverageLoading || coverage.isEmpty) return;
    if (!teachableLevels.includes(level) && teachableLevels.length) {
      setLevel(teachableLevels[0]);
      return;
    }
    if (!teachableBoards.includes(board) && teachableBoards.length) setBoard(teachableBoards[0]);
  }, [coverageLoading, coverage, level, board, teachableLevels, teachableBoards]);

  // Prefill from whatever the student already told us, so coming back to this
  // step shows their answer rather than silently resetting it to the default.
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data: profile }, { data: enrolments }] = await Promise.all([
        supabase.from("profiles").select("level").eq("id", u.user.id).maybeSingle(),
        supabase.from("student_enrolments").select("board").eq("student_id", u.user.id).limit(1),
      ]);
      if (profile?.level) setLevel(profile.level as LevelV);
      // Seed the board from what they picked on the pricing page, but let
      // anything they've already saved win — and they can still change it here.
      const intendedBoard = u.user.user_metadata?.intended_board as string | undefined;
      if (enrolments?.[0]?.board) setBoard(enrolments[0].board as BoardV);
      else if (intendedBoard && BOARDS.some((b) => b.value === intendedBoard))
        setBoard(intendedBoard as BoardV);
    })();
  }, []);

  const handleContinue = async () => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("You need to be signed in.");

      const { error } = await supabase.from("profiles").update({ level }).eq("id", u.user.id);
      if (error) throw error;

      navigate({ to: "/onboarding/subjects", search: { board, level } as never });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepCard
      title="Which exam are you sitting?"
      subtitle="This scopes everything you'll see — your spec, your videos, your quizzes."
      onContinue={handleContinue}
      continueDisabled={coverageLoading || !teachableBoards.includes(board)}
      saving={saving}
    >
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Level
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {LEVELS.map((l) => {
            const available = coverageLoading || teachableLevels.includes(l.value);
            return (
              <ChoiceTile
                key={l.value}
                title={l.label}
                description={available ? undefined : "Not available yet"}
                disabled={!available}
                selected={level === l.value}
                onClick={() => setLevel(l.value)}
              />
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Exam board
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Not sure? It's on the front of your exam papers. You can change this later.
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {BOARDS.map((b) => {
            const available = coverageLoading || teachableBoards.includes(b.value);
            return (
              <ChoiceTile
                key={b.value}
                title={b.label}
                description={available ? undefined : "Not at this level yet"}
                disabled={!available}
                selected={board === b.value}
                onClick={() => setBoard(b.value)}
              />
            );
          })}
        </div>
      </div>
    </StepCard>
  );
}
