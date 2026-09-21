export type Topic = {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  sort_order: number;
};

export type SpecPoint = {
  id: string;
  topic_id: string;
  code: string;
  title: string;
  description: string | null;
};

export type Resource = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  video_url: string | null;
  file_path: string | null;
  file_name: string | null;
  starts_at: string | null;
  join_url: string | null;
  due_at: string | null;
};

export type McqSet = {
  id: string;
  title: string;
  published: boolean;
};

/** A spec point returned by a search, carrying the topic it belongs to. */
export type SpecPointMatch = SpecPoint & {
  topic: { id: string; code: string | null; title: string };
  /** Descending relevance from `scoreRecord`. */
  score: number;
};
