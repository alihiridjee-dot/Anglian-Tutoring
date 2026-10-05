import type { AnyRouter, ParsedLocation, RouterHistory } from "@tanstack/react-router";

/**
 * Back lands on the thing you clicked.
 *
 * The router's own scroll restoration puts a page back at the pixel offset it
 * was left at, and it does so the moment the route renders — before a list has
 * loaded, before a topic has re-opened. A page that is still short then clamps
 * that offset, and the student comes back to a near copy of where they were,
 * with the card they opened somewhere off screen.
 *
 * So each history entry remembers three things here, in sessionStorage:
 *
 *   - which link or button in the page was clicked to leave it (its "mark"),
 *   - how far down the page was,
 *   - the view the page was showing — a tab, an open topic (`useEntryState`).
 *
 * Coming back to an entry — the header's arrow, the browser's, a phone's swipe;
 * they share one history — waits for the mark to be drawn again, centres it and
 * glows it once. A page left from the sidebar or the header has no mark, and
 * comes back at its old offset once it is tall enough to reach it.
 *
 * Entries are keyed by their position in the tab's history, which survives a
 * reload. Pushing a page discards everything from that position on, exactly as
 * the browser discards its forward pages, so a fresh visit always starts fresh.
 */

const STORE_KEY = "return-spots-v1";

/** Only clicks in the page itself are marks; the sidebar and header are not. */
const SCOPE = "[data-return-scope]";
const TARGETS = 'a[href], button, [role="button"], [role="link"]';

/** How long a page may take to draw the mark before we settle for its offset. */
const WAIT_MS = 6000;
/** The mark is held in place until the page around it has been still this long. */
const SETTLE_MS = 700;
/** A click is what left the page only if the navigation follows promptly. */
const CLICK_TTL_MS = 10_000;

type Mark = { tag: string; href?: string; text: string; nth: number };
type Entry = { path: string; mark?: Mark; y?: number; view?: Record<string, unknown> };
type Store = Record<string, Entry>;

const indexOf = (location: Pick<ParsedLocation, "state">) => location.state.__TSR_index ?? 0;

function readStore(): Store {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Private mode or a full quota: Back still works, just without the mark.
  }
}

/** The entry at a history position, if it still belongs to this page. */
function entryAt(index: number, path: string): Entry | undefined {
  const entry = readStore()[index];
  return entry?.path === path ? entry : undefined;
}

function updateEntry(index: number, path: string, patch: Partial<Entry>) {
  const store = readStore();
  const current = store[index]?.path === path ? store[index] : { path };
  store[index] = { ...current, ...patch };
  writeStore(store);
}

/** Drops every entry from `index` on: they are the forward pages a push discards. */
function dropFrom(index: number, only = false) {
  const store = readStore();
  for (const key of Object.keys(store)) {
    if (only ? Number(key) === index : Number(key) >= index) delete store[key];
  }
  writeStore(store);
}

// ── The page's view (see useEntryState) ─────────────────────────────────────

export function readEntryView(location: ParsedLocation, name: string): unknown {
  if (typeof window === "undefined") return undefined;
  return entryAt(indexOf(location), location.pathname)?.view?.[name];
}

export function writeEntryView(location: ParsedLocation, name: string, value: unknown) {
  if (typeof window === "undefined") return;
  const index = indexOf(location);
  const view = entryAt(index, location.pathname)?.view ?? {};
  updateEntry(index, location.pathname, { view: { ...view, [name]: value } });
}

// ── Marks ───────────────────────────────────────────────────────────────────

const squash = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

/** A link is known by where it goes, which survives its card changing status. */
function sameMark(el: Element, mark: Omit<Mark, "nth">) {
  if (el.tagName !== mark.tag) return false;
  return mark.href ? el.getAttribute("href") === mark.href : squash(el.textContent) === mark.text;
}

/** Matching links or buttons that are drawn — not a copy hidden at this width. */
function twins(mark: Omit<Mark, "nth">): Element[] {
  const scope = document.querySelector(SCOPE);
  if (!scope) return [];
  return [...scope.querySelectorAll(TARGETS)].filter(
    (el) => el.getClientRects().length > 0 && sameMark(el, mark),
  );
}

function markOf(target: EventTarget | null): Mark | null {
  if (!(target instanceof Element) || !target.closest(SCOPE)) return null;
  const el = target.closest(TARGETS);
  if (!el || !el.closest(SCOPE)) return null;
  const mark = {
    tag: el.tagName,
    href: el.getAttribute("href") ?? undefined,
    text: squash(el.textContent),
  };
  return { ...mark, nth: Math.max(0, twins(mark).indexOf(el)) };
}

function findMark(mark: Mark): HTMLElement | null {
  const found = twins(mark);
  return (found[mark.nth] ?? found[0] ?? null) as HTMLElement | null;
}

/**
 * Centres an element below the pinned header, or tops it there if it's taller.
 * Moves only when it is more than `slack` pixels out, and says if it moved.
 */
function centre(el: HTMLElement, slack: number) {
  const header = document.querySelector("main > header")?.getBoundingClientRect().bottom ?? 0;
  const room = window.innerHeight - header;
  const box = el.getBoundingClientRect();
  const want = box.height < room - 32 ? header + (room - box.height) / 2 : header + 16;
  if (Math.abs(box.top - want) <= slack) return false;
  // Near the end of a page it can't come further up; that's as good as it gets.
  const before = window.scrollY;
  window.scrollTo({ top: before + box.top - want, behavior: "instant" });
  return Math.abs(window.scrollY - before) >= 1;
}

function glow(el: HTMLElement) {
  el.classList.remove("return-glow");
  // Restart the animation if the same element is glowed twice in a row.
  void el.offsetWidth;
  el.classList.add("return-glow");
  // A timer rather than `animationend`, which a background tab never fires.
  window.setTimeout(() => el.classList.remove("return-glow"), 2000);
}

// ── Coming back ─────────────────────────────────────────────────────────────

let stopReturn: (() => void) | null = null;

function returnTo(entry: Entry) {
  stopReturn?.();
  const started = performance.now();
  let found: HTMLElement | null = null;
  let stillSince = 0;
  // A timer rather than animation frames, which a background tab never runs.
  let timer = 0;

  // Anything the student does with the page themselves ends it: we never
  // fight their own scrolling.
  const inputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const stop = () => {
    window.clearTimeout(timer);
    for (const type of inputs) window.removeEventListener(type, stop, true);
    stopReturn = null;
  };
  for (const type of inputs) window.addEventListener(type, stop, { capture: true, passive: true });
  stopReturn = stop;

  const reach = (y: number) => document.documentElement.scrollHeight - window.innerHeight >= y;

  const step = () => {
    const now = performance.now();
    if (found && !found.isConnected) found = null;
    if (found) {
      // Held until the page settles: a card loading in above it would push it
      // away. Only a real shift is followed, not a card's own rise-in.
      if (centre(found, 24)) stillSince = now;
      if (now - stillSince > SETTLE_MS || now - started > WAIT_MS + SETTLE_MS) return stop();
    } else if (entry.mark && (found = findMark(entry.mark))) {
      centre(found, 1);
      stillSince = now;
      glow(found);
    } else if (entry.y !== undefined && (!entry.mark || now - started > WAIT_MS)) {
      // No mark, or one that isn't coming back (the task moved tab): the old
      // offset, once the page is long enough to hold it.
      if (reach(entry.y) || now - started > WAIT_MS) {
        window.scrollTo({ top: entry.y, behavior: "instant" });
        return stop();
      }
    } else if (now - started > WAIT_MS) {
      return stop();
    }
    timer = window.setTimeout(step, 16);
  };
  step();
}

/**
 * Whether the router should leave this location's scroll to us. Passed as the
 * router's `scrollRestoration`, so a push still opens at the top and a page we
 * know nothing about still gets the router's own restoration.
 */
export function routerRestoresScroll({ location }: { location: ParsedLocation }) {
  if (typeof window === "undefined") return true;
  const entry = entryAt(indexOf(location), location.pathname);
  return !(entry?.mark || entry?.y !== undefined);
}

/** Wires the whole thing to a router. Returns the teardown. */
export function installReturnSpots(router: AnyRouter) {
  // A brand-new page load is a brand-new history entry: whatever an earlier
  // visit in this tab left at this position isn't ours.
  const nav = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  if (nav?.type === "navigate") dropFrom(indexOf(router.history.location));

  let pending: (Mark & { index: number; at: number }) | null = null;
  const onClick = (e: MouseEvent) => {
    const mark = markOf(e.target);
    pending = mark && { ...mark, index: indexOf(router.history.location), at: Date.now() };
  };
  document.addEventListener("click", onClick, true);

  const history: RouterHistory = router.history;
  let previous = history.location;
  let returning: number | null = null;
  const unsubscribeHistory = history.subscribe(({ location, action }) => {
    const from = previous;
    previous = location;
    if (location.state.__TSR_key === from.state.__TSR_key) return;
    const fromIndex = indexOf(from);
    const toIndex = indexOf(location);

    if (action.type === "PUSH") {
      const clicked =
        pending && pending.index === fromIndex && Date.now() - pending.at < CLICK_TTL_MS
          ? { tag: pending.tag, href: pending.href, text: pending.text, nth: pending.nth }
          : undefined;
      pending = null;
      updateEntry(fromIndex, from.pathname, { mark: clicked, y: window.scrollY });
      dropFrom(toIndex);
      returning = null;
    } else if (action.type === "REPLACE") {
      // A redirect onto another page makes this a different entry; the pages
      // ahead of it are still there to go forward to.
      if (location.pathname !== from.pathname) dropFrom(toIndex, true);
    } else {
      // Back, forward, or a jump: the page being left keeps its offset (for
      // coming forward to it again), and the one arrived at is restored once
      // it has rendered.
      updateEntry(fromIndex, from.pathname, { y: window.scrollY });
      returning = toIndex;
    }
  });

  const unsubscribeRendered = router.subscribe("onRendered", ({ toLocation }) => {
    if (returning === null || indexOf(toLocation) !== returning) return;
    returning = null;
    const entry = entryAt(indexOf(toLocation), toLocation.pathname);
    if (entry && (entry.mark || entry.y !== undefined)) returnTo(entry);
  });

  return () => {
    document.removeEventListener("click", onClick, true);
    unsubscribeHistory();
    unsubscribeRendered();
    stopReturn?.();
  };
}

// ── The header's Back when there is nothing behind ─────────────────────────

/** A page that is one of a list goes back to the list. */
const LIST_OF: [RegExp, string][] = [
  [/^((?:\/demo\/student)?)\/homework\/[^/]+$/, "$1/homework"],
  [/^((?:\/demo\/student)?)\/mcq\/[^/]+$/, "$1/mcqs"],
  [/^\/notes\/[^/]+$/, "/curriculum"],
  [/^\/students\/[^/]+$/, "/students"],
];

/**
 * Where Back goes when this tab has no earlier page of ours — a link opened in
 * a new tab, a bookmark. Without this the arrow would leave the site, or do
 * nothing. A spec point goes to its curriculum, a task to its list, and any
 * other page to the home page; home itself has nothing above it.
 */
export function pageAbove(location: Pick<ParsedLocation, "pathname" | "search">, home: string) {
  const { pathname } = location;
  for (const [pattern, list] of LIST_OF) {
    if (pattern.test(pathname)) return pathname.replace(pattern, list);
  }
  if ((location.search as { point?: unknown }).point) return pathname;
  return pathname === home ? null : home;
}
