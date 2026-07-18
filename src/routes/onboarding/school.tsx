import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { gradeOptions, completeOnboarding } from "@/lib/onboarding";
import { SUBJECTS, type LevelV, type SubjectV } from "@/lib/taxonomy";
import { StepCard } from "@/components/onboarding/StepCard";

type Grades = { previous_grade: string; current_grade: string; target_grade: string };
const EMPTY: Grades = { previous_grade: "", current_grade: "", target_grade: "" };

/**
 * Step 4 — school and grades, all optional, and the end of data collection.
 *
 * Grades are per-subject because that's how they're taught, sat and reported;
 * they're stored on the enrolment rows written in step 2, so only the subjects
 * the student actually picked are asked about.
 *
 * This step (whether completed or skipped) is what marks setup finished — the
 * flag the route guard reads. Setting it earlier would let a student who
 * abandoned mid-flow bypass the rest.
 */
export const Route = createFileRoute("/onboarding/school")({
  head: () => ({ meta: [{ title: "School & grades | Anglian Learning" }] }),
  component: SchoolStep,
});

function SchoolStep() {
  const navigate = useNavigate();
  const [school, setSchool] = useState("");
  const [level, setLevel] = useState<LevelV | null>(null);
  const [subjects, setSubjects] = useState<SubjectV[]>([]);
  const [grades, setGrades] = useState<Record<string, Grades>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data: profile }, { data: enrolments }] = await Promise.all([
        supabase.from("profiles").select("school, level").eq("id", u.user.id).maybeSingle(),
        supabase
          .from("student_enrolments")
          .select("subject, previous_grade, current_grade, target_grade")
          .eq("student_id", u.user.id)
          .order("subject"),
      ]);
      if (profile?.school) setSchool(profile.school);
      setLevel((profile?.level ?? null) as LevelV | null);
      setSubjects((enrolments ?? []).map((r) => r.subject as SubjectV));
      setGrades(
        Object.fromEntries(
          (enrolments ?? []).map((r) => [
            r.subject as string,
            {
              previous_grade: r.previous_grade ?? "",
              current_grade: r.current_grade ?? "",
              target_grade: r.target_grade ?? "",
            },
          ]),
        ),
      );
    })();
  }, []);

  const finish = async (save: boolean) => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("You need to be signed in.");
      const uid = u.user.id;

      if (save) {
        const { error: profErr } = await supabase
          .from("profiles")
          .update({ school: school.trim() || null })
          .eq("id", uid);
        if (profErr) throw profErr;

        // One update per subject rather than an upsert: these rows already
        // exist from step 2, and an upsert would need the board again to
        // satisfy its NOT NULL — re-sending it risks overwriting a per-subject
        // board with a stale value.
        for (const subject of subjects) {
          const g = grades[subject] ?? EMPTY;
          const { error } = await supabase
            .from("student_enrolments")
            .update({
              previous_grade: g.previous_grade || null,
              current_grade: g.current_grade || null,
              target_grade: g.target_grade || null,
            })
            .eq("student_id", uid)
            .eq("subject", subject);
          if (error) throw error;
        }
      }

      await completeOnboarding(uid);
      navigate({ to: "/onboarding/plan" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that — try again.");
    } finally {
      setSaving(false);
    }
  };

  const options = gradeOptions(level);
  const label = SUBJECTS.reduce<Record<string, string>>(
    (acc, s) => ({ ...acc, [s.value]: s.label }),
    {},
  );

  return (
    <StepCard
      title="Where are you now, and where do you want to be?"
      subtitle="All optional — but target grades let your tutor track you against something real."
      onBack={() => navigate({ to: "/onboarding/confidence" })}
      onSkip={() => finish(false)}
      onContinue={() => finish(true)}
      continueLabel="Continue to payment"
      saving={saving}
    >
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          School or college
        </label>
        <input
          value={school}
          onChange={(e) => setSchool(e.target.value)}
          placeholder="e.g. Cambridge Academy"
          className="mt-1 w-full h-10 rounded-lg bg-muted border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {subjects.length > 0 && (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Grades
          </label>
          <p className="mt-1 mb-2 text-xs text-muted-foreground">
            Leave anything blank if you don't know it or haven't sat it yet.
          </p>
          <div className="space-y-3">
            {subjects.map((subject) => (
              <div key={subject} className="rounded-xl border border-border bg-muted/40 p-3">
                <div className="text-sm font-semibold mb-2">{label[subject] ?? subject}</div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["previous_grade", "Previous"],
                      ["current_grade", "Current"],
                      ["target_grade", "Target"],
                    ] as const
                  ).map(([key, text]) => (
                    <div key={key}>
                      <span className="text-[11px] text-muted-foreground">{text}</span>
                      <select
                        value={grades[subject]?.[key] ?? ""}
                        onChange={(e) =>
                          setGrades((prev) => ({
                            ...prev,
                            [subject]: { ...(prev[subject] ?? EMPTY), [key]: e.target.value },
                          }))
                        }
                        className="mt-0.5 w-full h-9 rounded-lg bg-card border border-border px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        <option value="">—</option>
                        {options.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </StepCard>
  );
}
