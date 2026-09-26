import React, { useId } from "react";

const CONTROLS = new Set(["input", "select", "textarea"]);

/**
 * A labelled form control.
 *
 * The label is wired by id to the first plain `<input>`, `<select>` or
 * `<textarea>` among the children (an error line may follow it), so tapping
 * the label focuses the field and a screen reader names it. A control that
 * already carries an `id` keeps it.
 */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const generatedId = useId();
  let id: string | undefined;
  const nodes = React.Children.map(children, (node) => {
    if (id !== undefined || !React.isValidElement<{ id?: string }>(node)) return node;
    if (typeof node.type !== "string" || !CONTROLS.has(node.type)) return node;
    id = node.props.id ?? generatedId;
    return React.cloneElement(node, { id });
  });
  return (
    <div>
      <label
        htmlFor={id}
        className="text-xs uppercase tracking-widest text-muted-foreground font-semibold"
      >
        {label}
      </label>
      <div className="mt-1">{nodes}</div>
    </div>
  );
}

export const inputCls =
  "w-full h-11 sm:h-10 rounded-lg bg-secondary border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

export const submitBtn =
  "w-full h-11 sm:h-10 rounded-lg btn-solid font-semibold text-sm hover:opacity-90 disabled:opacity-60";
