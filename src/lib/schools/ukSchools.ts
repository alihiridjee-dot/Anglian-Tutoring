import { MIN_QUERY_LENGTH, scoreRecord } from "@/lib/search/match";

/**
 * The UK school list behind the onboarding school picker.
 *
 * `public/uk-schools.json` is built from the four nations' official registers
 * by `scripts/schools/build_uk_schools.py` (see there for what is kept and how
 * to refresh it). It is fetched rather than imported so it stays out of the
 * app bundle: only a student on the school step ever downloads it.
 *
 * The list only suggests. Whatever the student types is what gets saved, so a
 * school that's missing, new or renamed never blocks anyone.
 */

export interface School {
  name: string;
  /** Town or council area, to tell apart the seven "Trinity School"s. */
  place: string;
}

export interface IndexedSchool extends School {
  nameKey: string;
  placeKey: string;
}

/** At most this many suggestions; past that the student should keep typing. */
export const MAX_SUGGESTIONS = 8;

/**
 * Folds a name or a query to the form both are compared in: no accents, no
 * apostrophes or full stops, "saint" as "st", "&" as "and", other punctuation
 * as spaces. So "st marys" finds "St Mary's" and "ysgol gwyr" finds "Ysgol Gŵyr".
 */
export function foldSchoolText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`.]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bsaint\b/g, "st")
    .trim();
}

export function indexSchools(schools: School[]): IndexedSchool[] {
  return schools.map((s) => ({
    ...s,
    nameKey: foldSchoolText(s.name),
    placeKey: foldSchoolText(s.place),
  }));
}

/**
 * The best matches for what the student has typed so far, best first.
 *
 * Every word typed must appear in the name or the place, in any order, so
 * "norwich notre dame" works. A name that starts with the whole query comes
 * first; then the usual word-start ranking from the site search; then the
 * shorter name, since the student has typed more of it.
 */
export function searchSchools(schools: IndexedSchool[], query: string): School[] {
  const folded = foldSchoolText(query);
  if (folded.length < MIN_QUERY_LENGTH) return [];
  const terms = folded.split(" ");

  const hits: Array<{ school: IndexedSchool; score: number }> = [];
  for (const school of schools) {
    const score = scoreRecord(
      [
        { text: school.nameKey, weight: 3 },
        { text: school.placeKey, weight: 1 },
      ],
      terms,
    );
    if (score > 0) {
      hits.push({ school, score: score + (school.nameKey.startsWith(folded) ? 500 : 0) });
    }
  }

  return hits
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.school.name.length - b.school.name.length ||
        a.school.name.localeCompare(b.school.name),
    )
    .slice(0, MAX_SUGGESTIONS)
    .map(({ school }) => ({ name: school.name, place: school.place }));
}

let loading: Promise<IndexedSchool[]> | null = null;

/** Fetches and indexes the list once per page load; a failure can be retried. */
export function loadUkSchools(): Promise<IndexedSchool[]> {
  loading ??= fetch("/uk-schools.json")
    .then((res) => {
      if (!res.ok) throw new Error(`School list: HTTP ${res.status}`);
      return res.json() as Promise<{ schools: Array<[string, string]> }>;
    })
    .then(({ schools }) => indexSchools(schools.map(([name, place]) => ({ name, place }))))
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}
