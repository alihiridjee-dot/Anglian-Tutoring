import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { CourseChip } from "@/components/CourseBadge";
import { Mascot } from "@/components/Doodles";
import { GuideOverlay } from "@/components/StudentGuide";
import { WelcomeVideo } from "@/components/WelcomeVideo";
import { useViewer } from "@/hooks/useViewer";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useCourseSummary } from "@/hooks/data/useCourseSummary";
import { useChildLinks } from "@/hooks/data/useParentLinks";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import {
  markWelcomeTourSeen,
  markWelcomeVideoWatched,
  readWelcomeTourSeen,
  readWelcomeVideoWatched,
} from "@/lib/profile/welcomeTour";
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
 * The step whose tap opened what this step is about (a tab), earlier on the
 * same page; -1 when there is none.
 */
function openerOf(steps: WelcomeStep[], index: number) {
  const { path, chapter } = steps[index];
  for (let k = index - 1; k >= 0 && steps[k].path === path && steps[k].chapter === chapter; k--) {
    if (steps[k].tap?.open) return k;
  }
  return -1;
}

/**
 * The welcome tour: what Anglia Educate is, what the plan pays for, and where
 * each part of it lives, shown on the student's or parent's own pages.
 *
 * It starts by itself the first time an account reaches its home page, on
 * whichever device that is, and replays from "Show me around" there. Finishing
 * or skipping it is recorded on the profile. A student whose plan has lapsed
 * isn't started on it: their pages are empty until they resubscribe.
 *
 * A student watches the welcome video first, and can't skip it the first time
 * (see WelcomeVideo). From the 🧭 it plays again, skippable, before the tour.
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
  const [video, setVideo] = useState<"required" | "skippable" | null>(null);
  // Steps whose tap has landed. Kept for the run, so Back to one shows its
  // words without asking for the tap again.
  const [tapped, setTapped] = useState<ReadonlySet<number>>(() => new Set());
  const step = index === null ? null : steps[index];
  const started = useRef(false);
  const here = useRef(pathname);
  here.current = pathname;
  // Where the tour last sent the browser, so its own moves aren't mistaken
  // for the student leaving.
  const heading = useRef<string | null>(null);

  const finish = useCallback(() => {
    setIndex(null);
    // Once the dialog has gone: nothing outside an open modal can take focus.
    window.setTimeout(() =>
      document.querySelector<HTMLElement>('[data-guide="guide"]')?.focus({ preventScroll: true }),
    );
    if (!userId) return;
    // Remembered here at once, so going home doesn't start it again while the
    // write is still on its way. A failed write means it shows once more.
    queryClient.setQueryData(seenKey, new Date().toISOString());
    void markWelcomeTourSeen(userId).catch(() => {});
  }, [queryClient, seenKey, userId]);

  const go = useCallback(
    (n: number) => {
      const next = steps[n];
      if (!next) return finish();
      if (n === 0) setTapped(new Set());
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
      // Watched already on this device: they left partway through the tour.
      if (audience === "student" && userId && !readWelcomeVideoWatched(userId)) {
        setVideo("required");
      } else go(0);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [audience, go, home, index, locked, pathname, seen.data, seen.isSuccess, userId]);

  // "Show me around" on a home page.
  useEffect(() => {
    const replay = () => {
      started.current = true;
      if (audience !== "student" || !userId) return go(0);
      // Skippable once it's been watched, or once the tour has been done. A new
      // student pressing the 🧭 before the tour starts still has to watch it.
      setVideo(readWelcomeVideoWatched(userId) || seen.data !== null ? "skippable" : "required");
    };
    window.addEventListener(WELCOME_TOUR_START, replay);
    return () => window.removeEventListener(WELCOME_TOUR_START, replay);
  }, [audience, go, seen.data, userId]);

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

  // A step after a tab's tap needs that tab open. Coming back to one from
  // another page finds the page on its first tab again, so the tour presses
  // the tab itself when what the step rings isn't there. Pressing an open tab
  // changes nothing, so a page still loading is no harm.
  const opener = index === null || !steps[index] ? -1 : openerOf(steps, index);
  useEffect(() => {
    if (index === null || opener < 0 || pathname !== steps[index].path) return;
    const tab = steps[opener].targets[0];
    const wanted = steps[index].targets[0];
    let tries = 0;
    const timer = window.setInterval(() => {
      const button = document.querySelector<HTMLElement>(tab);
      if (button && !document.querySelector(wanted)) button.click();
      if (button || ++tries > 40) window.clearInterval(timer);
    }, 150);
    return () => window.clearInterval(timer);
  }, [index, opener, pathname, steps]);

  if (video) {
    return (
      <WelcomeVideo
        skippable={video === "skippable"}
        onWatched={() => userId && markWelcomeVideoWatched(userId)}
        onDone={() => {
          setVideo(null);
          go(0);
        }}
      />
    );
  }

  if (!step || index === null) return null;
  const last = index === steps.length - 1;
  // A step that waits for a tap keeps its words back until the tap, unless the
  // tap only opens something (a tab) and the tour moves straight on.
  const { tap } = step;
  const waiting = !!tap && !tapped.has(index);
  const words = !waiting || !!tap?.open;

  return (
    <GuideOverlay
      stepId={String(index)}
      // A step that explains an idea sits in the middle of the screen; a step
      // about a page docks under it and rings what it is about.
      place={step.targets.length > 0 ? "dock" : "centre"}
      // Nothing is searched for until the step's own page is showing.
      targets={pathname === step.path ? step.targets : undefined}
      stops={steps.map((s, i) => ({
        emoji: s.emoji,
        label: s.chapter,
        tint: s.tint,
        minor: i > 0 && steps[i - 1].chapter === s.chapter,
      }))}
      current={index}
      tint={step.tint}
      icon={step.icon ? <step.icon className="size-5" /> : undefined}
      title={step.title}
      peek={
        index === 0 ? (
          <Mascot name="star" mood="happy" size={76} idle={false} className="peek-in" />
        ) : undefined
      }
      celebrate={last}
      onClose={finish}
      onBack={index > 0 ? () => go(index - 1) : undefined}
      onNext={() => (last ? finish() : go(index + 1))}
      nextLabel={index === 0 ? "Show me around" : last ? "Let’s go" : "Next"}
      closeLabel={last ? null : "Skip tour"}
      tap={
        waiting && tap
          ? {
              label: tap.label,
              onTap: (element) => {
                if (!tap.open) return setTapped((done) => new Set(done).add(index));
                // A tab: pressed for real, then on to what it opened.
                element?.click();
                go(index + 1);
              },
            }
          : undefined
      }
    >
      {words && (
        // Its own drop-in, so words that arrive with a tap are seen to arrive.
        <div className="tour-step space-y-3">
          {step.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      )}
      {step.visual === "course" && course.perSubject.length > 0 && (
        // Drawn as the dashboard ribbon draws the course, so it's recognised there.
        <ul className="flex flex-wrap gap-1.5" aria-label="Your course">
          <li className="pop-in">
            <CourseChip icon parts={[course.levelLabel]} />
          </li>
          {course.perSubject.map((s, i) => (
            <li
              key={s.subject}
              className="pop-in"
              style={{ "--pop-delay": `${(i + 1) * 90}ms` } as React.CSSProperties}
            >
              <CourseChip
                tint={SUBJECT_TINT[s.subject] ?? "tint-primary"}
                parts={[s.subjectLabel, s.boardLabel]}
              />
            </li>
          ))}
        </ul>
      )}
      {step.visual === "week" && step.week && (
        // Bare rows: each part of the plan in a dot of its page's colour.
        <ul className="space-y-3 pt-1">
          {step.week.map((row, i) => (
            <li
              key={row.label}
              className="tour-row flex items-center gap-3"
              style={{ "--drop-delay": `${i * 90}ms` } as React.CSSProperties}
            >
              <span className={`ask-idea-dot ${row.tint}`} aria-hidden>
                {row.emoji}
              </span>
              <span>
                <strong className="font-bold">{row.label}.</strong> {row.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GuideOverlay>
  );
}
