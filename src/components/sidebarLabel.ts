/**
 * Class for any text inside the sidebar rail that only belongs to the expanded
 * state — labels, the wordmark, the search shortcut.
 *
 * The text stays mounted and is revealed with opacity rather than `hidden`, so
 * the rail's contents never reflow mid-transition; the rail's `overflow-hidden`
 * clips whatever sticks out while it is collapsed. The short delay lets the
 * width animation get under way before the labels fade in, which is what stops
 * them from appearing to slide out of the icons.
 *
 * `group/sidebar` is declared on the `<aside>` in `AppLayout`.
 */
export const SIDEBAR_LABEL_CLASS =
  "whitespace-nowrap opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/sidebar:opacity-100 group-hover/sidebar:delay-100";
