import { useEffect, useState, type ReactNode } from "react";
import { Maximize2, X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

/**
 * A note picture that fits its card on any screen and opens full size when
 * tapped.
 *
 * The wide pictures (graphs, the electrolysis cell, the road and wave scenes)
 * used to keep a minimum width and scroll sideways, so on a phone held upright
 * a third of each one started off-screen. Now the picture shrinks to the card,
 * whole, and the full-size view draws it at `naturalWidth`, its own viewBox
 * width, where the labels are the size they were drawn at. That view fits a
 * phone turned sideways; upright it scrolls, which is what enlarging means.
 *
 * The whole picture is the button. Its name comes from the picture's own
 * label, so a screen reader still hears what the picture shows.
 */
export function ZoomableFigure({
  label,
  naturalWidth,
  children,
}: {
  /** What the picture shows, for the full-size dialog's name. */
  label: string;
  /** The picture's viewBox width: drawn at this width, its labels read at full size. */
  naturalWidth: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group block w-full cursor-zoom-in rounded-xl text-left"
      >
        <span className="sr-only">Show full size: </span>
        {children}
        {/* Under the picture, not on it: graphs put their line labels in the
            top corner, and an icon there covered them. */}
        <span aria-hidden className="mt-1 flex justify-end">
          <span className="icon-tile size-7 opacity-80 transition group-hover:opacity-100">
            <Maximize2 className="size-3.5" />
          </span>
        </span>
      </button>
      {open && (
        <FullSize label={label} naturalWidth={naturalWidth} onClose={() => setOpen(false)}>
          {children}
        </FullSize>
      )}
    </>
  );
}

function FullSize({
  label,
  naturalWidth,
  onClose,
  children,
}: {
  label: string;
  naturalWidth: number;
  onClose: () => void;
  children: ReactNode;
}) {
  useBodyScrollLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // Fixed, so it misses the body's notch padding: it pads itself.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      className="bg-primary-deep/50 fixed inset-0 z-50 flex items-center justify-center py-4 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="premium-card flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden"
      >
        {/* The close button stays put while a wide picture scrolls under it. */}
        <div className="flex shrink-0 justify-end p-2">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="Close"
            className="btn-soft flex size-11 cursor-pointer items-center justify-center rounded-xl"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="scroll-slim min-h-0 overflow-auto overscroll-contain px-4 pb-4">
          <div style={{ minWidth: naturalWidth }}>{children}</div>
        </div>
      </div>
    </div>
  );
}
