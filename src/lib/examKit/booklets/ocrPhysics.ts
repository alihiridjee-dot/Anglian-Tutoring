import type { DataBooklet } from "@/lib/examKit/dataBooklets";

/**
 * OCR A Level Physics A H556 Data, Formulae and Relationships booklet
 * (specification section 5c, version 3.0, 2026). Two slips in the print are
 * written as they should read: density there is "p = m/V" with a Latin p,
 * and the half-life relation reads "In (2)" with a capital I.
 */
export const OCR_PHYSICS: DataBooklet = {
  label: "OCR A Level Physics A",
  tab: "Data & formulae",
  blocks: [
    {
      kind: "table",
      title: "Physical constants",
      rows: [
        ["acceleration of free fall", "g", "9.81 m s^(−2)"],
        ["elementary charge", "e", "1.60 × 10^(−19) C"],
        ["speed of light in a vacuum", "c", "3.00 × 10^(8) m s^(−1)"],
        ["Planck constant", "h", "6.63 × 10^(−34) J s"],
        ["Avogadro constant", "N_(A)", "6.02 × 10^(23) mol^(−1)"],
        ["molar gas constant", "R", "8.31 J mol^(−1) K^(−1)"],
        ["Boltzmann constant", "k", "1.38 × 10^(−23) J K^(−1)"],
        ["gravitational constant", "G", "6.67 × 10^(−11) N m^(2) kg^(−2)"],
        ["permittivity of free space", "ε_(0)", "8.85 × 10^(−12) C^(2) N^(−1) m^(−2) (F m^(−1))"],
        ["electron rest mass", "m_(e)", "9.11 × 10^(−31) kg"],
        ["proton rest mass", "m_(p)", "1.673 × 10^(−27) kg"],
        ["neutron rest mass", "m_(n)", "1.675 × 10^(−27) kg"],
        ["alpha particle rest mass", "m_(α)", "6.646 × 10^(−27) kg"],
        ["Stefan constant", "σ", "5.67 × 10^(−8) W m^(−2) K^(−4)"],
      ],
      notes: ["Values are given to three significant figures, except where more – or fewer – are useful."],
    },
    {
      kind: "table",
      title: "Quarks",
      rows: [
        ["up quark", "charge = +{2|3}e"],
        ["down quark", "charge = −{1|3}e"],
        ["strange quark", "charge = −{1|3}e"],
      ],
    },
    {
      kind: "table",
      title: "Conversion factors",
      rows: [
        ["unified atomic mass unit", "1 u = 1.661 × 10^(−27) kg"],
        ["electronvolt", "1 eV = 1.60 × 10^(−19) J"],
        ["day", "1 day = 8.64 × 10^(4) s"],
        ["year", "1 year ≈ 3.16 × 10^(7) s"],
        ["light year", "1 light year ≈ 9.5 × 10^(15) m"],
        ["parsec", "1 parsec ≈ 3.1 × 10^(16) m"],
      ],
    },
    {
      kind: "formulae",
      title: "Mathematical equations",
      rows: [
        { label: "", formulae: ["arc length = rθ"] },
        { label: "", formulae: ["circumference of circle = 2πr"] },
        { label: "", formulae: ["area of circle = πr^(2)"] },
        { label: "", formulae: ["curved surface area of cylinder = 2πrh"] },
        { label: "", formulae: ["surface area of sphere = 4πr^(2)"] },
        { label: "", formulae: ["area of trapezium = {1|2}(a + b)h"] },
        { label: "", formulae: ["volume of cylinder = πr^(2)h"] },
        { label: "", formulae: ["volume of sphere = {4|3}πr^(3)"] },
        { label: "Pythagoras’ theorem:", formulae: ["a^(2) = b^(2) + c^(2)"] },
        { label: "cosine rule:", formulae: ["a^(2) = b^(2) + c^(2) − 2bc cos A"] },
        { label: "sine rule:", formulae: ["{a|sin A} = {b|sin B} = {c|sin C}"] },
        { label: "", formulae: ["sin θ ≈ tan θ ≈ θ and cos θ ≈ 1 for small angles"] },
        { label: "", formulae: ["log(AB) = log(A) + log(B)"] },
        { label: "", formulae: ["log({A|B}) = log(A) − log(B)"] },
        { label: "", formulae: ["log(x^(n)) = n log(x)"] },
        { label: "", formulae: ["ln(e^(kx)) = kx"] },
      ],
      notes: ["(Note: lg = log_(10) and ln = log_(e))"],
    },
    {
      kind: "formulae",
      title: "Module 2 – Foundations of physics",
      rows: [{ label: "vectors", formulae: ["F_(x) = F cos θ", "F_(y) = F sin θ"] }],
    },
    {
      kind: "formulae",
      title: "Module 3 – Forces and motion",
      rows: [
        {
          label: "uniformly accelerated motion",
          formulae: ["v = u + at", "s = {1|2}(u + v)t", "s = ut + {1|2}at^(2)", "v^(2) = u^(2) + 2as"],
        },
        { label: "force", formulae: ["F = {Δp|Δt}", "p = mv"] },
        { label: "turning effects", formulae: ["moment = Fx", "torque = Fd"] },
        { label: "density", formulae: ["ρ = {m|V}"] },
        { label: "pressure", formulae: ["p = {F|A}", "p = hρg"] },
        {
          label: "work, energy and power",
          formulae: [
            "W = Fx cos θ",
            "efficiency = {useful energy output|total energy input} × 100%",
            "P = {W|t}",
            "P = Fv",
          ],
        },
        {
          label: "springs and materials",
          formulae: ["F = kx", "E = {1|2}Fx", "E = {1|2}kx^(2)", "σ = {F|A}", "ε = {x|L}", "E = {σ|ε}"],
        },
      ],
    },
    {
      kind: "formulae",
      title: "Module 4 – Electrons, waves and photons",
      rows: [
        { label: "charge", formulae: ["ΔQ = IΔt"] },
        { label: "current", formulae: ["I = Anev"] },
        { label: "work done", formulae: ["W = VQ", "W = EQ", "W = VIt"] },
        {
          label: "resistance and resistors",
          formulae: ["R = {ρL|A}", "R = R_(1) + R_(2) + …", "{1|R} = {1|R_(1)} + {1|R_(2)} + …"],
        },
        { label: "power", formulae: ["P = VI", "P = I^(2)R", "P = {V^(2)|R}"] },
        { label: "internal resistance", formulae: ["E = I(R + r)", "E = V + Ir"] },
        {
          label: "potential divider",
          formulae: ["V_(out) = {R_(2)|R_(1) + R_(2)} × V_(in)", "{V_(1)|V_(2)} = {R_(1)|R_(2)}"],
        },
        { label: "waves", formulae: ["v = fλ", "f = {1|T}", "I = {P|A}", "λ = {ax|D}"] },
        {
          label: "refraction",
          formulae: ["n = {c|v}", "n sin θ = constant", "n_(1) sin θ_(1) = n_(2) sin θ_(2)", "sin C = {1|n}"],
        },
        { label: "quantum physics", formulae: ["E = hf", "E = {hc|λ}", "hf = ϕ + KE_(max)", "λ = {h|p}"] },
      ],
    },
    {
      kind: "formulae",
      title: "Module 5 – Newtonian world and astrophysics",
      rows: [
        { label: "thermal physics", formulae: ["E = mcΔθ", "E = ml"] },
        {
          label: "ideal gases",
          formulae: [
            "pV = NkT",
            "pV = nRT",
            "pV = {1|3}Nm‾(c^(2))",
            "{1|2}m‾(c^(2)) = {3|2}kT",
            "E = {3|2}kT",
          ],
        },
        {
          label: "circular motion",
          formulae: [
            "ω = {2π|T}",
            "ω = 2πf",
            "v = ωr",
            "a = {v^(2)|r}",
            "a = ω^(2)r",
            "F = {mv^(2)|r}",
            "F = mω^(2)r",
          ],
        },
        {
          label: "oscillations",
          formulae: [
            "ω = {2π|T}",
            "ω = 2πf",
            "a = −ω^(2)x",
            "x = A cos ωt",
            "x = A sin ωt",
            "v = ±ω√[A^(2) − x^(2)]",
          ],
        },
        {
          label: "gravitational field",
          formulae: [
            "g = {F|m}",
            "F = −{GMm|r^(2)}",
            "g = −{GM|r^(2)}",
            "T^(2) = ({4π^(2)|GM})r^(3)",
            "V_(g) = −{GM|r}",
            "energy = −{GMm|r}",
          ],
        },
        {
          label: "astrophysics",
          formulae: ["hf = ΔE", "{hc|λ} = ΔE", "d sin θ = nλ", "λ_(max) ∝ {1|T}", "L = 4πr^(2)σT^(4)"],
        },
        {
          label: "cosmology",
          formulae: ["{Δλ|λ} ≈ {Δf|f} ≈ {v|c}", "p = {1|d}", "v = H_(0)d", "t = H_(0)^(−1)"],
        },
      ],
    },
    {
      kind: "formulae",
      title: "Module 6 – Particles and medical physics",
      rows: [
        {
          label: "capacitance and capacitors",
          formulae: [
            "C = {Q|V}",
            "C = {ε_(0)A|d}",
            "C = 4πε_(0)R",
            "C = C_(1) + C_(2) + …",
            "{1|C} = {1|C_(1)} + {1|C_(2)} + ....",
            "W = {1|2}QV",
            "W = {1|2}{Q^(2)|C}",
            "W = {1|2}V^(2)C",
            "τ = CR",
            "x = x_(0)e^(−{t|CR})",
            "x = x_(0)(1 − e^(−{t|CR}))",
          ],
        },
        {
          label: "electric field",
          formulae: [
            "E = {F|q}",
            "F = {Qq|4πε_(0)r^(2)}",
            "E = {Q|4πε_(0)r^(2)}",
            "E = {V|d}",
            "V = {Q|4πε_(0)r}",
            "energy = {Qq|4πε_(0)r}",
          ],
        },
        { label: "magnetic field", formulae: ["F = BIL sin θ", "F = BQv"] },
        {
          label: "electromagnetism",
          formulae: [
            "ϕ = BA cos θ",
            "E = −{Δ(Nϕ)|Δt}",
            "{N_(s)|N_(p)} = {V_(s)|V_(p)} = {I_(p)|I_(s)}",
          ],
        },
        { label: "radius of nucleus", formulae: ["R = r_(0)A^({1|3})"] },
        {
          label: "radioactivity",
          formulae: ["A = λN", "{ΔN|Δt} = −λN", "λt_(1/2) = ln (2)", "A = A_(0)e^(−λt)", "N = N_(0)e^(−λt)"],
        },
        { label: "Einstein’s mass-energy equation", formulae: ["ΔE = Δmc^(2)"] },
        { label: "attenuation of X-rays", formulae: ["I = I_(0)e^(−μx)"] },
        {
          label: "ultrasound",
          formulae: [
            "Z = ρc",
            "{I_(r)|I_(0)} = {(Z_(2) − Z_(1))^(2)|(Z_(2) + Z_(1))^(2)}",
            "{Δf|f} = {2v cos θ|c}",
          ],
        },
      ],
    },
  ],
};
