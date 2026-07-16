import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarRange, Save, Trash2, Info } from "lucide-react";
import { Field, inputCls, submitBtn } from "./Field";
import { TaxonomyFields } from "./TaxonomyFields";
import { SpecPointSelect } from "./SpecPointSelect";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";
import {
  useWeeklyFocus,
  useInvalidateWeeklyFocus,
  saveWeeklyFocus,
} from "@/hooks/data/useWeeklyFocus";
import { currentWeekKey, mondayOf, weekRangeLabel } from "@/lib/week";

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};
const levelLabel: Record<string, string> = { gcse: "GCSE", alevel: "A-Level" };

interface Props {
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

/**
 * Tutor "This Week" editor. Picks the curriculum spec points in focus for the
 * current Mon–Sun week, per subject/board/level. The plan is keyed by this
 * week's Monday, so it clears itself when the week rolls over — this panel is
 * also the Monday prompt to choose the new week's points.
 */
export function WeeklyFocusManager({ userId, taxonomy }: Props) {
  const weekKey = currentWeekKey();
  const rangeLabel = weekRangeLabel(mondayOf());
  const invalidate = useInvalidateWeeklyFocus();

  // Everything set for this week (all subjects) drives the summary strip.
  const { plans: allPlans, loading: allLoading } = useWeeklyFocus(weekKey);
  // The plan being edited, matched by the current taxonomy.
  const existing = allPlans.find(
    (p) =>
      p.subject === taxonomy.subject &&
      p.board === taxonomy.board &&
      p.level === taxonomy.level,
  );

  const [note, setNote] = useState("");
  const [specPointIds, setSpecPointIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Seed the editor from the stored plan whenever the taxonomy changes or the
  // matched plan first loads. Keyed on a signature so in-progress edits within
  // one taxonomy aren't clobbered by a background refetch.
  const seededFor = useRef<string>("");
  useEffect(() => {
    if (allLoading) return;
    const sig = `${taxonomy.subject}|${taxonomy.board}|${taxonomy.level}`;
    if (seededFor.current === sig) return;
    seededFor.current = sig;
    setNote(existing?.note ?? "");
    setSpecPointIds(existing?.points.map((p) => p.id) ?? []);
  }, [allLoading, existing, taxonomy.subject, taxonomy.board, taxonomy.level]);

  const save = async () => {
    if (specPointIds.length === 0) {
      return toast.error("Select at least one spec point (or use Clear to remove this subject).");
    }
    setSaving(true);
    const t = toast.loading("Saving this week's focus…");
    try {
      await saveWeeklyFocus({
        weekKey,
        subject: taxonomy.subject,
        board: taxonomy.board,
        level: taxonomy.level,
        note,
        specPointIds,
        userId,
      });
      invalidate();
      toast.success(
        `Saved — ${subjectLabel[taxonomy.subject] ?? taxonomy.subject}, ${specPointIds.length} point${
          specPointIds.length === 1 ? "" : "s"
        } this week`,
        { id: t },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed", { id: t });
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!existing) return;
    if (!confirm(`Remove ${subjectLabel[taxonomy.subject]} from this week's focus?`)) return;
    setSaving(true);
    const t = toast.loading("Clearing…");
    try {
      await saveWeeklyFocus({
        weekKey,
        subject: taxonomy.subject,
        board: taxonomy.board,
        level: taxonomy.level,
        note: null,
        specPointIds: [],
        userId,
      });
      invalidate();
      setNote("");
      setSpecPointIds([]);
      toast.success("Removed from this week", { id: t });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Clear failed", { id: t });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Week banner + reset explanation (the Monday prompt). */}
      <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <CalendarRange className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display font-bold text-lg leading-tight">This Week</h3>
            <p className="text-xs text-muted-foreground">{rangeLabel}</p>
          </div>
          <span className="ml-auto text-[10px] uppercase tracking-widest font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">
            Mon – Sun
          </span>
        </div>
        <div className="flex items-start gap-2 mt-3 text-xs text-muted-foreground leading-relaxed">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>
            Choose the curriculum points students should focus on this week. The plan resets every
            Monday — last week's selections clear automatically, so set the new focus at the start of
            each week. You can set a different focus per subject.
          </p>
        </div>
      </div>

      {/* Summary of what's already set this week, across subjects. */}
      <div>
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground mb-2">
          Set for this week
        </p>
        {allLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : allPlans.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Nothing set yet — pick points below to start this week.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allPlans.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs"
              >
                <span className="font-semibold">{subjectLabel[p.subject] ?? p.subject}</span>
                <span className="text-muted-foreground">
                  {levelLabel[p.level] ?? p.level} · {p.board.toUpperCase()}
                </span>
                <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
                  {p.points.length}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Editor. */}
      <div className="max-w-2xl rounded-2xl bg-card border border-border p-6 space-y-4">
        <TaxonomyFields {...taxonomy} />

        <Field label="Note for students (optional)">
          <input
            className={inputCls}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Focus on exchange surfaces before Thursday's live session"
          />
        </Field>

        <SpecPointSelect
          subject={taxonomy.subject}
          board={taxonomy.board}
          level={taxonomy.level}
          value={specPointIds}
          onChange={setSpecPointIds}
        />

        <div className="flex flex-wrap gap-2">
          <button onClick={save} disabled={saving} className={submitBtn + " sm:w-auto sm:px-6"}>
            <span className="inline-flex items-center gap-2 justify-center">
              <Save className="w-4 h-4" />
              {saving ? "Saving…" : existing ? "Update this week" : "Set this week"}
            </span>
          </button>
          {existing && (
            <button
              onClick={clear}
              disabled={saving}
              className="h-10 px-4 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition inline-flex items-center gap-2 disabled:opacity-60"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
