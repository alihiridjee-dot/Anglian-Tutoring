import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import { ErrorNote } from "@/components/Shared";
import { CTRL } from "./figures";

export type PlannerLayout = "classic" | "workbench";
const KEY = "planner.layout";

/**
 * Which layout this tutor has the planner in. It is their own choice on this
 * browser, so it is kept in the browser and nowhere else; a browser that won't
 * store it simply opens in the classic layout each time.
 *
 * The classic layout is the default while the workbench is new: it has not yet
 * been used on a real student, and a tutor mid-week should meet it by choosing
 * to. Read after mount, so the server's page and the browser's first draw agree.
 */
export function usePlannerLayout(): [PlannerLayout, (layout: PlannerLayout) => void] {
  const [layout, setLayout] = useState<PlannerLayout>("classic");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === "workbench") setLayout("workbench");
    } catch {
      // No storage (a private window, blocked site data): stay on the default.
    }
  }, []);
  const choose = useCallback((next: PlannerLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // The choice still holds for this visit.
    }
  }, []);
  return [layout, choose];
}

/**
 * Round the workbench: if it fails to draw, the tutor is told why and given the
 * way back to the classic layout, instead of a blank planner.
 */
export class WorkbenchBoundary extends Component<
  { onClassic: () => void; children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="premium-card space-y-3 p-4">
        <ErrorNote error={this.state.error} />
        <button type="button" className={CTRL} onClick={this.props.onClassic}>
          Back to the classic layout
        </button>
      </div>
    );
  }
}
