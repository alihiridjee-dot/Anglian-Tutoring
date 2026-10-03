import { SubjectToggle } from "@/components/Shared";
import { useActiveSubject } from "@/hooks/useActiveSubject";

/**
 * The subject slider in the app header — the one place a student changes
 * subject. Every student page reads the choice through `useActiveSubject`, so
 * moving it repoints the whole app rather than one page's list.
 *
 * Draws nothing for a single-subject student (there is nothing to switch), and
 * no wrapper either, so the header doesn't keep an empty row for it.
 */
export function HeaderSubjectToggle({ className }: { className?: string }) {
  const { subject, subjects, setSubject } = useActiveSubject();
  if (!subject || subjects.length < 2) return null;
  return (
    <div data-guide="subject-slider" className={className}>
      {/* The default "Subject" label: the MCQ and planner guides find it by name. */}
      <SubjectToggle subjects={subjects} value={subject} onChange={setSubject} />
    </div>
  );
}
