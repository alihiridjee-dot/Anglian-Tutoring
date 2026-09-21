export const inputCls =
  "w-full h-9 rounded-md bg-secondary border border-border px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

export const labelOf = (list: readonly { value: string; label: string }[], v: string) =>
  list.find((x) => x.value === v)?.label ?? v;
