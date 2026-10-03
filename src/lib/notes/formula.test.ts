import { describe, expect, test } from "bun:test";
import { evaluate, parseFormula, variablesOf } from "./formula";

const run = (src: string, vars: Record<string, number> = {}) => evaluate(parseFormula(src), vars);

describe("formula", () => {
  test("respects precedence, brackets, powers and unary minus", () => {
    expect(run("2 + 3 * 4")).toBe(14);
    expect(run("(2 + 3) * 4")).toBe(20);
    expect(run("2 ^ 3 ^ 2")).toBe(512);
    expect(run("-2 ^ 2")).toBe(-4);
    expect(run("2 ^ -1")).toBe(0.5);
    expect(run("3 * -2")).toBe(-6);
    expect(run("10 / 4")).toBe(2.5);
  });

  test("stopping distance: thinking plus braking", () => {
    expect(run("v*t + v^2/(2*a)", { v: 20, t: 0.7, a: 6.5 })).toBeCloseTo(14 + 400 / 13, 6);
  });

  test("functions and variables", () => {
    expect(run("sqrt(x) + max(1, y, 3)", { x: 16, y: 7 })).toBe(11);
    expect([...variablesOf(parseFormula("m*c*dT + abs(k)"))].sort()).toEqual(["c", "dT", "k", "m"]);
  });

  test("rejects anything that isn't arithmetic", () => {
    for (const bad of ["alert(1)", "x;y", "a.b", "2 +", "(1", "1 2", "window['x']"])
      expect(() => run(bad, { x: 1, y: 1, a: 1 })).toThrow();
    expect(() => run("z", {})).toThrow();
  });
});
