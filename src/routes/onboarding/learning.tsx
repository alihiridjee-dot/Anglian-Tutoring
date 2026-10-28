import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useOnboardingUser } from "@/hooks/useOnboardingUser";
import { useStepPrefill } from "@/hooks/useStepPrefill";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/platform/errors";
import {
  LEARNING_QUESTIONS,
  DEFAULT_LEARNING_RESPONSES,
  type LearningResponses,
} from "@/lib/auth/onboarding";
import { StepCard } from "@/components/onboarding/StepCard";
import { ErrorNote, Spinner } from "@/components/Shared";

/**
 * Step 3 — how the student rates themselves, 1–5 per statement.
 *
 * Optional: a student who skips still gets a working account. The answers seed
 * the tutor's picture of where to start and are editable later from the profile
 * page, so they are a starting hypothesis rather than a diagnosis.
 */
export const Route = createFileRoute("/onboarding/learning")({
  head: () => ({ meta: [{ title: "How you learn | Anglia Educate" }] }),
  component: LearningStep,
});

function LearningStep() {
  const navigate = useNavigate();
  const user = useOnboardingUser();
  const [responses, setResponses] = useState<LearningResponses>(DEFAULT_LEARNING_RESPONSES);
  const [saving, setSaving] = useState(false);

  const prefill = useStepPrefill(
    async () => {
      const { data, error } = await supabase
        .from("student_learning_profile")
        .select("responses")
        .eq("student_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    (data) => {
      if (data?.responses) {
        setResponses({ ...DEFAULT_LEARNING_RESPONSES, ...(data.responses as LearningResponses) });
      }
    },
  );

  const handleContinue = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from("student_learning_profile").upsert(
        {
          student_id: user.id,
          responses,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id" },
      );
      if (error) throw dbError(error);

      navigate({ to: "/onboarding/school" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your answers — try again.");
    } finally {
      setSaving(false);
    }
  };

  const heading = {
    title: "How do you find science right now?",
    subtitle:
      "Be honest — there's no wrong answer, and it only helps your tutor pitch lessons right.",
    onBack: () => navigate({ to: "/onboarding/subjects" }),
    onSkip: () => navigate({ to: "/onboarding/school" }),
    onContinue: handleContinue,
    saving,
  };

  // Until the saved answers are in, the sliders would sit in the middle, and
  // Continue would save that over them.
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
      <div className="space-y-5">
        {LEARNING_QUESTIONS.map((q) => (
          <div key={q.id}>
            <label htmlFor={`learning-${q.id}`} className="text-sm font-medium">
              {q.prompt}
            </label>
            <input
              id={`learning-${q.id}`}
              type="range"
              min={1}
              max={5}
              step={1}
              value={responses[q.id] ?? 3}
              onChange={(e) =>
                setResponses((prev) => ({ ...prev, [q.id]: Number(e.target.value) }))
              }
              className="mt-1 h-11 w-full accent-primary"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{q.low}</span>
              <span>{q.high}</span>
            </div>
          </div>
        ))}
      </div>
    </StepCard>
  );
}
