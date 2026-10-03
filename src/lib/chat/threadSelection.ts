/**
 * Which conversation a list keeps open, given the list as it is now.
 *
 * The first thread is opened on arrival, and the choice is then pinned: a
 * re-sorted list (a reply landing in another thread moves it to the top) never
 * moves the open pane. Following "whatever is first" switched a parent into a
 * different conversation mid-sentence, and the half-written reply went with it.
 *
 * "Not in the list" has two meanings, and only one of them is "gone". A thread
 * that was just created isn't in the list until the refetch lands, so it is
 * kept. Only a selection that has been seen in the list, and has now left it
 * (deleted, or another child's list on the Parent Portal), is replaced.
 *
 * `seen` is the caller's record across renders; this adds the selection to it.
 */
export function pinnedSelection(
  ids: readonly string[],
  selectedId: string | null,
  seen: Set<string>,
): string | null {
  if (selectedId && ids.includes(selectedId)) {
    seen.add(selectedId);
    return selectedId;
  }
  if (selectedId && !seen.has(selectedId)) return selectedId;
  return ids[0] ?? selectedId;
}
