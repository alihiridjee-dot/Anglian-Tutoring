import { SubjectToggle } from "@/components/Shared";
import { useActiveSubject } from "@/hooks/useActiveSubject";

/**
 * The subject slider — the one place a student changes subject. Every student
 * page reads the choice through `useActiveSubject`, so moving it repoints the
 * whole app rather than one page's list.
 *
 * It sits in the header on a wide screen and at the top of the page below
 * that (see AppLayout), where the header has no room for it without cutting
 * the page title short or growing a row. Only one of the two is ever shown,
 * and each passes its own `layoutId`.
 *
 * Draws nothing for a single-subject student (there is nothing to switch), and
 * no wrapper either, so neither place keeps an empty row for it.
 */
export function HeaderSubjectToggle({
  className,
  layoutId,
}: {
  className?: string;
  layoutId?: string;
}) {
  const { subject, subjects, setSubject } = useActiveSubject();
  if (!subject || subjects.length < 2) return null;
  return (
    <div data-guide="subject-slider" className={className}>
      {/* The default "Subject" label: the MCQ and planner guides find it by name. */}
      <SubjectToggle
        subjects={subjects}
        value={subject}
        onChange={setSubject}
        layoutId={layoutId}
      />
    </div>
  );
}
