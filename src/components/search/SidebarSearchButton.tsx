import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { SIDEBAR_LABEL_CLASS } from "@/components/sidebarLabel";

/** True on Apple platforms, where the palette shortcut is ⌘K rather than Ctrl+K. */
function useIsMac(): boolean {
  // Resolved after mount: the server has no navigator, and rendering the wrong
  // shortcut during hydration would flash the other platform's key.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
  }, []);
  return isMac;
}

/**
 * The sidebar's search entry point.
 *
 * With the sidebar expanded it renders as a search *field* rather than a button
 * — that is what makes it read as "type here" at a glance — with the keyboard
 * shortcut shown on the right. On the collapsed rail it is the magnifier alone,
 * matching the nav items beside it.
 */
export function SidebarSearchButton({ onOpen }: { onOpen: () => void }) {
  const isMac = useIsMac();

  return (
    <button
      onClick={onOpen}
      title="Search (⌘K)"
      aria-label="Search"
      aria-keyshortcuts="Meta+K Control+K"
      className="flex items-center gap-3 px-3 py-2.5 mb-2 rounded-xl border border-sidebar-border bg-background/60 text-sm text-sidebar-foreground/70 hover:text-foreground hover:border-primary/40 hover:bg-background transition cursor-pointer"
    >
      <Search className="w-5 h-5 shrink-0" />
      <span className={`${SIDEBAR_LABEL_CLASS} flex-1 text-left`}>Search</span>
      <kbd
        className={`${SIDEBAR_LABEL_CLASS} inline-flex items-center justify-center h-5 px-1.5 rounded border border-border bg-muted text-[10px] font-semibold text-muted-foreground shrink-0`}
      >
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}
