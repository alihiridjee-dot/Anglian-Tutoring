import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  LEARNING_QUESTIONS,
  DEFAULT_LEARNING_RESPONSES,
  type LearningResponses,
} from "@/lib/onboarding";
import { StepCard } from "@/components/onboarding/StepCard";

/**
 * Step 3 — how the student rates themselves, 1–5 per statement.
 *
 * Optional: a student who skips still gets a working account. The answers seed
 * the tutor's picture of where to start and are editable later from the profile
 * page, so they are a starting hypothesis rather than a diagnosis.
 */
export const Route = createFileRoute("/onboarding/learning")({
  head: () => ({ meta: [{ title: "How you learn | Anglian Learning" }] }),
  component: LearningStep,
});

function LearningStep() {
  const navigate = useNavigate();
  const [responses, setResponses] = useState<LearningResponses>(DEFAULT_LEARNING_RESPONSES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("student_learning_profile")
        .select("responses")
        .eq("student_id", u.user.id)
        .maybeSingle();
      if (data?.responses) {
        setResponses({ ...DEFAULT_LEARNING_RESPONSES, ...(data.responses as LearningResponses) });
      }
    })();
  }, []);

  const handleContinue = async () => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("You need to be signed in.");

      const { error } = await supabase.from("student_learning_profile").upsert(
        {
          student_id: u.user.id,
          responses,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id" },
      );
      if (error) throw error;

      navigate({ to: "/onboarding/confidence" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your answers — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepCard
      title="How do you find science right now?"
      subtitle="Be honest — there's no wrong answer, and it only helps your tutor pitch lessons right."
      onBack={() => navigate({ to: "/onboarding/subjects" })}
      onSkip={() => navigate({ to: "/onboarding/confidence" })}
      onContinue={handleContinue}
      saving={saving}
    >
      <div className="space-y-5">
        {LEARNING_QUESTIONS.map((q) => (
          <div key={q.id}>
            <label className="text-sm font-medium">{q.prompt}</label>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={responses[q.id] ?? 3}
              onChange={(e) =>
                setResponses((prev) => ({ ...prev, [q.id]: Number(e.target.value) }))
              }
              className="mt-2 w-full accent-primary"
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
