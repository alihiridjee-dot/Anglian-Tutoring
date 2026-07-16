import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LayoutDashboard, LogOut, User, Users } from "lucide-react";
import { useSignOut } from "@/hooks/useSignOut";

type MenuTarget = "/profile" | "/dashboard" | "/parents";

interface UserMenuProps {
  /** Initials rendered in the avatar. */
  initials: string;
  /** Signed-in address, shown as the menu's subtitle. Null in the showcase. */
  email: string | null;
  /**
   * Whether to offer "Linked Parents". Tutors have no parent of their own to
   * manage — they link families from /students instead.
   */
  showLinkedParents: boolean;
  /** The showcase holds no session, so it gets the avatar without the menu. */
  isDemo: boolean;
}

const itemCls =
  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition hover:bg-muted";

/**
 * The header avatar, as a dropdown.
 *
 * "Main Dashboard" points at /dashboard on purpose: that route resolves the
 * caller's role and redirects, so one link lands every persona on their own home
 * without this component knowing the routing rules.
 */
export function UserMenu({ initials, email, showLinkedParents, isDemo }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const signOut = useSignOut();

  // Close on outside click so the panel doesn't trap the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const avatar = (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-semibold text-primary-foreground">
      {initials}
    </div>
  );

  // No account behind the showcase: every item would either 404 or sign out a
  // session that doesn't exist.
  if (isDemo) return avatar;

  const links: {
    to: MenuTarget;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { to: "/profile", label: "View Profile", icon: User },
    { to: "/dashboard", label: "Main Dashboard", icon: LayoutDashboard },
    ...(showLinkedParents
      ? [{ to: "/parents" as const, label: "Linked Parents", icon: Users }]
      : []),
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="rounded-full focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
      >
        {avatar}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 w-56 rounded-xl border border-border bg-card shadow-xl z-50 p-1.5"
        >
          {email && (
            <div className="px-3 py-2 border-b border-border mb-1">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Signed in as
              </p>
              <p className="text-sm font-medium truncate" title={email}>
                {email}
              </p>
            </div>
          )}

          {links.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={itemCls}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          ))}

          <div className="border-t border-border mt-1 pt-1">
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              className={`${itemCls} text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer`}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
