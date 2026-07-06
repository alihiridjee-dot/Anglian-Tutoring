import React from "react";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export const inputCls =
  "w-full h-10 rounded-lg bg-secondary border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

export const submitBtn =
  "w-full h-10 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-60";
