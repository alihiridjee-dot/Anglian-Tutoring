import { Component, type ReactNode } from "react";
import { ErrorNote } from "@/components/Shared";

/**
 * Round the workbench: if it fails to draw, the tutor is told why and can try
 * again, instead of meeting a blank planner. The header's own way back to the
 * roster is gone with the rest, so the note says how to get there.
 */
export class WorkbenchBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="premium-card space-y-3 p-4">
        <ErrorNote error={this.state.error} onRetry={() => this.setState({ error: null })} />
        <p className="text-sm">The planner link in the menu goes back to the list of students.</p>
      </div>
    );
  }
}
