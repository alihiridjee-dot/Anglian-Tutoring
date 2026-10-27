import { describe, expect, test } from "bun:test";
import { CalcError, evaluate, prettify, show, showText } from "@/lib/examKit/calculator";

/** The calculator must agree with the one in the exam room, sum for sum. */
describe("evaluate", () => {
  test("arithmetic in the usual order", () => {
    expect(evaluate("2+3×4")).toBe(14);
    expect(evaluate("(2+3)×4")).toBe(20);
    expect(evaluate("10÷4")).toBe(2.5);
    expect(evaluate("7−10")).toBe(-3);
    expect(evaluate("2*3-4/2")).toBe(4);
  });

  test("float dust is cleared", () => {
    expect(evaluate("0.1+0.2")).toBe(0.3);
  });

  test("a minus sign binds looser than a power", () => {
    expect(evaluate("−2²")).toBe(-4);
    expect(evaluate("(−2)²")).toBe(4);
    expect(evaluate("2^−3")).toBe(0.125);
    expect(evaluate("2^3^2")).toBe(512);
  });

  test("×10ˣ makes one number", () => {
    expect(evaluate("6.02ᴇ23")).toBe(6.02e23);
    expect(evaluate("3E-4")).toBe(0.0003);
    expect(evaluate("1÷3ᴇ4")).toBe(Number((1 / 30000).toPrecision(10)));
    expect(evaluate("1.6ᴇ−19×2")).toBe(3.2e-19);
  });

  test("side by side multiplies", () => {
    expect(evaluate("2π")).toBe(Number((2 * Math.PI).toPrecision(10)));
    expect(evaluate("3(4+1)")).toBe(15);
    expect(evaluate("(1+1)(2+2)")).toBe(8);
    expect(evaluate("2sin(30)")).toBe(1);
  });

  test("open brackets close at the end", () => {
    expect(evaluate("√(16")).toBe(4);
    expect(evaluate("2×(3+4")).toBe(14);
  });

  test("powers, roots and reciprocals", () => {
    expect(evaluate("5²")).toBe(25);
    expect(evaluate("2³")).toBe(8);
    expect(evaluate("4⁻¹")).toBe(0.25);
    expect(evaluate("√(2)²")).toBe(2);
    expect(evaluate("∛(−8)")).toBe(-2);
    expect(evaluate("(−8)^(1÷3)")).toBe(-2);
  });

  test("trig in degrees by default, radians when switched", () => {
    expect(evaluate("sin(30)")).toBe(0.5);
    expect(evaluate("sin(180)")).toBe(0);
    expect(evaluate("cos(90)")).toBe(0);
    expect(evaluate("sin⁻¹(0.5)")).toBe(30);
    expect(evaluate("tan⁻¹(1)")).toBe(45);
    expect(evaluate("sin(π÷2)", "rad")).toBe(1);
    expect(() => evaluate("tan(90)")).toThrow(CalcError);
  });

  test("logs, for pH and decay", () => {
    expect(evaluate("−log(1ᴇ−3)")).toBe(3);
    expect(evaluate("ln(e)")).toBe(1);
    expect(evaluate("10^(2)")).toBe(100);
    expect(evaluate("e^(0)")).toBe(1);
  });

  test("Ans is the last answer", () => {
    expect(evaluate("Ans×2", "deg", 21)).toBe(42);
    expect(evaluate("Ans²", "deg", -3)).toBe(9);
  });

  test("keyboard and key symbols read the same", () => {
    expect(evaluate("3*4")).toBe(evaluate("3×4"));
    expect(evaluate("8/2")).toBe(evaluate("8÷2"));
    expect(evaluate("5-2")).toBe(evaluate("5−2"));
    expect(evaluate("sqrt(9)")).toBe(3);
    expect(evaluate("pi")).toBe(evaluate("π"));
  });

  test("errors are worded as the calculator words them", () => {
    const err = (s: string) => {
      try {
        evaluate(s);
      } catch (e) {
        return (e as Error).message;
      }
      return "no error";
    };
    expect(err("1÷0")).toBe("Maths error");
    expect(err("√(−4)")).toBe("Maths error");
    expect(err("log(0)")).toBe("Maths error");
    expect(err("sin⁻¹(2)")).toBe("Maths error");
    expect(err("0⁻¹")).toBe("Maths error");
    expect(err("2+")).toBe("Syntax error");
    expect(err("×3")).toBe("Syntax error");
    expect(err("2)")).toBe("Syntax error");
    expect(err("")).toBe("Syntax error");
    expect(err("3ᴇ")).toBe("Syntax error");
    expect(err("abc")).toBe("Syntax error");
  });
});

describe("show", () => {
  test("plain digits between 0.01 and ten billion", () => {
    expect(show(14)).toEqual({ digits: "14", exponent: null });
    expect(show(0.25)).toEqual({ digits: "0.25", exponent: null });
    expect(show(-3.5)).toEqual({ digits: "-3.5", exponent: null });
    expect(show(0.01)).toEqual({ digits: "0.01", exponent: null });
    expect(show(1234567890)).toEqual({ digits: "1234567890", exponent: null });
  });

  test("standard form outside it", () => {
    expect(show(6.02e23)).toEqual({ digits: "6.02", exponent: 23 });
    expect(show(0.0003)).toEqual({ digits: "3", exponent: -4 });
    expect(show(1e10)).toEqual({ digits: "1", exponent: 10 });
    expect(show(-1.6e-19)).toEqual({ digits: "-1.6", exponent: -19 });
  });

  test("ten significant figures at most", () => {
    expect(show(1 / 3).digits).toBe("0.3333333333");
    expect(show(2 / 3).digits).toBe("0.6666666667");
    expect(showText(1 / 30000)).toBe("3.333333333 × 10^-5");
  });

  test("zero is zero", () => {
    expect(show(0)).toEqual({ digits: "0", exponent: null });
  });
});

test("prettify swaps plain typing for key symbols, one for one", () => {
  const typed = "3*4/2-1";
  const pretty = prettify(typed);
  expect(pretty).toBe("3×4÷2−1");
  expect(pretty.length).toBe(typed.length);
});
