import { createFileRoute } from "@tanstack/react-router";
import { guardStudentSection } from "@/lib/auth/routeGuards";
import { HomeworkSheetPage } from "@/components/homework/HomeworkSheetPage";

/**
 * One homework sheet, on its own page.
 *
 * The list used to render every unsubmitted brief's answer form inline, which
 * was fine at four briefs and untenable once the planner started writing a
 * sheet per spec point: a student with twenty of them met a page holding a
 * hundred textareas, all mounted, all autosaving. Splitting the doing from the
 * choosing fixes that, and gives the planner's homework chips somewhere to
 * point — they had been dropping every student on the same undifferentiated
 * list and leaving them to find the right row.
 *
 * A tutor gets the same page read-only, mark schemes included. That is the
 * preview the tutor side never had: until now the only way to see what you had
 * set was to be a student who had been set it.
 */
export const Route = createFileRoute("/_authenticated/homework_/$homeworkId")({
  beforeLoad: guardStudentSection,
  head: () => ({ meta: [{ title: "Homework | Anglia Educate" }] }),
  component: HomeworkSheetPage,
});
