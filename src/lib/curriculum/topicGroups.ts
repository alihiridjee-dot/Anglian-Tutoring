/** A course topic, as the Marked tabs file work under it. */
export type TopicRef = { id: string; title: string; order: number };

/** Text order, with runs of digits compared as numbers. */
const byKey = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * Work filed under the course's topics, which is how both Marked tabs — Tasks
 * and MCQs — list what has come back (Ali, 7 Oct 2026). Marked only grows, and
 * one long newest-first list stopped saying anything once it ran to dozens;
 * under its topic a mark reads as part of the course.
 *
 * Topics go in the course's order, and the work inside each in spec point
 * order: `sortKey` is the code, or a title that starts with it, compared with
 * runs of digits as numbers so 4.1.1.2 comes before 4.1.1.10. Work with no
 * topic still gets a heading from `topicOf` rather than vanishing — give those
 * an `order` past every real topic so they come last.
 */
export function groupUnderTopics<T>(
  items: T[],
  topicOf: (item: T) => TopicRef,
  sortKey: (item: T) => string,
): Array<{ key: string; title: string; items: T[] }> {
  const groups = new Map<string, { topic: TopicRef; items: T[] }>();
  for (const item of items) {
    const topic = topicOf(item);
    const group = groups.get(topic.id) ?? { topic, items: [] };
    group.items.push(item);
    groups.set(topic.id, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.topic.order - b.topic.order || byKey(a.topic.title, b.topic.title))
    .map(({ topic, items: list }) => ({
      key: topic.id,
      title: topic.title,
      items: [...list].sort((a, b) =>
        byKey(sortKey(a).toLocaleLowerCase(), sortKey(b).toLocaleLowerCase()),
      ),
    }));
}

/** The heading for work with no topic, after every real one. */
export function noTopic(id: string, title: string): TopicRef {
  return { id, title, order: Number.MAX_SAFE_INTEGER };
}
