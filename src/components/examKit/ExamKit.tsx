import { useEffect, useState } from "react";
import { Calculator as CalculatorIcon, X } from "lucide-react";
import { Calculator } from "@/components/examKit/Calculator";
import { EMPTY_CALC, type CalcState } from "@/lib/examKit/calculator";
import { PeriodicTable } from "@/components/examKit/PeriodicTable";
import { EquationSheet } from "@/components/examKit/EquationSheet";
import { SectionHeading, SegmentedToggle } from "@/components/Shared";
import { examKitFor, type ExamTool } from "@/lib/examKit/examKit";
import type { BoardV, LevelV } from "@/lib/curriculum/taxonomy";
import { cn } from "@/lib/utils";

const TOOL_LABEL: Record<ExamTool, string> = {
  calculator: "Calculator",
  periodic: "Periodic table",
  equations: "Equations",
};

/**
 * What the exam room gives a student for this paper, beside the task sheet:
 * a calculator always, the periodic table in chemistry, and the equation
 * sheet in physics where the board prints one. Nothing the exam doesn't give,
 * so practice here is practice for the day.
 *
 * On a wide screen it is a column beside the questions, pinned while they
 * scroll. Narrower, a button opens it over the bottom of the page without
 * covering it all, so the question stays readable while it's worked out.
 *
 * It is always mounted, open or not, so a half-keyed sum survives closing it.
 */
export function ExamKit({
  subject,
  board,
  level,
}: {
  subject: string;
  board: BoardV | null;
  level: LevelV;
}) {
  const kit = examKitFor(subject, board, level);
  const [tool, setTool] = useState<ExamTool>("calculator");
  const [calc, setCalc] = useState<CalcState>(EMPTY_CALC);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sheetLabel =
    tool === "periodic" ? kit.periodic?.label : tool === "equations" ? kit.equations?.label : null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls="exam-kit"
          className="btn-solid fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm shadow-xl xl:hidden print:hidden"
        >
          <CalculatorIcon className="size-5" aria-hidden />
          {kit.tools.length > 1 ? "Exam kit" : "Calculator"}
        </button>
      )}

      <aside
        id="exam-kit"
        aria-label="Exam kit"
        className={cn(
          "premium-card p-4 print:hidden",
          // Beside the sheet, pinned under the header while the questions
          // scroll, taking what width the sheet leaves (the table wants it).
          "xl:sticky xl:top-28 xl:block xl:max-h-[calc(100dvh-8rem)] xl:max-w-md xl:min-w-80 xl:flex-1 xl:overflow-y-auto",
          // Narrower: up from the bottom on a phone, a card in the corner on a
          // tablet, and gone until asked for.
          open
            ? "max-xl:fixed max-xl:inset-x-0 max-xl:bottom-0 max-xl:z-40 max-xl:max-h-[85dvh] max-xl:overflow-y-auto max-xl:rounded-b-none max-xl:pb-[calc(1rem+env(safe-area-inset-bottom))] max-xl:shadow-2xl sm:max-xl:right-4 sm:max-xl:bottom-4 sm:max-xl:left-auto sm:max-xl:w-[24rem] sm:max-xl:rounded-b-[var(--radius)]"
            : "max-xl:hidden",
        )}
      >
        <SectionHeading title="Exam kit">
          {sheetLabel && <span className="chip">{sheetLabel}</span>}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close the exam kit"
            className="btn-ghost flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl sm:pointer-fine:size-9 xl:hidden"
          >
            <X className="size-5" aria-hidden />
          </button>
        </SectionHeading>

        {kit.tools.length > 1 && (
          <div className="mt-3">
            <SegmentedToggle
              layoutId="exam-kit-tool"
              label="Tool"
              value={tool}
              onChange={(v) => setTool(v as ExamTool)}
              items={kit.tools.map((t) => ({ value: t, label: TOOL_LABEL[t] }))}
            />
          </div>
        )}

        <div className="mt-4">
          {tool === "periodic" && kit.periodic ? (
            <PeriodicTable sheet={kit.periodic} />
          ) : tool === "equations" && kit.equations ? (
            <EquationSheet sheet={kit.equations} />
          ) : (
            <Calculator state={calc} onChange={setCalc} />
          )}
        </div>
      </aside>
    </>
  );
}
