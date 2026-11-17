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
      data-guide="search"
      onClick={onOpen}
      aria-label="Search"
      aria-keyshortcuts="Meta+K Control+K"
      className="side-row tint-slate group/row flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm"
    >
      <span className="side-ic shrink-0">
        <Search className="size-5" aria-hidden />
      </span>
      <span className={`${SIDEBAR_LABEL_CLASS} flex-1 text-left`}>Search</span>
      <kbd className="drawer:hidden text-muted-foreground shrink-0 font-sans text-[11px] font-bold whitespace-nowrap opacity-0 transition-opacity group-hover/row:opacity-100">
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}
