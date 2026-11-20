import type { ReactNode } from "react";
import type { Pen } from "@/lib/homework/tutorMarks";

/**
 * A run of an answer under a tutor's pen: the highlighter for words that
 * earned credit, a wavy line for words to look at again. The marking screen
 * and the student's marked sheet both draw their marks with it, so a mark
 * looks the same where it is made and where it is read.
 */
export function PenMark({ pen, children }: { pen?: Pen; children: ReactNode }) {
  if (pen === "highlight")
    return <mark className="marker bg-transparent text-inherit">{children}</mark>;
  if (pen === "underline") return <span className="tint-rose pen-line">{children}</span>;
  return <>{children}</>;
}
