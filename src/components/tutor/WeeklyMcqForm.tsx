import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
import { SpecPointSelect } from "./SpecPointSelect";
import { UseWeeklyFocusButton } from "./UseWeeklyFocusButton";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { generateCurriculumQuiz } from "@/lib/mcq.functions";
import { Sparkles, ListChecks } from "lucide-react";

interface WeeklyMcqFormProps {
  userId: string;
  taxonomy: {
    subject: SubjectV;
    setSubject: (v: SubjectV) => void;
    board: BoardV;
    setBoard: (v: BoardV) => void;
    level: LevelV;
    setLevel: (v: LevelV) => void;
  };
}

// Tutor-assigned weekly MCQs: pick curriculum spec points (one subject) and a due
// date, then generate one auto-published set. Questions are tagged per point so the
// set surfaces under each point on the curriculum page, and the due date drives the
// student "This week's MCQs" banner (and its week-after-due archival).
export function WeeklyMcqForm({ userId: _userId, taxonomy }: WeeklyMcqFormProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [specPointIds, setSpecPointIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const genQuiz = useServerFn(generateCurriculumQuiz);

  const canSubmit = specPointIds.length > 0 && !!dueAt && !loading;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (specPointIds.length === 0) return toast.error("Select at least one spec point");
    if (!dueAt) return toast.error("Set a due date");
    setLoading(true);

    const quizToast = toast.loading("Generating weekly MCQs…");
    try {
      const res = await genQuiz({
        data: {
          subject: taxonomy.subject,
          specPointIds,
          title: title || "Weekly MCQs",
          dueAt: new Date(dueAt).toISOString(),
        },
      });
      toast.success(
        `Published — ${res.count} questions across ${res.points} spec point${
          res.points === 1 ? "" : "s"
        }`,
        { id: quizToast },
      );
      qc.invalidateQueries({ queryKey: ["mcqs"] });
      setTitle("");
      setDueAt("");
      setSpecPointIds([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Quiz generation failed", {
        id: quizToast,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-primary/5 border border-primary/15">
        <ListChecks className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Pick the curriculum spec points to assess and a due date. Students see the quiz under
          <span className="font-semibold text-foreground"> “This week&apos;s MCQs” </span>
          until a week after the due date, then it moves into their completed list — still findable
          by browsing any covered spec point.
        </p>
      </div>

      <Field label="Title">
        <input
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Week 5 — Cell Biology recap"
        />
      </Field>

      <Field label="Due date">
        <input
          required
          type="datetime-local"
          className={inputCls}
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
      </Field>

      <TaxonomyFields {...taxonomy} />

      <UseWeeklyFocusButton
        subject={taxonomy.subject}
        board={taxonomy.board}
        level={taxonomy.level}
        value={specPointIds}
        onApply={setSpecPointIds}
      />

      <SpecPointSelect
        subject={taxonomy.subject}
        board={taxonomy.board}
        level={taxonomy.level}
        value={specPointIds}
        onChange={setSpecPointIds}
      />

      <button disabled={!canSubmit} className={submitBtn}>
        <Sparkles className="w-4 h-4" />
        {loading ? "Generating…" : "Generate & publish"}
      </button>
    </form>
  );
}
