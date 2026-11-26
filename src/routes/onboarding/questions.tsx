import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { StepCard } from "@/components/onboarding/StepCard";
import { QuestionLoadPicker } from "@/components/practice/QuestionLoadPicker";
import { ErrorNote, Spinner } from "@/components/Shared";
import { useOnboardingUser } from "@/hooks/useOnboardingUser";
import { useStepPrefill } from "@/hooks/useStepPrefill";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/platform/errors";
import {
  DEFAULT_QUESTION_LOAD,
  TOPICS_PER_WEEK_PER_SUBJECT,
  isQuestionLoad,
  type QuestionLoad,
} from "@/lib/practice/questionLoad";

/**
 * Step 4 — how many of each topic's questions the student wants: Reduced,
 * Normal or Enhanced (`profiles.question_load`).
 *
 * Normal is picked already, and is what every student had before the levels,
 * so Continue with nothing touched changes nothing. There is no plan yet to
 * count a week from, so the minutes a day are worked from one topic a day for
 * each subject chosen on step 2. The profile page changes the level later,
 * and counts the real week.
 */
export const Route = createFileRoute("/onboarding/questions")({
  head: () => ({ meta: [{ title: "Questions | Anglia Educate" }] }),
  component: QuestionsStep,
});

function QuestionsStep() {
  const navigate = useNavigate();
  const user = useOnboardingUser();
  const [load, setLoad] = useState<QuestionLoad>(DEFAULT_QUESTION_LOAD);
  const [subjects, setSubjects] = useState(1);
  const [saving, setSaving] = useState(false);

  const prefill = useStepPrefill(
    async () => {
      const [profile, enrolments] = await Promise.all([
        supabase.from("profiles").select("question_load").eq("id", user.id).maybeSingle(),
        supabase
          .from("student_enrolments")
          .select("subject", { count: "exact", head: true })
          .eq("student_id", user.id),
      ]);
      if (profile.error) throw profile.error;
      if (enrolments.error) throw enrolments.error;
      return { load: profile.data?.question_load, subjects: enrolments.count ?? 0 };
    },
    (saved) => {
      if (isQuestionLoad(saved.load)) setLoad(saved.load);
      // Reached without a subject (a deep link): the times are for one.
      setSubjects(Math.max(1, saved.subjects));
    },
  );

  const handleContinue = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ question_load: load })
        .eq("id", user.id);
      if (error) throw dbError(error);
      navigate({ to: "/onboarding/school" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your choice. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const heading = {
    title: "How many questions do you want?",
    onBack: () => navigate({ to: "/onboarding/learning" }),
    onContinue: handleContinue,
    saving,
  };

  // Until the saved level is in, Normal would show, and Continue would save it
  // over the level a returning student had picked.
  if (!prefill.ready) {
    return (
      <StepCard {...heading} continueDisabled>
        {prefill.error ? (
          <ErrorNote error={prefill.error} onRetry={prefill.retry} />
        ) : (
          <Spinner className="py-10" />
        )}
      </StepCard>
    );
  }

  return (
    <StepCard {...heading}>
      <QuestionLoadPicker
        value={load}
        onChange={setLoad}
        topicsPerWeek={subjects * TOPICS_PER_WEEK_PER_SUBJECT}
      />
      <p className="font-medium">You can change this any time on your profile</p>
    </StepCard>
  );
}
