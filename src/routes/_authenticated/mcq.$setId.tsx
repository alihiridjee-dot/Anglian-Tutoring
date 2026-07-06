import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/mcq/$setId")({
  head: () => ({ meta: [{ title: "MCQ | StudyHub" }] }),
  component: TakeMcq,
});

type Q = {
  id: string;
  position: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
};
type SetRow = { id: string; title: string; description: string | null; published: boolean };

function TakeMcq() {
  const { setId } = useParams({ from: "/_authenticated/mcq/$setId" });
  const { userId } = useRoles();
  const [set, setSet] = useState<SetRow | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    const isDemo =
      typeof window !== "undefined" && localStorage.getItem("studyhub:is-demo") === "true";
    if (isDemo) {
      if (setId === "mcq-photosynthesis-chloroplasts") {
        setSet({
          id: "mcq-photosynthesis-chloroplasts",
          title: "GCSE Biology: Photosynthesis & Chloroplasts",
          description:
            "AQA GCSE Science specification point 4.4.1 - Cover chemical formulas, limiting factor rate graphs, and cellular transport structures.",
          published: true,
        });
        setQuestions([
          {
            id: "q1",
            position: 1,
            question:
              "Which of the following is the correct balanced chemical equation for photosynthesis?",
            options: [
              "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂",
              "C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O",
              "CO₂ + H₂O → CH₂O + O₂",
              "6CO₂ + 6O₂ → C₆H₁₂O₆ + 6H₂O",
            ],
            correct_index: 0,
            explanation:
              "Photosynthesis takes carbon dioxide (CO₂) and water (H₂O) in the presence of light and chlorophyll to produce glucose (C₆H₁₂O₆) and oxygen (O₂) as a byproduct.",
          },
          {
            id: "q2",
            position: 2,
            question:
              "What is the principal limiting factor of photosynthesis on a warm, bright, sunny summer afternoon?",
            options: [
              "Light intensity",
              "Temperature",
              "Carbon dioxide concentration",
              "Water availability",
            ],
            correct_index: 2,
            explanation:
              "On a warm, bright summer afternoon, both temperature and light intensity are high and abundant. Therefore, the atmospheric concentration of carbon dioxide (about 0.04%) becomes the limiting factor restricting further rate increase.",
          },
          {
            id: "q3",
            position: 3,
            question:
              "Where do the light-dependent reactions of photosynthesis take place within the chloroplast?",
            options: [
              "In the stroma",
              "Within the thylakoid membrane (grana)",
              "On the outer chloroplast membrane",
              "Inside the mitochondria",
            ],
            correct_index: 1,
            explanation:
              "Chlorophyll molecules are embedded within the thylakoid membranes (stacked to form grana), where light absorption and water splitting occur during the light-dependent stage. The stroma is where the light-independent (Calvin cycle) reactions occur.",
          },
        ]);
      } else if (setId === "mcq-chemistry-electrolysis") {
        setSet({
          id: "mcq-chemistry-electrolysis",
          title: "GCSE Chemistry: Electrolysis and Ionic Equations",
          description:
            "Edexcel Topic 4 - Covering extraction pathways, inert electrodes, molten salts, and half-equations at the cathode and anode.",
          published: true,
        });
        setQuestions([
          {
            id: "q_c1",
            position: 1,
            question:
              "During the electrolysis of aqueous sodium chloride, what gas is discharged at the anode?",
            options: [
              "Sodium metal vapor",
              "Hydrogen gas (H₂)",
              "Oxygen gas (O₂)",
              "Chlorine gas (Cl₂)",
            ],
            correct_index: 3,
            explanation:
              "At the anode (positive electrode), negative ions are attracted. Since chloride ions are present in high concentration, they are oxidised to chlorine gas (2Cl⁻ → Cl₂ + 2e⁻).",
          },
        ]);
      } else {
        setSet({
          id: "mcq-physics-nuclear",
          title: "GCSE Physics: Nuclear Fission, Fusion and Decay",
          description:
            "OCR P6 - Half-lives, alpha/beta/gamma decay, nuclear stability, and star combustion cycles.",
          published: true,
        });
        setQuestions([
          {
            id: "q_p1",
            position: 1,
            question:
              "What type of radiation consists of high-energy electromagnetic waves with the greatest penetrating power?",
            options: [
              "Alpha particles (α)",
              "Beta minus particles (β⁻)",
              "Gamma rays (γ)",
              "Neutron emissions",
            ],
            correct_index: 2,
            explanation:
              "Gamma rays are high-frequency electromagnetic waves. They have no charge or mass, allowing them to easily pass through body tissues and requiring thick lead or several meters of concrete to stop.",
          },
        ]);
      }
      return;
    }

    (async () => {
      const { data: s } = await supabase
        .from("mcq_sets")
        .select("id, title, description, published")
        .eq("id", setId)
        .maybeSingle();
      setSet(s as SetRow | null);
      const { data: qs } = await supabase
        .from("mcq_questions")
        .select("id, position, question, options, correct_index, explanation")
        .eq("set_id", setId)
        .order("position");
      setQuestions((qs ?? []).map((q) => ({ ...q, options: q.options as string[] })));
    })();
  }, [setId]);

  const submit = async () => {
    const isDemo =
      typeof window !== "undefined" && localStorage.getItem("studyhub:is-demo") === "true";
    let correct = 0;
    for (const q of questions) if (answers[q.id] === q.correct_index) correct += 1;
    setScore(correct);
    setSubmitted(true);

    if (isDemo) {
      toast.success(`Scored ${correct}/${questions.length} on Demo Quiz!`);
      return;
    }

    if (!userId || questions.length === 0) return;
    const { error } = await supabase.from("mcq_attempts").insert({
      set_id: setId,
      user_id: userId,
      score: correct,
      total: questions.length,
      answers,
    });
    if (error) toast.error(error.message);
    else toast.success(`Scored ${correct}/${questions.length}`);
  };

  if (!set) return <AppLayout title="MCQ">Loading…</AppLayout>;

  return (
    <AppLayout title={set.title}>
      <div className="max-w-3xl">
        {set.description && <p className="text-sm text-muted-foreground mb-6">{set.description}</p>}
        <ol className="space-y-5">
          {questions.map((q, idx) => {
            const chosen = answers[q.id];
            return (
              <li key={q.id} className="rounded-2xl bg-card border border-border p-5">
                <p className="text-xs uppercase tracking-widest text-primary font-semibold">
                  Question {idx + 1}
                </p>
                <p className="font-display text-lg mt-1">{q.question}</p>
                <div className="mt-3 space-y-2">
                  {q.options.map((opt, i) => {
                    const isChosen = chosen === i;
                    const isCorrect = submitted && i === q.correct_index;
                    const isWrong = submitted && isChosen && i !== q.correct_index;
                    return (
                      <button
                        key={i}
                        disabled={submitted}
                        onClick={() => setAnswers({ ...answers, [q.id]: i })}
                        className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition ${
                          isCorrect
                            ? "bg-primary/15 border-primary text-foreground"
                            : isWrong
                              ? "bg-destructive/10 border-destructive/50"
                              : isChosen
                                ? "bg-secondary border-primary/50"
                                : "bg-secondary/40 border-border hover:border-primary/40"
                        }`}
                      >
                        <span className="font-mono text-xs mr-2 text-muted-foreground">
                          {String.fromCharCode(65 + i)}.
                        </span>
                        {opt}
                        {isCorrect && <CheckCircle2 className="w-4 h-4 text-primary inline ml-2" />}
                        {isWrong && <XCircle className="w-4 h-4 text-destructive inline ml-2" />}
                      </button>
                    );
                  })}
                </div>
                {submitted && q.explanation && (
                  <p className="mt-3 text-xs text-muted-foreground border-t border-border pt-3">
                    <span className="font-semibold text-foreground">Explanation:</span>{" "}
                    {q.explanation}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        {!submitted ? (
          <button
            onClick={submit}
            disabled={Object.keys(answers).length !== questions.length}
            className="mt-6 w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
          >
            Submit answers
          </button>
        ) : (
          <div className="mt-6 rounded-2xl bg-card border border-border p-6 text-center">
            <p className="text-xs uppercase tracking-widest text-primary font-semibold">
              Your score
            </p>
            <p className="font-display text-4xl font-semibold mt-1">
              {score}/{questions.length}
            </p>
            <Link
              to="/curriculum"
              className="mt-4 inline-block text-sm text-primary hover:underline"
            >
              ← Back to curriculum
            </Link>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
