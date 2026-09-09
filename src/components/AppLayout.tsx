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
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useRoles } from "@/hooks/useRole";
import { useSignOut } from "@/hooks/useSignOut";
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
import { resolveInitials } from "@/lib/displayName";
import { buildAuthedNav } from "@/lib/nav";
import { SIDEBAR_LABEL_CLASS as labelClass } from "@/components/sidebarLabel";

/**
 * The showcase sidebar. It must stay inside `/demo/*`, or a click lands on a
 * guarded route and bounces the visitor to `/auth`, so these entries carry the
 * demo paths and are kept separate from the real authenticated nav in
 * `@/lib/nav`. The parent showcase mirrors the live Parent Portal: Portal only,
 * none of the student learning sections.
 */
const demoStudentNav = [
  { to: "/demo/student/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/demo/student/curriculum", label: "Curriculum", icon: BookMarked },
  { to: "/demo/student/homework", label: "Homework & Grades", icon: ClipboardList },
  { to: "/demo/student/live", label: "Live Sessions", icon: Video },
  { to: "/demo/student/mcqs", label: "MCQs", icon: ListChecks },
] as const;

const demoParentNav = [
  { to: "/demo/parent/dashboard", label: "Parent Portal", icon: LayoutDashboard },
] as const;

export function AppLayout({ title, children }: { title: string; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isTutor, email } = useRoles();
  const { role: userRole, displayName: profileName, avatarPath } = useEnrolments();
  // The bucket is private, so the header avatar is a short-lived signed URL
  // rather than a stored one. Null path — the showcase, or nobody's photo —
  // never issues a request.
  const avatarUrl = useAvatarUrl(avatarPath);
  const navigate = useNavigate();
  const router = useRouter();
  const signOut = useSignOut();
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: unreadMessages = 0 } = useChatUnread();

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
  // in @/lib/nav, where a parent's sidebar is *typed* to exclude the student
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
      <div className="relative w-20 shrink-0">
        {/* Above the demo ribbon (z-40) and the sticky header (z-30), both of
            which the expanded rail passes in front of. */}
        <aside className="group/sidebar absolute inset-y-0 left-0 z-50 w-20 hover:w-60 overflow-hidden bg-sidebar border-r border-sidebar-border flex flex-col py-5 px-3 gap-1 transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none hover:shadow-2xl">
          <Link to="/" className="wordmark mb-6 flex items-center gap-2 px-2">
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
                to={to}
                title={badge > 0 ? `${label} (${badge} unread)` : label}
                data-active={active ? "true" : undefined}
                className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
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
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10"
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
            className="text-primary-foreground px-6 py-2.5 flex flex-col sm:flex-row gap-3 items-center justify-between text-xs font-semibold shrink-0 select-none shadow-md z-40"
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
                  ? "Exploring the GCSE Science Student Hub as a student. Check out curriculum, live classes, quizzes, and homework!"
                  : "Exploring the GCSE Science Student Hub. Click around to preview live classes, grades, worksheets, and syllabus views!"}
              </span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
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
        <header className="glass-bar sticky top-0 z-30 flex items-center justify-between px-6 lg:px-10 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => router.history.back()}
                title="Back"
                className="btn-soft w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => router.history.forward()}
                title="Forward"
                className="btn-soft w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div>
              <h1 className="font-display text-xl font-extrabold tracking-tight lg:text-2xl">
                {title}
              </h1>
            </div>
            {/* Which spec this student is on, stated on every page — it decides
                everything they're shown, and it used to appear nowhere after the
                onboarding step that set it. */}
            <CourseBadge />
          </div>
          <div className="flex items-center gap-3">
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
        <div className="page-aurora flex-1 p-6 lg:p-10 overflow-auto">{children}</div>
      </main>

      <GlobalSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
