/**
 * The student pages that follow the header subject slider.
 *
 * The slider is drawn on these and nowhere else: on a page that doesn't change
 * with it — Linked Parents, Profile, Settings, Billing, Messages — it would be a
 * control that does nothing. A page that starts following the slider (through
 * `useActiveSubject`) belongs in this list, or its students can't switch.
 */
const FOLLOWING = [
  "/student-dashboard",
  "/dashboard",
  "/planner",
  "/planner-order",
  "/curriculum",
  "/homework",
  "/mcqs",
  "/mcq",
  "/live",
  "/notes",
] as const;

/**
 * Whether the page at `pathname` follows the slider. The showcase mounts the
 * same pages under /demo/student, so that prefix is read as the page it stands
 * for.
 */
export function followsSubject(pathname: string): boolean {
  const path = pathname.replace(/^\/demo\/student(?=\/|$)/, "") || "/";
  return FOLLOWING.some((p) => path === p || path.startsWith(`${p}/`));
}
