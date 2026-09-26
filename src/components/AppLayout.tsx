import { StudentGuide } from "@/components/StudentGuide";
import { DemoTour } from "@/components/demo/DemoTour";
import { startDemoTour, TOUR_START_PATH } from "@/lib/demo/tourSteps";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  GraduationCap,
  LogOut,
  BookMarked,
  ListChecks,
  Video,
  ClipboardList,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Compass,
  MessagesSquare,
  Menu,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useRoles } from "@/hooks/useRole";
import { useSignOut } from "@/hooks/useSignOut";
import { useViewer } from "@/hooks/useViewer";
import { isDemoMode, getDemoRole } from "@/lib/auth/session";
import { DEMO_STUDENT_NAME, DEMO_PARENT_NAME } from "@/lib/demo/studentDemo";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { useAvatarUrl } from "@/hooks/data/useAvatar";
import { useChatUnread } from "@/hooks/data/useChat";
import { NotificationBell } from "@/components/NotificationBell";
import { CourseBadge } from "@/components/CourseBadge";
import { UserMenu } from "@/components/UserMenu";
import { HeaderLiveButton } from "@/components/live/HeaderLiveButton";
import { GlobalSearchDialog } from "@/components/search/GlobalSearchDialog";
import { SidebarSearchButton } from "@/components/search/SidebarSearchButton";
import { resolveInitials } from "@/lib/profile/displayName";
import { buildAuthedNav } from "@/lib/shell/nav";
import { SIDEBAR_LABEL_CLASS as labelClass } from "@/components/sidebarLabel";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

/**
 * The showcase sidebar. It must stay inside `/demo/*`, or a click lands on a
 * guarded route and bounces the visitor to `/auth`, so these entries carry the
 * demo paths and are kept separate from the real authenticated nav in
 * `@/lib/shell/nav`. The parent showcase mirrors the live Parent Portal: Portal only,
 * none of the student learning sections.
 */
const demoStudentNav = [
  { to: "/demo/student/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/demo/student/planner", label: "Planner", icon: Compass },
  { to: "/demo/student/curriculum", label: "Curriculum", icon: BookMarked },
  { to: "/demo/student/homework", label: "Homework & Grades", icon: ClipboardList },
  { to: "/demo/student/live", label: "Live Sessions", icon: Video },
  { to: "/demo/student/mcqs", label: "MCQs", icon: ListChecks },
  { to: "/demo/student/messages", label: "Messages", icon: MessagesSquare },
] as const;

const demoParentNav = [
  { to: "/demo/parent/dashboard", label: "Parent Portal", icon: LayoutDashboard },
] as const;

export function AppLayout({ title, children }: { title: string; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isTutor, email } = useRoles();
  const { role: profileRole, displayName: profileName, avatarPath } = useEnrolments();
  // The guard already knows a parent is a parent. Waiting on the profile query
  // drew the student sidebar first and swapped it a moment later, on every hard
  // load of the Portal.
  const viewer = useViewer();
  const userRole = profileRole ?? (viewer?.appRole === "parent" ? "parent" : null);
  // The bucket is private, so the header avatar is a short-lived signed URL
  // rather than a stored one. Null path — the showcase, or nobody's photo —
  // never issues a request.
  const avatarUrl = useAvatarUrl(avatarPath);
  const navigate = useNavigate();
  const router = useRouter();
  const signOut = useSignOut();
  const [searchOpen, setSearchOpen] = useState(false);
  // The phone drawer. Below `md` the sidebar has no hover to expand on, so it
  // slides in from the left instead and is dismissed by the backdrop, Escape,
  // its own close button, or simply arriving somewhere.
  const [navOpen, setNavOpen] = useState(false);
  const { data: unreadMessages = 0 } = useChatUnread();

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useBodyScrollLock(navOpen);
  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  // ⌘K / Ctrl+K opens search from anywhere in the app. Bound on the window
  // rather than the sidebar button so it works while focus is in a page form,
  // and the default (Chrome's address-bar search) is suppressed.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Derived from the pathname, so it tracks navigation with no state to go
  // stale and nothing to clear on the way out.
  const isDemo = isDemoMode();
  const demoRole = getDemoRole();

  const handleExitDemo = () => {
    // Nothing to tear down: the showcase holds no session and no cached rows.
    navigate({ to: "/" });
  };

  // Real sessions derive their nav per persona from the single source of truth
  // in @/lib/shell/nav, where a parent's sidebar is *typed* to exclude the student
  // learning sections. The demo showcase keeps its own /demo/* entries.
  const nav = isDemo
    ? demoRole === "parent"
      ? demoParentNav
      : demoStudentNav
    : buildAuthedNav({ isTutor, role: userRole });

  // The showcase has no account, so its avatar comes from the fixture persona
  // rather than a signed-in profile.
  const initials = isDemo
    ? (demoRole === "parent" ? DEMO_PARENT_NAME : DEMO_STUDENT_NAME).slice(0, 2).toUpperCase()
    : resolveInitials(profileName, email);

  // The live "Join" pill in the ribbon is a student affordance — tutors run
  // sessions and parents don't attend, so it only shows in a student context.
  const isStudentContext = isDemo ? demoRole === "student" : !isTutor && userRole !== "parent";

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/*
       * The sidebar rests as an icon rail and expands on hover to reveal the
       * labels. Only this placeholder occupies layout width — the rail itself is
       * absolutely positioned and *overlays* the page as it widens, so hovering
       * never reflows the content beside it. Tailwind's `hover:` variant is
       * gated on `@media (hover: hover)`, so touch devices simply keep the rail.
       */}
      <div className="relative w-0 shrink-0 md:w-20">
        {/* Phone only: the tap-to-close backdrop behind the open drawer. Sits
            under the drawer (z-50) and over the ribbon and header. */}
        {navOpen && (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
            className="bg-primary-deep/40 fixed inset-0 z-45 cursor-pointer md:hidden"
          />
        )}
        {/* Above the demo ribbon (z-40) and the sticky header (z-30), both of
            which the expanded rail passes in front of. Below `md` the same
            element is a fixed drawer: full labels, slid off-screen and made
            `invisible` (so it leaves the tab order) until opened. */}
        <aside
          id="app-sidebar"
          className={`group/sidebar fixed inset-y-0 left-0 z-50 flex w-60 flex-col gap-1 overflow-y-auto overflow-x-hidden border-r border-sidebar-border bg-sidebar px-3 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] transition-[width,box-shadow,transform,visibility] duration-200 ease-out motion-reduce:transition-none md:absolute md:w-20 md:translate-x-0 md:overflow-hidden md:pb-5 md:hover:w-60 md:hover:shadow-2xl ${
            navOpen ? "translate-x-0 shadow-2xl" : "max-md:invisible max-md:-translate-x-full"
          }`}
        >
          <div className="mb-6 flex items-center justify-between gap-2">
            <Link to="/" className="wordmark flex min-w-0 items-center gap-2 px-2">
              <span className="icon-tile icon-tile-solid wordmark-tile size-10 shrink-0">
                <GraduationCap className="size-5" aria-hidden />
              </span>
              <span
                className={`${labelClass} font-display text-foreground text-[0.95rem] leading-tight font-extrabold`}
              >
                Anglia
                <span className="text-muted-foreground block text-[0.7rem] font-bold tracking-[0.18em] uppercase">
                  Educate
                </span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              aria-label="Close menu"
              className="btn-ghost flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl md:hidden"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <SidebarSearchButton onOpen={() => setSearchOpen(true)} />
          {nav.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            // The rail is collapsed most of the time, so an unread count has to
            // read as a dot on the icon rather than a number beside a hidden
            // label. It stays visible either way.
            const badge = to === "/messages" ? unreadMessages : 0;
            return (
              <Link
                key={to}
                data-guide={to.split("/").pop()}
                to={to}
                title={badge > 0 ? `${label} (${badge} unread)` : label}
                data-active={active ? "true" : undefined}
                className={`relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  active ? "btn-solid" : "btn-ghost"
                }`}
              >
                <span className="tab-pop relative shrink-0">
                  <Icon className="size-5" aria-hidden />
                  {badge > 0 && (
                    <span className="bg-destructive text-destructive-foreground absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-[1.5px] border-white px-1 text-[10px] font-extrabold">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </span>
                <span className={labelClass}>{label}</span>
              </Link>
            );
          })}
          <div className="mt-auto">
            <button
              onClick={signOut}
              title="Sign out"
              className="w-full flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10"
            >
              <LogOut className="w-5 h-5 shrink-0" />
              <span className={labelClass}>Sign out</span>
            </button>
          </div>
        </aside>
      </div>

      <main className="flex-1 min-w-0 flex flex-col">
        {isDemo && (
          <div
            className="text-primary-foreground px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row gap-3 items-center justify-between text-xs font-semibold shrink-0 select-none shadow-md z-40"
            style={{
              background:
                "linear-gradient(90deg, var(--primary-deep), color-mix(in oklab, var(--accent) 35%, var(--primary-deep)), var(--primary-deep))",
            }}
          >
            <div className="flex flex-wrap items-center gap-2.5 justify-center sm:justify-start">
              <span className="sticker stamp-in shrink-0 text-[10px] tracking-wider uppercase">
                <Sparkles className="size-3 fill-current" aria-hidden />{" "}
                {demoRole === "student" ? "STUDENT" : "PARENT"} DEMO MODE
              </span>
              <span className="text-primary-foreground/80 text-center sm:text-left leading-relaxed">
                {demoRole === "student"
                  ? "You're looking around as Alex, a GCSE science student. Everything here is sample data — click anything."
                  : "You're looking around as Alex's parent. Everything here is sample data — click anything."}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                data-tour="tour-button"
                onClick={() => {
                  startDemoTour();
                  if (pathname !== TOUR_START_PATH) router.history.push(TOUR_START_PATH);
                }}
                className="text-primary-foreground inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border-[1.5px] border-white/25 bg-white/10 px-3 py-1.5 text-xs font-extrabold shadow-[0_2px_0_0_rgba(0,0,0,0.15)] transition hover:bg-white/20"
              >
                <Compass className="size-3.5" aria-hidden /> Guided tour
              </button>
              <Link
                to="/"
                className="bg-card text-primary hover:bg-card/90 shrink-0 rounded-lg border-[1.5px] border-white/40 px-3.5 py-1.5 text-xs font-extrabold shadow-[0_2px_0_0_rgba(0,0,0,0.18)] transition"
              >
                Join Now
              </Link>
              <button
                onClick={handleExitDemo}
                className="text-primary-foreground shrink-0 cursor-pointer rounded-lg border-[1.5px] border-white/25 bg-white/10 px-3 py-1.5 text-xs font-extrabold shadow-[0_2px_0_0_rgba(0,0,0,0.15)] transition hover:bg-white/20"
              >
                Exit Sandbox
              </button>
            </div>
          </div>
        )}
        <header className="glass-bar sticky top-0 z-30 flex flex-wrap gap-x-3 gap-y-2 items-center justify-between px-4 sm:px-6 lg:px-10 py-3 sm:py-4 shrink-0">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              aria-controls="app-sidebar"
              aria-expanded={navOpen}
              className="btn-soft flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl md:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </button>
            {/* History buttons are 44px on a phone. Forward waits for `sm`:
                phones have a swipe for it, and the header has the space for a
                menu button or a forward button, not both. */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              <button
                onClick={() => router.history.back()}
                title="Back"
                aria-label="Back"
                className="btn-soft size-11 sm:size-9 rounded-xl flex items-center justify-center cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => router.history.forward()}
                title="Forward"
                aria-label="Forward"
                className="btn-soft hidden size-9 rounded-xl sm:flex items-center justify-center cursor-pointer"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div className="min-w-0">
              <h1 className="font-display truncate text-lg font-extrabold tracking-tight sm:text-xl lg:text-2xl">
                {title}
              </h1>
            </div>
            {/* Which spec this student is on, stated on every page — it decides
                everything they're shown, and it used to appear nowhere after the
                onboarding step that set it. */}
            <CourseBadge />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <StudentGuide
              key={`${pathname}:${title}`}
              pageTitle={title}
              guideKey={pathname.includes("/mcq/") ? "MCQ" : title}
              autoStart={isStudentContext && pathname === "/student-dashboard"}
            />
            {isStudentContext && (
              <HeaderLiveButton liveHref={isDemo ? "/demo/student/live" : "/live"} />
            )}
            <NotificationBell />
            <UserMenu
              initials={initials}
              // Null in the showcase, for anyone who hasn't set one, and while
              // a URL is still being signed — all of which keep the initials
              // disc as the default rather than the exception.
              avatarUrl={avatarUrl}
              email={email}
              // Tutors manage families from /students; the item would point a
              // tutor at a page about their own parents, which they don't have.
              showLinkedParents={!isTutor}
              isDemo={isDemo}
            />
          </div>
        </header>
        <div
          data-guide="page-content"
          className="page-aurora flex-1 overflow-x-clip p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-6 lg:p-10"
        >
          {children}
        </div>
      </main>

      <GlobalSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      {isDemo && <DemoTour />}
    </div>
  );
}
