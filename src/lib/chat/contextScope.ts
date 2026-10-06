/**
 * Which of the student's courses a row may belong to, as a PostgREST `or`
 * filter: each enrolled subject on that subject's own board.
 *
 * The same rule as the student's homework page. A subject with no enrolment
 * row (legacy accounts) has no board to contradict, so it is matched on
 * subject alone. `boardless` also lets through rows written for every board
 * (a homework brief with no board); the caller still limits by subject, since
 * that term carries none.
 *
 * Null when the student sits nothing, so the caller can skip the read rather
 * than send a filter that matches everything.
 */
export function courseScopeFilter(
  subjects: readonly string[],
  enrolments: readonly { subject: string; board: string }[],
  { boardless }: { boardless: boolean },
): string | null {
  if (subjects.length === 0) return null;
  const boardOf = new Map(enrolments.map((e) => [e.subject, e.board]));
  const terms = subjects.map((s) => {
    const board = boardOf.get(s);
    return board ? `and(subject.eq.${s},board.eq.${board})` : `subject.eq.${s}`;
  });
  if (boardless) terms.unshift("board.is.null");
  return terms.join(",");
}
