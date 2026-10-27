import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createDemoCrossingHandler } from "./demoCrossing";

const ENROLMENTS = ["user-enrolments-and-profile"];
const DEMO_SUBJECTS = { enrolledCourses: ["biology", "chemistry", "physics"] };
const OWN_SUBJECTS = { enrolledCourses: ["biology", "chemistry"] };

/** A real cache and a handler that starts on `pathname`. */
function setup(pathname: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const crossing = createDemoCrossingHandler(queryClient, pathname);
  /** One navigation, from its start to its page rendering. */
  const go = (to: string) => {
    crossing.navigating(to);
    crossing.mounting(to);
  };
  return { queryClient, crossing, go };
}

/** A screen reading the subjects, counting how often it asks. Its reads never land. */
function countedObserver(queryClient: QueryClient) {
  let reads = 0;
  const observer = new QueryObserver(queryClient, {
    queryKey: ENROLMENTS,
    queryFn: () => {
      reads++;
      return new Promise(() => {});
    },
    staleTime: Infinity,
  });
  return { observer, reads: () => reads };
}

/** A read that answers only when told to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("crossing between the demo and the app", () => {
  test("coming back from the demo, the app isn't shown the demo's subjects", () => {
    const { queryClient, go } = setup("/demo/student/dashboard");
    queryClient.setQueryData(ENROLMENTS, DEMO_SUBJECTS);

    go("/");

    expect(queryClient.getQueryData<unknown>(ENROLMENTS)).toBeUndefined();
  });

  test("opening the demo, it isn't shown the signed-in student's subjects", () => {
    const { queryClient, go } = setup("/student-dashboard");
    queryClient.setQueryData(ENROLMENTS, OWN_SUBJECTS);

    go("/demo/student/dashboard");

    expect(queryClient.getQueryData<unknown>(ENROLMENTS)).toBeUndefined();
  });

  test("the page on screen keeps its answers until the next one is about to render", () => {
    const { queryClient, crossing } = setup("/demo/student/dashboard");
    queryClient.setQueryData(ENROLMENTS, DEMO_SUBJECTS);

    crossing.navigating("/student-dashboard");
    expect(queryClient.getQueryData<unknown>(ENROLMENTS)).toEqual(DEMO_SUBJECTS);

    crossing.mounting("/student-dashboard");
    expect(queryClient.getQueryData<unknown>(ENROLMENTS)).toBeUndefined();
  });

  test("the page being left isn't asked again; the next page asks for its own side", () => {
    const { queryClient, go } = setup("/demo/student/dashboard");
    queryClient.setQueryData(ENROLMENTS, DEMO_SUBJECTS);
    const leaving = countedObserver(queryClient);
    const stopLeaving = leaving.observer.subscribe(() => {});

    go("/student-dashboard");
    stopLeaving();
    const next = countedObserver(queryClient);
    const stopNext = next.observer.subscribe(() => {});

    expect(leaving.reads()).toBe(0);
    expect(next.observer.getCurrentResult().data).toBeUndefined();
    expect(next.reads()).toBe(1);
    stopNext();
  });

  test("a read still in flight from the other side can't land afterwards", async () => {
    const { queryClient, go } = setup("/student-dashboard");
    const ownRead = deferred<typeof OWN_SUBJECTS>();
    const fetching = queryClient.fetchQuery({
      queryKey: ENROLMENTS,
      queryFn: () => ownRead.promise,
    });

    go("/demo/student/dashboard");
    ownRead.resolve(OWN_SUBJECTS);
    await fetching.catch(() => {});

    expect(queryClient.getQueryData<unknown>(ENROLMENTS)).toBeUndefined();
  });

  test("a trip into the demo turned back before it rendered resets the page on screen", () => {
    const { queryClient, crossing } = setup("/student-dashboard");
    const onScreen = countedObserver(queryClient);
    const stop = onScreen.observer.subscribe(() => {});

    crossing.navigating("/demo/student/dashboard");
    // A read made while the address bar said /demo answers with the demo's.
    queryClient.setQueryData(ENROLMENTS, DEMO_SUBJECTS);
    crossing.navigating("/student-dashboard");
    crossing.mounting("/student-dashboard");

    expect(queryClient.getQueryData<unknown>(ENROLMENTS)).toBeUndefined();
    expect(onScreen.observer.getCurrentResult().data).toBeUndefined();
    expect(onScreen.reads()).toBe(2); // once on screen, once more after the reset
    stop();
  });

  test("a save made just before crossing is kept", () => {
    const { queryClient, go } = setup("/profile");
    queryClient.getMutationCache().build(queryClient, { mutationKey: ["save-details"] });

    go("/demo/student/dashboard");

    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
  });
});

describe("moving around on one side", () => {
  test("a page change inside the app keeps the cache as it is", () => {
    const { queryClient, go } = setup("/student-dashboard");
    queryClient.setQueryData(ENROLMENTS, OWN_SUBJECTS);

    go("/homework");
    go("/");
    go("/student-dashboard");

    expect(queryClient.getQueryData<unknown>(ENROLMENTS)).toEqual(OWN_SUBJECTS);
    expect(queryClient.getQueryState(ENROLMENTS)?.isInvalidated).toBe(false);
  });

  test("a page change inside the demo keeps the cache as it is", () => {
    const { queryClient, go } = setup("/demo");
    queryClient.setQueryData(ENROLMENTS, DEMO_SUBJECTS);

    go("/demo/student/dashboard");
    go("/demo/student/planner");

    expect(queryClient.getQueryData<unknown>(ENROLMENTS)).toEqual(DEMO_SUBJECTS);
  });

  test("after a crossing, moving on inside the new side resets nothing more", () => {
    const { queryClient, go } = setup("/demo/student/dashboard");

    go("/student-dashboard");
    queryClient.setQueryData(ENROLMENTS, OWN_SUBJECTS);
    go("/homework");

    expect(queryClient.getQueryData<unknown>(ENROLMENTS)).toEqual(OWN_SUBJECTS);
  });
});
