import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { GuideOverlay } from "@/components/StudentGuide";
import { useViewer } from "@/hooks/useViewer";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useCourseSummary } from "@/hooks/data/useCourseSummary";
import { useChildLinks } from "@/hooks/data/useParentLinks";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { markWelcomeTourSeen, readWelcomeTourSeen } from "@/lib/profile/welcomeTour";
import {
  WELCOME_TOUR_START,
  firstName,
  welcomeHome,
  welcomeSteps,
  type WelcomeAudience,
  type WelcomeStep,
} from "@/lib/shell/welcomeTour";
import { UserRole } from "@/types/user";

/** A short wait before starting, so the tour opens over a dashboard that has drawn. */
const SETTLE_MS = 700;

/**
 * The welcome tour: what Anglia Educate is, what the plan pays for, and where
 * each part of it lives, shown on the student's or parent's own pages.
 *
 * It starts by itself the first time an account reaches its home page, on
 * whichever device that is, and replays from "Show me around" there. Finishing
 * or skipping it is recorded on the profile. A student whose plan has lapsed
 * isn't started on it: their pages are empty until they resubscribe.
 *
 * Mounted once by the authenticated layout, which stays put while the pages
 * under it change, so the tour can walk from one page to the next.
 */
export function WelcomeTour({ locked }: { locked: boolean }) {
  const viewer = useViewer();
  const audience: WelcomeAudience | null =
    viewer?.appRole === UserRole.STUDENT
      ? "student"
      : viewer?.appRole === UserRole.PARENT
        ? "parent"
        : null;
  const userId = viewer?.userId ?? null;
  const home = audience ? welcomeHome(audience) : null;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const queryClient = useQueryClient();

  const { displayName } = useEnrolments();
  const course = useCourseSummary();
  const children = useChildLinks(audience === "parent");

  const seenKey = useMemo(() => ["welcome-tour-seen", userId] as const, [userId]);
  const seen = useQuery({
    queryKey: seenKey,
    queryFn: () => readWelcomeTourSeen(userId!),
    enabled: !!audience && !!userId && pathname === home && !locked,
    staleTime: Infinity,
    // A failed read leaves the tour on its button rather than guessing.
    retry: false,
  });

  const steps: WelcomeStep[] = useMemo(
    () =>
      audience
        ? welcomeSteps(audience, {
            name: firstName(displayName),
            children: (children.data ?? []).map((c) => firstName(c.display_name) ?? "your child"),
          })
        : [],
    [audience, displayName, children.data],
  );

  const [index, setIndex] = useState<number | null>(null);
  const step = index === null ? null : steps[index];
  const started = useRef(false);
  const here = useRef(pathname);
  here.current = pathname;
  // Where the tour last sent the browser, so its own moves aren't mistaken
  // for the student leaving.
  const heading = useRef<string | null>(null);

  const finish = useCallback(() => {
    setIndex(null);
    if (!userId) return;
    // Remembered here at once, so going home doesn't start it again while the
    // write is still on its way. A failed write means it shows once more.
    queryClient.setQueryData(seenKey, new Date().toISOString());
    void markWelcomeTourSeen(userId).catch(() => {});
    document.querySelector<HTMLElement>('[data-guide="guide"]')?.focus({ preventScroll: true });
  }, [queryClient, seenKey, userId]);

  const go = useCallback(
    (n: number) => {
      const next = steps[n];
      if (!next) return finish();
      setIndex(n);
      if (next.path !== here.current) {
        heading.current = next.path;
        router.history.push(next.path);
      }
    },
    [finish, router, steps],
  );

  // First visit home: start by itself.
  useEffect(() => {
    if (started.current || index !== null || !home || pathname !== home || locked) return;
    if (!seen.isSuccess || seen.data !== null) return;
    const timer = window.setTimeout(() => {
      started.current = true;
      go(0);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [go, home, index, locked, pathname, seen.data, seen.isSuccess]);

  // "Show me around" on a home page.
  useEffect(() => {
    const replay = () => {
      started.current = true;
      go(0);
    };
    window.addEventListener(WELCOME_TOUR_START, replay);
    return () => window.removeEventListener(WELCOME_TOUR_START, replay);
  }, [go]);

  // The browser's own Back and Forward still work mid-tour. Landing on a page
  // the tour has already been to steps back to it; anywhere else ends the tour.
  const visited = useRef(pathname);
  useEffect(() => {
    if (visited.current === pathname) return;
    visited.current = pathname;
    if (index === null || pathname === heading.current || steps[index]?.path === pathname) return;
    let back = index - 1;
    while (back >= 0 && steps[back].path !== pathname) back--;
    if (back >= 0) setIndex(back);
    else finish();
  }, [finish, index, pathname, steps]);

  if (!step || index === null) return null;
  const last = index === steps.length - 1;

  return (
    <GuideOverlay
      stepId={String(index)}
      // Nothing is searched for until the step's own page is showing.
      targets={pathname === step.path ? step.targets : undefined}
      eyebrow={`${step.chapter} · ${index + 1} / ${steps.length}`}
      icon={step.icon ? <step.icon className="size-5" /> : undefined}
      title={step.title}
      progress={(index + 1) / steps.length}
      onClose={finish}
      onBack={index > 0 ? () => go(index - 1) : undefined}
      onNext={() => (last ? finish() : go(index + 1))}
      nextLabel={index === 0 ? "Show me around" : last ? "Let’s go" : "Next"}
      closeLabel="Skip tour"
      wide={!!step.visual}
    >
      {step.body.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {step.visual === "course" && course.perSubject.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Your course">
          {course.levelLabel && <li className="chip pop-in tint-primary">{course.levelLabel}</li>}
          {course.perSubject.map((s, i) => (
            <li
              key={s.subject}
              className={`chip pop-in ${SUBJECT_TINT[s.subject] ?? "tint-slate"}`}
              style={{ "--pop-delay": `${(i + 1) * 90}ms` } as React.CSSProperties}
            >
              {s.subjectLabel} · {s.boardLabel}
            </li>
          ))}
        </ul>
      )}
      {step.visual === "week" && step.week && (
        <ol className="space-y-2.5">
          {step.week.map((row, i) => (
            <li
              key={row.label}
              className="rise-in flex items-center gap-3"
              style={{ "--rise-delay": `${i * 90}ms` } as React.CSSProperties}
            >
              <span className="icon-tile size-9 shrink-0" aria-hidden>
                <row.icon className="size-4" />
              </span>
              <span>
                <strong className="font-bold">{row.label}.</strong> {row.detail}
              </span>
            </li>
          ))}
        </ol>
      )}
    </GuideOverlay>
  );
}
