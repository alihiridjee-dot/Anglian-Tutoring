import { Children, createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { DUE_LANE_LABEL, type DueLane } from "@/lib/planner/dueLanes";

/** Each lane's colour, the dashboard's (see `ThisWeekLanes`). */
const LANE_TINT: Record<DueLane, string> = {
  new: "tint-primary",
  returning: "tint-amber",
  revision: "tint-rose",
  tutor: "tint-accent",
  yours: "tint-slate",
};

/**
 * A desktop screen: from here up the lanes stand side by side, each its own
 * panel (Ali, 25 Nov 2026). Below it they stay one card, one lane under another.
 */
const WIDE = "(min-width: 64rem)";

/** Whether the screen is wide enough for panels; false until the page has hydrated. */
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** True inside `DueLanes` on a wide screen, where each lane is its own card. */
const AsPanels = createContext(false);

/** How many panels stand in a row: as many as there are lanes, three at most. */
const COLUMNS = ["", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3"];

/** The one button on a row. */
export const DUE_GO =
  "btn-solid inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 py-2 text-sm";

/**
 * One lane of Due: a plain heading inside the one card (on a desktop, its own
 * panel), then its work as bare rows.
 *
 * Due used to be a card per lane, a card per sheet inside it and a box for the
 * marks inside that, with a "to do" pill and a fold arrow on every lane. Ali
 * found it overwhelming (17 Nov 2026) and picked "one list": one card, the
 * lanes as headings in the dashboard's names and colours (how many are left
 * in a round dot, then the name), and each piece of work a bare row. Nothing
 * folds, so the whole week is on screen.
 *
 * Tasks and MCQs both use it, so the two pages split the week the same way and
 * the student meets one set of names and colours: the dashboard's.
 */
export function DueSection({
  lane,
  count,
  children,
}: {
  lane: DueLane;
  count: number;
  children: ReactNode;
}) {
  const panel = useContext(AsPanels);
  return (
    <section className={`${LANE_TINT[lane]} min-w-0 ${panel ? "premium-card p-5" : ""}`}>
      <h2 className="flex items-center gap-2.5 text-xl leading-tight font-extrabold">
        {/* How many are left, in a dot of the lane's colour (Ali, 19 Nov). */}
        <span
          aria-hidden
          className="icon-tile icon-tile-solid numeral grid size-9 shrink-0 place-items-center rounded-full text-lg"
        >
          {count}
        </span>
        <span className="min-w-0">
          {DUE_LANE_LABEL[lane]}
          <span className="sr-only">, {count} to do</span>
        </span>
      </h2>
      {/* A panel is narrow, so its rows use the full width rather than
          lining up under the heading's words. */}
      <ul className={panel ? "mt-2" : "mt-1 sm:pl-12"}>{children}</ul>
    </section>
  );
}

/**
 * A piece of work in a lane: the title in bold, one dark line under it, and one
 * button. No border or background of its own, as on a spec point's page.
 */
export function DueRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
      <div className="min-w-0 flex-1 basis-40">
        <p className="font-display text-lg leading-snug font-bold break-words">{title}</p>
        {detail && <p className="mt-0.5 text-sm">{detail}</p>}
      </div>
      {children}
    </li>
  );
}

/**
 * The lanes, with the subject's colour glowing softly behind them. The lanes
 * wear the dashboard's colours; the glow keeps the page the subject's.
 *
 * On a phone or tablet they are one card, one lane under another. On a desktop
 * (Ali, 25 Nov 2026) each lane is its own panel and they stand side by side, as
 * many across as there are lanes up to three, all the same height; a fourth or
 * fifth lane starts the next row.
 */
export function DueLanes({ children }: { children: ReactNode }) {
  const wide = useWide();
  if (wide) {
    const across = Math.min(Children.count(children), 3);
    return (
      <div className="glow-behind">
        <div className={`grid items-stretch gap-5 ${COLUMNS[across]}`}>
          <AsPanels.Provider value>{children}</AsPanels.Provider>
        </div>
      </div>
    );
  }
  return (
    <div className="glow-behind">
      <div className="premium-card space-y-6 p-4 sm:p-6">{children}</div>
    </div>
  );
}
