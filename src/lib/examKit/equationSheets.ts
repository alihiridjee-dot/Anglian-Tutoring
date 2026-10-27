/**
 * The physics equation sheets the boards hand out with the papers.
 *
 * Ofqual has GCSE Physics and Combined Science papers in England come with an
 * equation sheet (2025–2027, then for the life of the current GCSEs), and the
 * sheet carries every equation in the specification, the ones students used
 * to learn by heart as well as the ones always given. Pearson does the same
 * for International GCSE Physics from 2025. Each board writes its own, in its
 * own words and symbols, so each list here is copied from that board's sheet
 * or specification, in its order, with its own markers: Higher tier only, or
 * Paper 2 only on the International GCSE.
 *
 * Cambridge IGCSE gives no sheet (every equation is "recall and use"), so its
 * students get none here either. A-level data and formulae booklets aren't
 * here yet: there are no A-level tasks.
 *
 * Symbol equations write a fraction as `{top|bottom}`, drawn stacked.
 */

import type { BoardV, LevelV } from "@/lib/curriculum/taxonomy";

export interface Equation {
  word: string;
  /** Empty where the board gives only the words (efficiency, magnification). */
  symbol: string;
  /** Set when the equation is only for some papers: "Higher" tier, or "Paper 2". */
  only?: "Higher" | "Paper 2";
  /** Physics only: not on the Combined Science sheet. */
  separate?: boolean;
}

export interface EquationSheet {
  /** Whose sheet this is, as the panel names it: "AQA GCSE Physics". */
  label: string;
  equations: Equation[];
}

const e = (word: string, symbol: string, flags: Partial<Equation> = {}): Equation => ({
  word,
  symbol,
  ...flags,
});
const HT = { only: "Higher" } as const;
const SEP = { separate: true };
const HT_SEP = { only: "Higher", separate: true } as const;
const P2 = { only: "Paper 2" } as const;

/** AQA 8463 Appendix A, then the 8464 sheet is the same list without the physics-only lines. */
const AQA: Equation[] = [
  e("weight = mass × gravitational field strength (g)", "W = m g"),
  e("work done = force × distance (along the line of action of the force)", "W = F s"),
  e("force applied to a spring = spring constant × extension", "F = k e"),
  e("moment of a force = force × distance (normal to direction of force)", "M = F d", SEP),
  e("pressure = {force normal to a surface|area of that surface}", "p = {F|A}", SEP),
  e("distance travelled = speed × time", "s = v t"),
  e("acceleration = {change in velocity|time taken}", "a = {Δv|t}"),
  e("resultant force = mass × acceleration", "F = m a"),
  e("momentum = mass × velocity", "p = m v", HT),
  e("kinetic energy = 0.5 × mass × (speed)²", "Eₖ = ½ m v²"),
  e(
    "gravitational potential energy = mass × gravitational field strength (g) × height",
    "Eₚ = m g h",
  ),
  e("power = {energy transferred|time}", "P = {E|t}"),
  e("power = {work done|time}", "P = {W|t}"),
  e("efficiency = {useful output energy transfer|total input energy transfer}", ""),
  e("efficiency = {useful power output|total power input}", ""),
  e("wave speed = frequency × wavelength", "v = f λ"),
  e("charge flow = current × time", "Q = I t"),
  e("potential difference = current × resistance", "V = I R"),
  e("power = potential difference × current", "P = V I"),
  e("power = (current)² × resistance", "P = I² R"),
  e("energy transferred = power × time", "E = P t"),
  e("energy transferred = charge flow × potential difference", "E = Q V"),
  e("density = {mass|volume}", "ρ = {m|V}"),
  e(
    "pressure due to a column of liquid = height of column × density of liquid × gravitational field strength (g)",
    "p = h ρ g",
    HT_SEP,
  ),
  e("(final velocity)² − (initial velocity)² = 2 × acceleration × distance", "v² − u² = 2 a s"),
  e("force = {change in momentum|time taken}", "F = {m Δv|Δt}", HT_SEP),
  e("elastic potential energy = 0.5 × spring constant × (extension)²", "Eₑ = ½ k e²"),
  e("change in thermal energy = mass × specific heat capacity × temperature change", "ΔE = m c Δθ"),
  e("period = {1|frequency}", "T = {1|f}"),
  e("magnification = {image height|object height}", "", SEP),
  e(
    "force on a conductor (at right angles to a magnetic field) carrying a current = magnetic flux density × current × length",
    "F = B I l",
    HT,
  ),
  e("thermal energy for a change of state = mass × specific latent heat", "E = m L"),
  e(
    "{potential difference across primary coil|potential difference across secondary coil} = {number of turns in primary coil|number of turns in secondary coil}",
    "{Vₚ|Vₛ} = {nₚ|nₛ}",
    HT_SEP,
  ),
  e(
    "potential difference across primary coil × current in primary coil = potential difference across secondary coil × current in secondary coil",
    "Vₚ Iₚ = Vₛ Iₛ",
    HT,
  ),
  e("for gases: pressure × volume = constant", "p V = constant", SEP),
];

/** Pearson Edexcel 1PH0 Appendix 2, lists a and b. */
const EDEXCEL: Equation[] = [
  e("distance travelled = average speed × time", ""),
  e("acceleration = change in velocity ÷ time taken", "a = {(v − u)|t}"),
  e("force = mass × acceleration", "F = m × a"),
  e("weight = mass × gravitational field strength", "W = m × g"),
  e("momentum = mass × velocity", "p = m × v", HT),
  e(
    "change in gravitational potential energy = mass × gravitational field strength × change in vertical height",
    "ΔGPE = m × g × Δh",
  ),
  e("kinetic energy = ½ × mass × (speed)²", "KE = ½ × m × v²"),
  e(
    "efficiency = {(useful energy transferred by the device)|(total energy supplied to the device)}",
    "",
  ),
  e("wave speed = frequency × wavelength", "v = f × λ"),
  e("wave speed = distance ÷ time", "v = {x|t}"),
  e("work done = force × distance moved in the direction of the force", "E = F × d"),
  e("power = work done ÷ time taken", "P = {E|t}"),
  e("moment of a force = force × distance normal to the direction of the force", "", SEP),
  e("energy transferred = charge moved × potential difference", "E = Q × V"),
  e("charge = current × time", "Q = I × t"),
  e("potential difference = current × resistance", "V = I × R"),
  e("power = energy transferred ÷ time taken", "P = {E|t}"),
  e("electrical power = current × potential difference", "P = I × V"),
  e("electrical power = current squared × resistance", "P = I² × R"),
  e("density = mass ÷ volume", "ρ = {m|V}"),
  e("force exerted on a spring = spring constant × extension", "F = k × x"),
  e("pressure = force normal to surface ÷ area of surface", "P = {F|A}", SEP),
  e("(final velocity)² − (initial velocity)² = 2 × acceleration × distance", "v² − u² = 2 × a × x"),
  e("force = change in momentum ÷ time", "F = {(mv − mu)|t}", HT),
  e("energy transferred = current × potential difference × time", "E = I × V × t"),
  e(
    "force on a conductor at right angles to a magnetic field carrying a current = magnetic flux density × current × length",
    "F = B × I × l",
    HT,
  ),
  e(
    "{potential difference across primary coil|potential difference across secondary coil} = {number of turns in primary coil|number of turns in secondary coil}",
    "{Vₚ|Vₛ} = {Nₚ|Nₛ}",
    HT_SEP,
  ),
  e(
    "for transformers with 100% efficiency, potential difference across primary coil × current in primary coil = potential difference across secondary coil × current in secondary coil",
    "Vₚ × Iₚ = Vₛ × Iₛ",
  ),
  e(
    "change in thermal energy = mass × specific heat capacity × change in temperature",
    "ΔQ = m × c × Δθ",
  ),
  e("thermal energy for a change of state = mass × specific latent heat", "Q = m × L"),
  e(
    "to calculate pressure or volume for gases of fixed mass at constant temperature",
    "P₁ × V₁ = P₂ × V₂",
    SEP,
  ),
  e("energy transferred in stretching = 0.5 × spring constant × (extension)²", "E = ½ × k × x²"),
  e(
    "pressure due to a column of liquid = height of column × density of liquid × gravitational field strength",
    "P = h × ρ × g",
    HT_SEP,
  ),
];

/** OCR Gateway J249 section 5d, recall then select-and-apply. */
const OCR: Equation[] = [
  e("density = {mass|volume}", "ρ = {m|V}"),
  e("distance travelled = speed × time", "s = v t"),
  e("acceleration = {change in velocity|time}", "a = {v − u|t}"),
  e("kinetic energy = ½ × mass × (speed)²", "E = ½ m v²"),
  e("force = mass × acceleration", "F = m a"),
  e("momentum = mass × velocity", "p = m v", HT),
  e("work done = force × distance (along the line of action of the force)", "W = F s"),
  e("power = {work done|time}", "P = {W|t}"),
  e("force exerted by a spring = spring constant × extension", "F = k x"),
  e("gravitational force = mass × gravitational field strength", "W = m g"),
  e("gravitational potential energy = mass × gravitational field strength × height", "E = m g h"),
  e("pressure = {force normal to a surface|area of that surface}", "p = {F|A}", SEP),
  e("moment of a force = force × distance (normal to direction of the force)", "M = F d", SEP),
  e("charge flow = current × time", "Q = I t"),
  e("potential difference = current × resistance", "V = I R"),
  e("energy transferred = charge × potential difference", "E = Q V"),
  e("power = potential difference × current", "P = V I"),
  e("power = (current)² × resistance", "P = I² R"),
  e("energy transferred = power × time", "E = P t"),
  e("wave speed = frequency × wavelength", "v = f λ"),
  e("efficiency = {useful output energy transfer|input energy transfer}", ""),
  e(
    "change in thermal energy = mass × specific heat capacity × change in temperature",
    "ΔE = m c Δθ",
  ),
  e("thermal energy for a change in state = mass × specific latent heat", "E = m l"),
  e(
    "for a given mass of gas at a constant temperature: pressure × volume = constant",
    "p V = constant",
    SEP,
  ),
  e(
    "pressure due to a column of liquid = height of column × density of liquid × gravitational field strength",
    "p = h ρ g",
    HT_SEP,
  ),
  e("(final velocity)² − (initial velocity)² = 2 × acceleration × distance", "v² − u² = 2 a s"),
  e("energy transferred in stretching = ½ × spring constant × (extension)²", "E = ½ k x²"),
  e(
    "force on a conductor (at right angles to a magnetic field) carrying a current: force = magnetic flux density × current × length",
    "F = B I l",
    HT,
  ),
  e(
    "{potential difference across primary coil|potential difference across secondary coil} = {number of turns in primary coil|number of turns in secondary coil}",
    "{Vₚ|Vₛ} = {Nₚ|Nₛ}",
    HT_SEP,
  ),
  e(
    "potential difference across primary coil × current in primary coil = potential difference across secondary coil × current in secondary coil",
    "Vₚ Iₚ = Vₛ Iₛ",
  ),
];

/**
 * Pearson Edexcel International GCSE Physics 4PH1 equation list (W84708A,
 * May–June 2025, unchanged since). It prints efficiency over "total energy
 * output", a slip for input; written here as it should read.
 */
const EDEXCEL_IGCSE: Equation[] = [
  e("average speed = {distance moved|time taken}", ""),
  e("acceleration = {change in velocity|time taken}", "a = {(v − u)|t}"),
  e(
    "(final speed)² = (initial speed)² + (2 × acceleration × distance moved)",
    "v² = u² + (2 × a × s)",
  ),
  e("force = mass × acceleration", "F = m × a"),
  e("weight = mass × gravitational field strength", "W = m × g"),
  e("power = current × voltage", "P = I × V"),
  e("energy transferred = current × voltage × time", "E = I × V × t"),
  e("voltage = current × resistance", "V = I × R"),
  e("charge = current × time", "Q = I × t"),
  e("energy transferred = charge × voltage", "E = Q × V"),
  e("wave speed = frequency × wavelength", "v = f × λ"),
  e("frequency = {1|time period}", "f = {1|T}"),
  e("refractive index = {sin(angle of incidence)|sin(angle of refraction)}", "n = {sin i|sin r}"),
  e("sin(critical angle) = {1|refractive index}", "sin c = {1|n}"),
  e("efficiency = {useful energy output|total energy input} × 100%", ""),
  e("work done = force × distance moved", "W = F × d"),
  e(
    "gravitational potential energy = mass × gravitational field strength × height",
    "GPE = m × g × h",
  ),
  e("kinetic energy = ½ × mass × speed²", "KE = ½ × m × v²"),
  e("power = {work done|time taken}", "P = {W|t}"),
  e("density = {mass|volume}", "ρ = {m|V}"),
  e("pressure = {force|area}", "p = {F|A}"),
  e("pressure difference = height × density × gravitational field strength", "p = h × ρ × g"),
  e("{pressure|temperature} = constant", "{p₁|T₁} = {p₂|T₂}"),
  e("pressure × volume = constant", "p₁ × V₁ = p₂ × V₂"),
  e("orbital speed = {2 × π × orbital radius|time period}", "v = {2 × π × r|T}"),
  e("momentum = mass × velocity", "p = m × v", P2),
  e("force = {change in momentum|time taken}", "F = {(mv − mu)|t}", P2),
  e("moment = force × perpendicular distance from the pivot", "", P2),
  e(
    "change in thermal energy = mass × specific heat capacity × change in temperature",
    "ΔQ = m × c × ΔT",
    P2,
  ),
  e(
    "for a transformer: {input (primary) voltage|output (secondary) voltage} = {primary turns|secondary turns}",
    "",
    P2,
  ),
  e("input power = output power, for 100% efficiency", "Vₚ Iₚ = Vₛ Iₛ", P2),
  e(
    "{change in wavelength|reference wavelength} = {velocity of a galaxy|speed of light}",
    "{(λ − λ₀)|λ₀} = {Δλ|λ₀} = {v|c}",
    P2,
  ),
];

export const EQUATION_SHEETS = {
  aqa: { label: "AQA GCSE Physics", equations: AQA },
  aqaCombined: {
    label: "AQA Combined Science",
    equations: AQA.filter((q) => !q.separate),
  },
  edexcel: { label: "Edexcel GCSE Physics", equations: EDEXCEL },
  ocr: { label: "OCR GCSE Physics", equations: OCR },
  edexcelIgcse: { label: "Edexcel International GCSE Physics", equations: EDEXCEL_IGCSE },
} satisfies Record<string, EquationSheet>;

/** The sheet a student's physics paper comes with, or null where it comes with none. */
export function equationSheetFor(board: BoardV | null, level: LevelV): EquationSheet | null {
  if (level === "gcse_trilogy") return board === "aqa" ? EQUATION_SHEETS.aqaCombined : null;
  if (level === "igcse") return board === "edexcel" ? EQUATION_SHEETS.edexcelIgcse : null;
  if (level !== "gcse") return null;
  if (board === "aqa") return EQUATION_SHEETS.aqa;
  if (board === "edexcel") return EQUATION_SHEETS.edexcel;
  if (board === "ocr") return EQUATION_SHEETS.ocr;
  // A brief for every board, seen by a tutor: no one board's sheet is right.
  return null;
}
