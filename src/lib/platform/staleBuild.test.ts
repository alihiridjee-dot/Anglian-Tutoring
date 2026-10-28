import { afterEach, describe, expect, test } from "bun:test";
import { isStaleBuildError, reloadForNewBuild } from "./staleBuild";

describe("isStaleBuildError", () => {
  test("knows each browser's words for a code file that is gone", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://angliaeducate.co.uk/assets/planner-HMyv3IRJ.js",
      "error loading dynamically imported module: https://angliaeducate.co.uk/assets/a.js",
      "Importing a module script failed.",
      "Unable to preload CSS for /assets/styles-ChHljdww.css",
    ]) {
      expect(isStaleBuildError(new TypeError(message))).toBe(true);
    }
  });

  test("leaves every other failure alone", () => {
    expect(isStaleBuildError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isStaleBuildError({ message: "permission denied for table topics" })).toBe(false);
    expect(isStaleBuildError(null)).toBe(false);
  });
});

describe("reloadForNewBuild", () => {
  const g = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete g.window;
    delete g.sessionStorage;
  });

  const fakeBrowser = (storage: Partial<Storage>) => {
    let reloads = 0;
    g.window = { location: { reload: () => reloads++ } };
    g.sessionStorage = storage;
    return () => reloads;
  };

  test("reloads once, then leaves the error showing for a minute", () => {
    const store = new Map<string, string>();
    const reloads = fakeBrowser({
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    });
    expect(reloadForNewBuild(1_000_000)).toBe(true);
    expect(reloadForNewBuild(1_030_000)).toBe(false);
    expect(reloads()).toBe(1);
    expect(reloadForNewBuild(1_070_000)).toBe(true);
    expect(reloads()).toBe(2);
  });

  test("never reloads when it can't remember having reloaded", () => {
    const reloads = fakeBrowser({
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(reloadForNewBuild()).toBe(false);
    expect(reloads()).toBe(0);
  });
});
