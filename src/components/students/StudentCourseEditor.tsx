import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SectionHeading } from "@/components/Shared";
import { Field, inputCls } from "@/components/tutor/Field";
import { useSetStudentLevel, useUpdateStudentEnrolment } from "@/hooks/data/useStudents";
import {
  BOARDS,
  LEVELS,
  isBoard,
  isLevel,
  type BoardV,
  type LevelV,
} from "@/lib/curriculum/taxonomy";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import type { StudentEnrolment, StudentRecord } from "@/lib/students/studentsDal";

const GRADES = ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"] as const;

function GradeSelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled: boolean;
}) {
  return (
    <Field label={label}>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputCls}
      >
        <option value="">—</option>
        {GRADES.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    </Field>
  );
}

function EnrolmentCard({
  studentId,
  enrolment,
}: {
  studentId: string;
  enrolment: StudentEnrolment;
}) {
  const update = useUpdateStudentEnrolment();
  const [pendingBoard, setPendingBoard] = useState<BoardV | null>(null);
  const busy = update.isPending;

  const save = (patch: Parameters<typeof update.mutate>[0]["patch"], done: string) =>
    update.mutate(
      { studentId, subject: enrolment.subject, patch },
      {
        onSuccess: () => toast.success(done),
        onError: (e) => toast.error(e.message),
        onSettled: () => setPendingBoard(null),
      },
    );

  return (
    <div
      className={`pop-card pop-card-banded p-4 sm:p-5 ${SUBJECT_TINT[enrolment.subject] ?? "tint-slate"}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="chip uppercase">{subjectLabel(enrolment.subject)}</span>
        {busy && <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden />}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Exam board">
          <select
            value={enrolment.board}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value;
              if (isBoard(next) && next !== enrolment.board) setPendingBoard(next);
            }}
            className={inputCls}
          >
            {BOARDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>
        <GradeSelect
          label="Target grade"
          value={enrolment.target_grade}
          disabled={busy}
          onChange={(v) => save({ target_grade: v }, "Target grade saved.")}
        />
        <GradeSelect
          label="Current grade"
          value={enrolment.current_grade}
          disabled={busy}
          onChange={(v) => save({ current_grade: v }, "Current grade saved.")}
        />
        <GradeSelect
          label="Previous grade"
          value={enrolment.previous_grade}
          disabled={busy}
          onChange={(v) => save({ previous_grade: v }, "Previous grade saved.")}
        />
      </div>
      {pendingBoard && (
        <div className="surface-soft mt-4 rounded-xl p-3.5 text-sm">
          <p>
            Switch {subjectLabel(enrolment.subject)} to{" "}
            <span className="font-bold">{BOARDS.find((b) => b.value === pendingBoard)?.label}</span>
            ? Their curriculum, quizzes, homework and planner for this subject all change with it.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => save({ board: pendingBoard }, "Exam board changed.")}
              className="btn-solid inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold"
            >
              Switch board
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPendingBoard(null)}
              className="btn-soft inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold"
            >
              Keep {BOARDS.find((b) => b.value === enrolment.board)?.label}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The student's course, editable: exam level on the profile, and the board
 * and grades on each enrolment. Grades save on change; a board switch asks
 * first, because it swaps the whole subject's content under the student.
 *
 * Subjects themselves are not added or removed here — the count is what the
 * plan is priced on, so that goes through billing.
 */
export function StudentCourseEditor({ record }: { record: StudentRecord }) {
  const { profile, enrolments } = record;
  const setLevel = useSetStudentLevel();
  const [pendingLevel, setPendingLevel] = useState<LevelV | null>(null);

  return (
    <section className="premium-card rounded-2xl p-5 sm:p-6">
      <SectionHeading
        title="Course"
        hint="Level and board decide every piece of content this student sees."
      />
      <div className="mt-4 max-w-xs">
        <Field label="Exam level">
          <select
            value={profile.level ?? ""}
            disabled={setLevel.isPending}
            onChange={(e) => {
              const next = e.target.value;
              if (isLevel(next) && next !== profile.level) setPendingLevel(next);
            }}
            className={inputCls}
          >
            {!profile.level && <option value="">Not set</option>}
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {pendingLevel && (
        <div className="surface-soft mt-3 max-w-xl rounded-xl p-3.5 text-sm">
          <p>
            Move this student to{" "}
            <span className="font-bold">{LEVELS.find((l) => l.value === pendingLevel)?.label}</span>
            ? A different level is a different qualification: every subject's content changes.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={setLevel.isPending}
              onClick={() =>
                setLevel.mutate(
                  { studentId: profile.id, level: pendingLevel },
                  {
                    onSuccess: () => toast.success("Exam level changed."),
                    onError: (e) => toast.error(e.message),
                    onSettled: () => setPendingLevel(null),
                  },
                )
              }
              className="btn-solid inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold"
            >
              {setLevel.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Change level
            </button>
            <button
              type="button"
              disabled={setLevel.isPending}
              onClick={() => setPendingLevel(null)}
              className="btn-soft inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold"
            >
              Keep {profile.level ? LEVELS.find((l) => l.value === profile.level)?.label : "unset"}
            </button>
          </div>
        </div>
      )}

      {enrolments.length > 0 ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {enrolments.map((e) => (
            <EnrolmentCard key={e.id} studentId={profile.id} enrolment={e} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground mt-5 text-sm">No subjects enrolled yet.</p>
      )}
    </section>
  );
}
