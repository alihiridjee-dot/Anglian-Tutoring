import type { DataBooklet } from "@/lib/examKit/dataBooklets";

/** Pearson Edexcel A level Physics 9PH0 List of data, formulae and relationships, Issue 3 (November 2022). */
export const EDEXCEL_PHYSICS: DataBooklet = {
  label: "Edexcel A level Physics",
  tab: "Data & formulae",
  blocks: [
    {
      kind: "table",
      title: "Data",
      rows: [
        ["Acceleration of free fall", "g = 9.81 m s^(−2)", "(close to Earth’s surface)"],
        ["Boltzmann constant", "k = 1.38 × 10^(−23) J K^(−1)", ""],
        ["Coulomb law constant", "k = {1|4πε_(0)} = 8.99 × 10^(9) N m^(2) C^(−2)", ""],
        ["Electron charge", "e = −1.60 × 10^(−19) C", ""],
        ["Electron mass", "m_(e) = 9.11 × 10^(−31) kg", ""],
        ["Electronvolt", "1 eV = 1.60 × 10^(−19) J", ""],
        ["Gravitational constant", "G = 6.67 × 10^(−11) N m^(2) kg^(−2)", ""],
        ["Gravitational field strength", "g = 9.81 N kg^(−1)", "(close to Earth’s surface)"],
        ["Permittivity of free space", "ε_(0) = 8.85 × 10^(−12) F m^(−1)", ""],
        ["Planck constant", "h = 6.63 × 10^(−34) J s", ""],
        ["Proton mass", "m_(p) = 1.67 × 10^(−27) kg", ""],
        ["Speed of light in a vacuum", "c = 3.00 × 10^(8) m s^(−1)", ""],
        ["Stefan–Boltzmann constant", "σ = 5.67 × 10^(−8) W m^(−2) K^(−4)", ""],
        ["Unified atomic mass unit", "u = 1.66 × 10^(−27) kg", ""],
      ],
    },
    {
      kind: "formulae",
      title: "Mechanics",
      rows: [
        {
          label: "Kinematic equations of motion",
          formulae: ["s = {(u + v)t|2}", "v = u + at", "s = ut + {1|2}at^(2)", "v^(2) = u^(2) + 2as"],
        },
        { label: "Forces", formulae: ["∑F = ma", "g = {F|m}", "W = mg", "moment of force = Fx"] },
        { label: "Momentum", formulae: ["p = mv"] },
        {
          label: "Work, energy and power",
          formulae: [
            "ΔW = FΔs",
            "E_(k) = {1|2}mv^(2)",
            "ΔE_(grav) = mgΔh",
            "P = {E|t}",
            "P = {W|t}",
            "efficiency = {useful energy output|total energy input}",
            "efficiency = {useful power output|total power input}",
          ],
        },
      ],
    },
    {
      kind: "formulae",
      title: "Electric circuits",
      rows: [
        { label: "Potential difference", formulae: ["V = {W|Q}"] },
        { label: "Resistance", formulae: ["R = {V|I}"] },
        { label: "Electrical power and energy", formulae: ["P = VI", "P = I^(2)R", "P = {V^(2)|R}", "W = VIt"] },
        { label: "Resistivity", formulae: ["R = {ρl|A}"] },
        { label: "Current", formulae: ["I = {ΔQ|Δt}", "I = nqvA"] },
      ],
    },
    {
      kind: "formulae",
      title: "Materials",
      rows: [
        { label: "Density", formulae: ["ρ = {m|V}"] },
        { label: "Stokes’ law", formulae: ["F = 6πηrv"] },
        { label: "Hooke’s law", formulae: ["ΔF = kΔx"] },
        { label: "Young modulus", formulae: ["Stress σ = {F|A}", "Strain ε = {Δx|x}", "E = {σ|ε}"] },
        { label: "Elastic strain energy", formulae: ["ΔE_(el) = {1|2}FΔx"] },
      ],
    },
    {
      kind: "formulae",
      title: "Waves and Particle Nature of Light",
      rows: [
        { label: "Wave speed", formulae: ["v = fλ"] },
        { label: "Speed of a transverse wave on a string", formulae: ["v = √[{T|μ}]"] },
        { label: "Intensity of radiation", formulae: ["I = {P|A}"] },
        { label: "Power of a lens", formulae: ["P = {1|f}", "P = P_(1) + P_(2) + P_(3) + …"] },
        { label: "Thin lens equation", formulae: ["{1|u} + {1|v} = {1|f}"] },
        { label: "Magnification for a lens", formulae: ["m = {image height|object height} = {v|u}"] },
        { label: "Diffraction grating", formulae: ["nλ = d sin θ"] },
        { label: "Refractive index", formulae: ["n_(1) sin θ_(1) = n_(2) sin θ_(2)", "n = {c|v}"] },
        { label: "Critical angle", formulae: ["sin C = {1|n}"] },
        { label: "Photon model", formulae: ["E = hf"] },
        { label: "Einstein’s photoelectric equation", formulae: ["hf = ϕ + {1|2}mv^(2)_(max)"] },
        { label: "de Broglie wavelength", formulae: ["λ = {h|p}"] },
      ],
    },
    {
      kind: "formulae",
      title: "Further mechanics",
      rows: [
        { label: "Impulse", formulae: ["FΔt = Δp"] },
        { label: "Kinetic energy of a non-relativistic particle", formulae: ["E_(k) = {p^(2)|2m}"] },
        {
          label: "Motion in a circle",
          formulae: ["v = ωr", "T = {2π|ω}", "F = ma = {mv^(2)|r}", "a = {v^(2)|r}", "a = rω^(2)", "F = mrω^(2)"],
        },
      ],
    },
    {
      kind: "formulae",
      title: "Fields",
      rows: [
        { label: "Coulomb’s law", formulae: ["F = {Q_(1)Q_(2)|4πε_(0)r^(2)}"] },
        { label: "Electric field strength", formulae: ["E = {F|Q}", "E = k {Q|r^(2)}", "E = {V|d}"] },
        { label: "Electric potential", formulae: ["V = k {Q|r}"] },
        { label: "Capacitance", formulae: ["C = {Q|V}"] },
        {
          label: "Energy stored in a capacitor",
          formulae: ["W = {1|2}QV", "W = {1|2}CV^(2)", "W = {1|2}{Q^(2)|C}"],
        },
        {
          label: "Capacitor discharge",
          formulae: [
            "Q = Q_(0)e^(−t/RC)",
            "I = I_(0)e^(−t/RC)",
            "V = V_(0)e^(−t/RC)",
            "ln Q = ln Q_(0) − {t|RC}",
            "ln I = ln I_(0) − {t|RC}",
            "ln V = ln V_(0) − {t|RC}",
          ],
        },
        { label: "Resistor – capacitor discharge", formulae: ["I = I_(0)e^(−t/RC)", "V = V_(0)e^(−t/RC)"] },
        { label: "In a magnetic field", formulae: ["F = BIl sin θ", "F = Bqv sin θ"] },
        { label: "Faraday’s and Lenz’s laws", formulae: ["ε = {−d(Nϕ)|dt}"] },
        { label: "Root-mean-square values", formulae: ["V_(rms) = {V_(0)|√2}", "I_(rms) = {I_(0)|√2}"] },
      ],
    },
    {
      kind: "formulae",
      title: "Nuclear and particle physics",
      rows: [{ label: "In a magnetic field", formulae: ["r = {p|BQ}"] }],
    },
    {
      kind: "formulae",
      title: "Thermodynamics",
      rows: [
        { label: "Heating", formulae: ["ΔE = mcΔθ", "ΔE = LΔm"] },
        { label: "Molecular kinetic theory", formulae: ["{1|2}m⟨c^(2)⟩ = {3|2}kT", "pV = {1|3}Nm⟨c^(2)⟩"] },
        { label: "Ideal gas equation", formulae: ["pV = NkT"] },
        { label: "Stefan–Boltzmann law", formulae: ["L = σAT^(4)", "L = 4πr^(2)σT^(4)"] },
        { label: "Wien’s law", formulae: ["λ_(max)T = 2.898 × 10^(−3) m K"] },
      ],
    },
    {
      kind: "formulae",
      title: "Space",
      rows: [
        { label: "Intensity", formulae: ["I = {L|4πd^(2)}"] },
        { label: "Redshift of electromagnetic radiation", formulae: ["z = {Δλ|λ} ≈ {Δf|f} ≈ {v|c}"] },
        { label: "Cosmological expansion", formulae: ["v = H_(0)d"] },
      ],
    },
    {
      kind: "formulae",
      title: "Nuclear radiation",
      rows: [
        { label: "Mass–energy", formulae: ["ΔE = c^(2)Δm"] },
        {
          label: "Radioactive decay",
          formulae: ["A = λN", "{dN|dt} = −λN", "λ = {ln 2|t_(½)}", "N = N_(0) e^(−λt)", "A = A_(0) e^(−λt)"],
        },
      ],
    },
    {
      kind: "formulae",
      title: "Gravitational fields",
      rows: [
        { label: "Gravitational force", formulae: ["F = {Gm_(1)m_(2)|r^(2)}"] },
        { label: "Gravitational field strength", formulae: ["g = {Gm|r^(2)}"] },
        { label: "Gravitational potential", formulae: ["V_(grav) = {−Gm|r}"] },
      ],
    },
    {
      kind: "formulae",
      title: "Oscillations",
      rows: [
        {
          label: "Simple harmonic motion",
          formulae: [
            "F = −kx",
            "a = −ω^(2)x",
            "x = A cos ωt",
            "v = −Aω sin ωt",
            "a = −Aω^(2) cos ωt",
            "T = {1|f} = {2π|ω}",
            "ω = 2πf",
          ],
        },
        { label: "Simple harmonic oscillator", formulae: ["T = 2π √[{m|k}]", "T = 2π √[{l|g}]"] },
      ],
    },
  ],
};
