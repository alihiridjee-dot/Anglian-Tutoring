import { SUBJECTS, BOARDS, LEVELS, type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { Field, inputCls } from "./Field";

export function TaxonomyFields({
  subject,
  setSubject,
  board,
  setBoard,
  level,
  setLevel,
  hideBoard = false,
}: {
  subject: SubjectV;
  setSubject: (v: SubjectV) => void;
  board: BoardV;
  setBoard: (v: BoardV) => void;
  level: LevelV;
  setLevel: (v: LevelV) => void;
  /** Hide the board picker — used by live sessions, which are board-agnostic. */
  hideBoard?: boolean;
}) {
  return (
    <div className={`grid gap-3 ${hideBoard ? "grid-cols-2" : "grid-cols-3"}`}>
      <Field label="Subject">
        <select
          className={inputCls}
          value={subject}
          onChange={(e) => setSubject(e.target.value as SubjectV)}
        >
          {SUBJECTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      {!hideBoard && (
        <Field label="Board">
          <select
            className={inputCls}
            value={board}
            onChange={(e) => setBoard(e.target.value as BoardV)}
          >
            {BOARDS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Level">
        <select
          className={inputCls}
          value={level}
          onChange={(e) => setLevel(e.target.value as LevelV)}
        >
          {LEVELS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
