import type { DataBooklet } from "@/lib/examKit/dataBooklets";

/** Cambridge International A Level Physics 9702 data and formulae (syllabus for 2028–2030: Papers 1 and 2 sheet, and Paper 4 sheet). */
export const CAMBRIDGE_PHYSICS: DataBooklet = {
  label: "Cambridge International A Level Physics",
  tab: "Data & formulae",
  blocks: [
    {
      kind: "table",
      title: "Data",
      rows: [
        ["acceleration of free fall", "g = 9.81 m s^(−2)"],
        ["speed of light in free space", "c = 3.00 × 10^(8) m s^(−1)"],
        ["elementary charge", "e = 1.60 × 10^(−19) C"],
        ["unified atomic mass unit", "1 u = 1.66 × 10^(−27) kg"],
        ["rest mass of proton", "m_(p) = 1.67 × 10^(−27) kg"],
        ["rest mass of electron", "m_(e) = 9.11 × 10^(−31) kg"],
        ["Avogadro constant", "N_(A) = 6.02 × 10^(23) mol^(−1)"],
        ["molar gas constant", "R = 8.31 J K^(−1) mol^(−1)"],
        ["Boltzmann constant", "k = 1.38 × 10^(−23) J K^(−1)"],
        ["gravitational constant", "G = 6.67 × 10^(−11) N m^(2) kg^(−2)"],
        ["permittivity of free space", "ε_(0) = 8.85 × 10^(−12) F m^(−1)"],
        ["", "({1|4πε_(0)} = 8.99 × 10^(9) m F^(−1))"],
        ["Planck constant", "h = 6.63 × 10^(−34) J s"],
        ["Stefan–Boltzmann constant", "σ = 5.67 × 10^(−8) W m^(−2) K^(−4)"],
      ],
    },
    {
      kind: "formulae",
      title: "Formulas",
      rows: [
        { label: "uniformly accelerated motion", formulae: ["s = ut + {1|2}at^(2)", "v^(2) = u^(2) + 2as"] },
        { label: "hydrostatic pressure", formulae: ["Δp = ρgΔh"] },
        { label: "upthrust", formulae: ["F = ρgV"] },
        { label: "Doppler effect for sound waves", formulae: ["f_(o) = {f_(s)v|v ± v_(s)}"] },
        { label: "electric current", formulae: ["I = Anvq"] },
        { label: "resistors in series", formulae: ["R = R_(1) + R_(2) + ..."] },
        { label: "resistors in parallel", formulae: ["{1|R} = {1|R_(1)} + {1|R_(2)} + ..."] },
      ],
    },
    {
      kind: "formulae",
      title: "Formulas",
      only: "Paper 4",
      rows: [
        { label: "gravitational potential", formulae: ["ϕ = −{GM|r}"] },
        { label: "gravitational potential energy", formulae: ["E_(P) = −{GMm|r}"] },
        { label: "pressure of an ideal gas", formulae: ["p = {1|3}{Nm|V} ⟨c^(2)⟩"] },
        { label: "simple harmonic motion", formulae: ["a = −ω^(2)x"] },
        {
          label: "velocity of particle in s.h.m.",
          formulae: ["v = v_(0) cos ωt", "v = ±ω√[(x_(0)^(2) − x^(2))]"],
        },
        { label: "electric potential", formulae: ["V = {Q|4πε_(0)r}"] },
        { label: "electrical potential energy", formulae: ["E_(P) = {Qq|4πε_(0)r}"] },
        { label: "capacitors in series", formulae: ["{1|C} = {1|C_(1)} + {1|C_(2)} + ..."] },
        { label: "capacitors in parallel", formulae: ["C = C_(1) + C_(2) + ..."] },
        { label: "discharge of a capacitor", formulae: ["x = x_(0)e^(−{t|RC})"] },
        { label: "Hall voltage", formulae: ["V_(H) = {BI|ntq}"] },
        { label: "alternating current/voltage", formulae: ["x = x_(0) sin ωt"] },
        { label: "radioactive decay", formulae: ["x = x_(0)e^(−λt)"] },
        { label: "decay constant", formulae: ["λ = {0.693|t_({1|2})}"] },
        {
          label: "intensity reflection coefficient",
          formulae: ["{I_(R)|I_(0)} = {(Z_(1) − Z_(2))^(2)|(Z_(1) + Z_(2))^(2)}"],
        },
        { label: "Stefan–Boltzmann law", formulae: ["L = 4πσr^(2)T^(4)"] },
        { label: "Doppler redshift", formulae: ["{Δλ|λ} ≈ {Δf|f} ≈ {v|c}"] },
      ],
    },
  ],
};
