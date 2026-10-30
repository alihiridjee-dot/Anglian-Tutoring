import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { familyTree, type FamilyTreeBrief } from "./familyTree";

const brief = familyTree.samples[0].brief;
const svg = drawWithCode(brief)!.svg;
const swap = (from: string, to: string, s = svg) => {
  expect(s).toContain(from);
  return s.replace(from, to);
};
const problemsOf = (s: string) => checkFigure(s, brief).problems;
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};
const people = (brief as unknown as FamilyTreeBrief).people;

describe("a family tree is held to its people and who is whose child", () => {
  test("two people's numbers swapped: 7 would look like the child of 4", () => {
    const swapped = swap(
      'x="192" y="138" text-anchor="middle">5<',
      'x="192" y="138" text-anchor="middle">4<',
      swap('x="152" y="138" text-anchor="middle">4<', 'x="152" y="138" text-anchor="middle">5<'),
    );
    expect(problemsOf(swapped)).toContain("Person 4's number is not written under their symbol");
    expect(problemsOf(swapped)).toContain("Person 5's number is not written under their symbol");
  });

  test("shading on the wrong person, or a female drawn as a square", () => {
    const shaded = swap(
      "</svg>",
      '<rect class="qf-ink" x="139" y="95" width="26" height="26"/></svg>',
    );
    expect(problemsOf(shaded)).toContain(
      "Person 4 is not shaded as the brief has them: unaffected, not shaded",
    );
    const unshaded = swap('<circle class="qf-ink" cx="112" cy="108" r="13"/>', "");
    expect(problemsOf(unshaded)).toContain(
      "Person 3 is not shaded as the brief has them: affected, shaded all over",
    );
    const square = swap(
      '<circle class="qf-line" cx="248" cy="108" r="13"/>',
      '<rect class="qf-line" x="235" y="95" width="26" height="26"/>',
    );
    expect(problemsOf(square)).toContain("Person 6 is not drawn as a circle at (248, 108)");
  });

  test("a child left off its parents' line, or a couple the brief doesn't have", () => {
    const dropped = swap('<line class="qf-line" x1="240" y1="152" x2="240" y2="175"/>', "");
    expect(problemsOf(dropped)).toContain(
      "The children drawn hanging from persons 5 and 6 are 7; the brief gives 7 and 8",
    );
    // A line joining brother and sister 4 and 5 reads as a marriage.
    const married = swap(
      "</svg>",
      '<line class="qf-line" x1="165" y1="108" x2="179" y2="108"/></svg>',
    );
    expect(problemsOf(married)).toContain(
      "Persons 4 and 5 are joined as a couple; the brief has no such couple",
    );
  });

  test("a stray line or a caption", () => {
    const stray = swap(
      "</svg>",
      '<line class="qf-line" x1="300" y1="100" x2="300" y2="140"/></svg>',
    );
    expect(problemsOf(stray).join()).toContain(
      "The line from (300, 100) to (300, 140) ends at (300, 100), where it joins nothing",
    );
    const caption = swap(
      "</svg>",
      '<text class="qf-text" x="300" y="200" text-anchor="middle">carrier</text></svg>',
    );
    expect(problemsOf(caption)).toContain(
      'Text "carrier" is not a person\'s number or part of the key',
    );
  });

  test("two families joined by a marriage draw and pass", () => {
    const joined = familyTree.samples[1].brief;
    const figure = drawWithCode(joined)!;
    expect(checkFigure(figure.svg, joined).problems).toEqual([]);
  });
});

describe("a family tree brief keeps to how families work", () => {
  test("a child has one mother and one father", () => {
    expect(
      problem({
        ...brief,
        couples: [
          { parents: ["1", "4"], children: ["3"] },
          { parents: ["5", "6"], children: ["7", "8"] },
        ],
      }),
    ).toBe("has 1 and 4 as a couple, who are not one male and one female");
    expect(
      problem({
        ...brief,
        couples: [
          { parents: ["1", "2"], children: ["3", "4", "5"] },
          { parents: ["5", "6"], children: ["7", "8", "3"] },
        ],
      }),
    ).toBe("gives person 3 two sets of parents");
  });

  test("no brother and sister as a couple, at most three generations, no one left out", () => {
    expect(
      problem({
        ...brief,
        couples: [
          { parents: ["1", "2"], children: ["3", "4", "5", "6"] },
          { parents: ["3", "4"], children: ["7", "8"] },
        ],
      }),
    ).toBe("has a brother and sister as a couple");
    expect(
      problem({
        ...brief,
        couples: [
          { parents: ["1", "2"], children: ["3", "4"] },
          { parents: ["4", "6"], children: ["5"] },
          { parents: ["5", "7"], children: ["8"] },
        ],
      }),
    ).toBe("has more than three generations");
    expect(
      problem({
        ...brief,
        couples: [{ parents: ["1", "2"], children: ["3", "4", "5"] }],
      }),
    ).toBe("has person 6 in no couple");
  });

  test("an affected carrier, or a generation too wide for the page", () => {
    expect(
      problem({
        ...brief,
        people: [{ id: "1", sex: "male", affected: true, carrier: true }, ...people.slice(1)],
      }),
    ).toBe("has person 1 both affected and a carrier");
    // Six children, three of them married: nine people side by side in the second generation.
    const person = (id: number, sex: string) => ({ id: String(id), sex, affected: false });
    expect(
      problem({
        kind: "family-tree",
        people: [
          person(1, "male"),
          person(2, "female"),
          ...[3, 4, 5, 6, 7, 8].map((id) => person(id, "male")),
          ...[9, 10, 11].map((id) => person(id, "female")),
          ...[12, 13, 14].map((id) => person(id, "female")),
        ],
        couples: [
          { parents: ["1", "2"], children: ["3", "4", "5", "6", "7", "8"] },
          { parents: ["3", "9"], children: ["12"] },
          { parents: ["4", "10"], children: ["13"] },
          { parents: ["5", "11"], children: ["14"] },
        ],
      }),
    ).toBe("is too wide to fit: fewer people side by side in a generation");
  });
});
