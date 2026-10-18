/**
 * The periodic table each board prints in its chemistry papers.
 *
 * The boards don't print the same table. Edexcel and AQA give whole-number
 * masses except chlorine and copper (35.5 and 63.5); Cambridge IGCSE rounds
 * copper to 64 and prints the lanthanoids and actinoids underneath; OCR and
 * every A-level data booklet give masses to one decimal place (Fe 55.8). A
 * student's sums only match their mark scheme with their own board's values,
 * so each sheet here is copied from that board's paper, mass for mass, with the
 * notes printed under it.
 */

import type { BoardV, LevelV } from "@/lib/curriculum/taxonomy";

export interface Element {
  z: number;
  symbol: string;
  name: string;
}

/** Every element, in atomic-number order (index = z − 1). British spellings, as the papers print them. */
const NAMES = (
  "H hydrogen,He helium,Li lithium,Be beryllium,B boron,C carbon,N nitrogen,O oxygen,F fluorine,Ne neon," +
  "Na sodium,Mg magnesium,Al aluminium,Si silicon,P phosphorus,S sulfur,Cl chlorine,Ar argon,K potassium,Ca calcium," +
  "Sc scandium,Ti titanium,V vanadium,Cr chromium,Mn manganese,Fe iron,Co cobalt,Ni nickel,Cu copper,Zn zinc," +
  "Ga gallium,Ge germanium,As arsenic,Se selenium,Br bromine,Kr krypton,Rb rubidium,Sr strontium,Y yttrium,Zr zirconium," +
  "Nb niobium,Mo molybdenum,Tc technetium,Ru ruthenium,Rh rhodium,Pd palladium,Ag silver,Cd cadmium,In indium,Sn tin," +
  "Sb antimony,Te tellurium,I iodine,Xe xenon,Cs caesium,Ba barium,La lanthanum,Ce cerium,Pr praseodymium,Nd neodymium," +
  "Pm promethium,Sm samarium,Eu europium,Gd gadolinium,Tb terbium,Dy dysprosium,Ho holmium,Er erbium,Tm thulium,Yb ytterbium," +
  "Lu lutetium,Hf hafnium,Ta tantalum,W tungsten,Re rhenium,Os osmium,Ir iridium,Pt platinum,Au gold,Hg mercury," +
  "Tl thallium,Pb lead,Bi bismuth,Po polonium,At astatine,Rn radon,Fr francium,Ra radium,Ac actinium,Th thorium," +
  "Pa protactinium,U uranium,Np neptunium,Pu plutonium,Am americium,Cm curium,Bk berkelium,Cf californium,Es einsteinium,Fm fermium," +
  "Md mendelevium,No nobelium,Lr lawrencium,Rf rutherfordium,Db dubnium,Sg seaborgium,Bh bohrium,Hs hassium,Mt meitnerium,Ds darmstadtium," +
  "Rg roentgenium,Cn copernicium,Nh nihonium,Fl flerovium,Mc moscovium,Lv livermorium,Ts tennessine,Og oganesson"
).split(",");

export const ELEMENTS: Element[] = NAMES.map((entry, i) => {
  const [symbol, name] = entry.split(" ");
  return { z: i + 1, symbol, name };
});

/** Lanthanoids 57–71 and actinoids 89–103: the two rows printed under the table, when they are. */
export const isFBlock = (z: number) => (z >= 57 && z <= 71) || (z >= 89 && z <= 103);

/**
 * Where an element sits in the main table: its period (row) and group column
 * (1–18). The f-block has no main-table place; La and Ac stand in group 3 on
 * sheets that leave the rest of their rows out.
 */
export function position(z: number): { period: number; group: number } | null {
  if (z === 1) return { period: 1, group: 1 };
  if (z === 2) return { period: 1, group: 18 };
  if (z <= 18) {
    const period = z <= 10 ? 2 : 3;
    const k = z - (period === 2 ? 2 : 10); // 1..8 across the period
    return { period, group: k <= 2 ? k : k + 10 };
  }
  if (z <= 36) return { period: 4, group: z - 18 };
  if (z <= 54) return { period: 5, group: z - 36 };
  if (z <= 56) return { period: 6, group: z - 54 };
  if (z === 57) return { period: 6, group: 3 };
  if (z <= 71) return null;
  if (z <= 86) return { period: 6, group: z - 68 };
  if (z <= 88) return { period: 7, group: z - 86 };
  if (z === 89) return { period: 7, group: 3 };
  if (z <= 103) return null;
  return { period: 7, group: z - 100 };
}

/** Column (3–17) of an f-block element in its row under the table. */
export const fColumn = (z: number) => (z >= 89 ? z - 89 : z - 57) + 3;

export interface PeriodicSheet {
  /** Whose sheet this is, as the panel names it: "Edexcel GCSE". */
  label: string;
  /** The relative atomic mass as printed, keyed by atomic number: "35.5", "[98]", "–". */
  masses: Record<number, string>;
  /** The last element printed in the main table. */
  lastZ: number;
  /**
   * What happens to the lanthanoids and actinoids: "omit" leaves them out and
   * puts La and Ac in group 3, marked *; "rows" prints them as two rows
   * underneath, with a placeholder in group 3.
   */
  fBlock: "omit" | "rows";
  /** The top of a cell reads mass first (AQA, Edexcel) or atomic number first (Cambridge, OCR). */
  massFirst: boolean;
  /** The labels over the eight main-group columns (groups 1, 2 and 13–18). */
  groups: string[];
  /** The lines printed under the table, word for word. */
  notes: string[];
  /** The notes that are data a calculation needs (molar gas volume), shown in the panel too. */
  dataNotes: string[];
}

/** Whole numbers but chlorine and copper, as Edexcel and AQA print them (elements 1–111). */
const WHOLE: Record<number, string> = {};
(
  "1 4 7 9 11 12 14 16 19 20 23 24 27 28 31 32 35.5 40 39 40 45 48 51 52 55 56 59 59 63.5 65 " +
  "70 73 75 79 80 84 85 88 89 91 93 96 [98] 101 103 106 108 112 115 119 122 128 127 131 133 137 139"
)
  .split(" ")
  .forEach((m, i) => (WHOLE[i + 1] = m));
"178 181 184 186 190 192 195 197 201 204 207 209 [209] [210] [222] [223] [226] [227]"
  .split(" ")
  .forEach((m, i) => (WHOLE[i + 72] = m));
"[261] [262] [266] [264] [277] [268] [271] [272]"
  .split(" ")
  .forEach((m, i) => (WHOLE[i + 104] = m));

/**
 * Cambridge IGCSE 0620: whole numbers but chlorine, copper rounded to 64, a
 * dash where there is no stable isotope, and the f-block rows filled in.
 */
const CAMBRIDGE: Record<number, string> = {};
for (let z = 1; z <= 118; z++) {
  const m = WHOLE[z];
  CAMBRIDGE[z] = m && !m.startsWith("[") ? m : "–";
}
CAMBRIDGE[29] = "64";
"139 140 141 144 – 150 152 157 159 163 165 167 169 173 175"
  .split(" ")
  .forEach((m, i) => (CAMBRIDGE[i + 57] = m));
"– 232 231 238 – – – – – – – – – – –".split(" ").forEach((m, i) => (CAMBRIDGE[i + 89] = m));

/** One decimal place, as OCR's data sheet and the A-level data booklets print them. */
const ONE_DP: Record<number, string> = {};
(
  "1.0 4.0 6.9 9.0 10.8 12.0 14.0 16.0 19.0 20.2 23.0 24.3 27.0 28.1 31.0 32.1 35.5 39.9 39.1 40.1 " +
  "45.0 47.9 50.9 52.0 54.9 55.8 58.9 58.7 63.5 65.4 69.7 72.6 74.9 79.0 79.9 83.8 85.5 87.6 88.9 91.2 " +
  "92.9 95.9 – 101.1 102.9 106.4 107.9 112.4 114.8 118.7 121.8 127.6 126.9 131.3 132.9 137.3 138.9 140.1 140.9 144.2 " +
  "– 150.4 152.0 157.2 158.9 162.5 164.9 167.3 168.9 173.0 175.0 178.5 180.9 183.8 186.2 190.2 192.2 195.1 197.0 200.6 " +
  "204.4 207.2 209.0 – – – – – – 232.0 231.0 238.1"
)
  .split(" ")
  .forEach((m, i) => (ONE_DP[i + 1] = m));
for (let z = 93; z <= 118; z++) ONE_DP[z] = "–";

const ARABIC = ["1", "2", "3", "4", "5", "6", "7", "0"];

const ROUNDING_NOTE =
  "The relative atomic masses of copper and chlorine have not been rounded to the nearest whole number.";

export const PERIODIC_SHEETS = {
  aqa: {
    label: "AQA GCSE",
    masses: WHOLE,
    lastZ: 111,
    fBlock: "omit",
    massFirst: true,
    groups: ARABIC,
    notes: [
      "* The lanthanides (atomic numbers 58–71) and the actinides (atomic numbers 90–103) have been omitted.",
      ROUNDING_NOTE,
    ],
    dataNotes: [],
  },
  edexcel: {
    label: "Edexcel GCSE",
    masses: WHOLE,
    lastZ: 86,
    fBlock: "omit",
    massFirst: true,
    groups: ARABIC,
    notes: [
      "* The elements with atomic numbers from 58 to 71 are omitted from this part of the periodic table.",
      ROUNDING_NOTE,
    ],
    dataNotes: [],
  },
  edexcelIgcse: {
    label: "Edexcel International GCSE",
    masses: WHOLE,
    lastZ: 111,
    fBlock: "omit",
    massFirst: true,
    groups: ARABIC,
    notes: [
      "Elements with atomic numbers 112–116 have been reported but not fully authenticated.",
      "* The lanthanoids (atomic numbers 58–71) and the actinoids (atomic numbers 90–103) have been omitted.",
      ROUNDING_NOTE,
    ],
    dataNotes: [],
  },
  cambridgeIgcse: {
    label: "Cambridge IGCSE",
    masses: CAMBRIDGE,
    lastZ: 118,
    fBlock: "rows",
    massFirst: false,
    groups: ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"],
    notes: [
      "The volume of one mole of any gas is 24 dm³ at room temperature and pressure (r.t.p.).",
    ],
    dataNotes: [
      "The volume of one mole of any gas is 24 dm³ at room temperature and pressure (r.t.p.).",
    ],
  },
  ocr: {
    label: "OCR GCSE",
    masses: ONE_DP,
    lastZ: 116,
    fBlock: "omit",
    massFirst: false,
    groups: ARABIC,
    notes: [],
    dataNotes: [],
  },
} satisfies Record<string, PeriodicSheet>;

/**
 * The table a student's chemistry paper prints, or null where there's none to
 * copy yet.
 *
 * A task set for every board (no board of its own) takes the student's.
 * A-level data booklets aren't here yet: there are no A-level tasks.
 */
export function periodicSheetFor(board: BoardV | null, level: LevelV): PeriodicSheet | null {
  if (level === "gcse" || level === "gcse_trilogy") {
    if (board === "ocr") return PERIODIC_SHEETS.ocr;
    if (board === "edexcel") return PERIODIC_SHEETS.edexcel;
    // AQA, and a tutor's preview of a brief for every board: the masses are
    // the same on every GCSE sheet but OCR's.
    return PERIODIC_SHEETS.aqa;
  }
  if (level === "igcse") {
    if (board === "cambridge") return PERIODIC_SHEETS.cambridgeIgcse;
    if (board === "edexcel") return PERIODIC_SHEETS.edexcelIgcse;
    return null;
  }
  return null;
}
