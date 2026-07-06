import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "motion/react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { SUBJECTS, BOARDS, LEVELS, type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { generateMcqSet } from "@/lib/mcq.functions";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Sparkles,
  ChevronRight,
  ChevronDown,
  BookMarked,
  PlayCircle,
  Download,
  ClipboardList,
  CalendarClock,
  ListChecks,
  ChevronLeft,
  GraduationCap,
  Award,
  BookOpen,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/curriculum")({
  head: () => ({ meta: [{ title: "Curriculum | Anglian Tutoring" }] }),
  component: Curriculum,
});

type Topic = {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  sort_order: number;
};

type SpecPoint = {
  id: string;
  topic_id: string;
  code: string;
  title: string;
  description: string | null;
};

type Resource = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  video_url: string | null;
  file_path: string | null;
  file_name: string | null;
  starts_at: string | null;
  join_url: string | null;
  due_at: string | null;
};

type McqSet = { id: string; title: string; published: boolean };

const inputCls =
  "w-full h-9 rounded-md bg-secondary border border-border px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

// Comprehensive Blueprints for all subjects and levels
const BLUEPRINTS: Record<
  string, // "gcse" or "alevel"
  Record<
    string, // "biology", "chemistry", "physics"
    Array<{
      title: string;
      desc: string;
      points: Array<{ code: string; title: string; desc: string }>;
    }>
  >
> = {
  gcse: {
    biology: [
      {
        title: "Cell Biology & Microscopy",
        desc: "Cell structure, eukaryotic and prokaryotic cells, transport mechanisms, division, and required practicals.",
        points: [
          {
            code: "1.1",
            title: "Eukaryotic and Prokaryotic Cells",
            desc: "Structure of plant, animal, and bacterial cells, comparing organelles like chloroplasts, mitochondria, ribosomes, vacuoles, and plasmids.",
          },
          {
            code: "1.2",
            title: "Microscopy Required Practical",
            desc: "Prepare and stain cell specimens, and use light microscopes to view and estimate cell sizes using magnification = image / actual equations.",
          },
          {
            code: "1.3",
            title: "Active Transport and Osmosis",
            desc: "Compare active carrier transport mechanisms moving against concentrations versus passive osmosis diffusion.",
          },
          {
            code: "1.4",
            title: "Cell Division & Mitosis",
            desc: "The cell cycle, chromosome replication, and stages of mitosis for growth, repair, and asexual reproduction.",
          },
        ],
      },
      {
        title: "Organisation & Organ Systems",
        desc: "Human digestive system, heart and circulation, plant tissues and transport.",
        points: [
          {
            code: "2.1",
            title: "Enzymes & Lock-and-Key Model",
            desc: "Biological catalysts, active site specificity, and factors affecting enzyme activity: pH, temperature, and denaturing.",
          },
          {
            code: "2.2",
            title: "Heart, Blood Vessels & Pacemakers",
            desc: "Structure of the heart, ventricles, atria, double circulatory system, comparing arteries, veins, and capillaries, and pacemakers.",
          },
          {
            code: "2.3",
            title: "Plant Transport & Transpiration",
            desc: "Structure and function of xylem, phloem, root hair cells, stomata, and transpiration rates.",
          },
        ],
      },
      {
        title: "Infection, Response & Immunology",
        desc: "Pathogens, communicable diseases, immune response, vaccines, antibiotics, and drug development.",
        points: [
          {
            code: "3.1",
            title: "Pathogens & Communicable Diseases",
            desc: "Explain viral (HIV, TMV), bacterial (Salmonella, Gonorrhoea), fungal (Rose Black Spot), and protist (Malaria) transmission.",
          },
          {
            code: "3.2",
            title: "Human Immune Defense Mechanisms",
            desc: "Physical barriers (skin, mucus), phagocytosis, antibody production, and antitoxin release by white blood cells.",
          },
          {
            code: "3.3",
            title: "Vaccination & Herd Immunity",
            desc: "Introduction of inactive pathogens to stimulate antibody response, protecting populations through herd immunization.",
          },
        ],
      },
      {
        title: "Bioenergetics",
        desc: "Syllabus details of chloroplast energy absorption, limiting factors, and cellular respiration cycles.",
        points: [
          {
            code: "4.1",
            title: "Photosynthesis Limiting Factors",
            desc: "The chemical equation of photosynthesis, chloroplast mechanisms, and temperature, carbon dioxide, or light intensity plateaus.",
          },
          {
            code: "4.2",
            title: "Aerobic vs Anaerobic Respiration",
            desc: "In-depth comparison of complete oxidation glucose ATP yields versus lactic acid debt and yeast ethanol fermentation.",
          },
        ],
      },
      {
        title: "Homeostasis & Coordination",
        desc: "Nervous coordination, reflexes, hormone systems, diabetes regulation, and reproductive cycles.",
        points: [
          {
            code: "5.1",
            title: "Nervous System & Reflex Arc",
            desc: "Stimulus detection, sensory/relay/motor neurone transmission, synapse chemical transfer, and reflex responses.",
          },
          {
            code: "5.2",
            title: "Hormonal Regulation of Blood Glucose",
            desc: "Pancreas insulin and glucagon feedback loops, comparing Type 1 and Type 2 diabetes.",
          },
          {
            code: "5.3",
            title: "Human Reproductive Hormones",
            desc: "Roles of FSH, LH, oestrogen, and progesterone in the menstrual cycle, contraception, and IVF.",
          },
        ],
      },
      {
        title: "Inheritance, Variation & Evolution",
        desc: "DNA structure, genetic crosses, natural selection, selective breeding, and genetic engineering.",
        points: [
          {
            code: "6.1",
            title: "DNA, Genome & Protein Synthesis",
            desc: "Double helix structure, transcription to mRNA, and translation on ribosomes to form proteins.",
          },
          {
            code: "6.2",
            title: "Genetic Crosses & Inherited Disorders",
            desc: "Using Punnett squares to predict offspring genotypes, studying polydactyly and cystic fibrosis.",
          },
          {
            code: "6.3",
            title: "Evolution by Natural Selection",
            desc: "Darwinian theory, mutation advantages, survival of the fittest, and fossil evidence.",
          },
        ],
      },
      {
        title: "Ecology & Biodiversity",
        desc: "Ecosystem dynamics, cycles of matter, human impact, and conservation.",
        points: [
          {
            code: "7.1",
            title: "Interdependence & Quadrats Practical",
            desc: "Estimate population sizes of plant species using random sampling grids and transects.",
          },
          {
            code: "7.2",
            title: "Carbon & Water Recycling",
            desc: "Trace carbon recycling through photosynthesis, respiration, combustion, and decay.",
          },
        ],
      },
    ],
    chemistry: [
      {
        title: "Atomic Structure & Periodic Table",
        desc: "Atomic models, isotopes, electronic configurations, and periodic trends of group elements.",
        points: [
          {
            code: "1.1",
            title: "Subatomic Particles & Isotopic Mass",
            desc: "Relative charge, mass, and location of protons, neutrons, and electrons, calculating isotopic abundance.",
          },
          {
            code: "1.2",
            title: "History of the Atomic Model",
            desc: "Trace atomic theory progression from Dalton, Thomson, Rutherford, Bohr, to Chadwick.",
          },
          {
            code: "1.3",
            title: "Electronic Configurations & Trends",
            desc: "Shell rule (2,8,8), outer electrons in groups, and Group 1, 7, and 0 reactivity trends.",
          },
        ],
      },
      {
        title: "Structure, Bonding & Matter",
        desc: "Ionic, covalent, and metallic bonding, giant lattices, molecular structures, and carbon allotropes.",
        points: [
          {
            code: "2.1",
            title: "Ionic Bonding & Giant Lattices",
            desc: "Transfer of electrons from metals to non-metals, electrostatic attractions, and conductivity.",
          },
          {
            code: "2.2",
            title: "Covalent Bonding & Simple Molecules",
            desc: "Sharing of electron pairs between non-metals, intramolecular vs intermolecular forces.",
          },
          {
            code: "2.3",
            title: "Carbon Allotropes",
            desc: "Structure and bonding of diamond, graphite, graphene, and fullerenes.",
          },
        ],
      },
      {
        title: "Quantitative Chemistry",
        desc: "Relative formula masses, moles, stoichiometry, and solution concentrations.",
        points: [
          {
            code: "3.1",
            title: "Relative Formula Mass & Moles",
            desc: "Calculate Mr and apply the formula: moles = mass / Mr.",
          },
          {
            code: "3.2",
            title: "Reacting Masses & Limiting Reactants",
            desc: "Determining reactant ratios and finding limiting reagents in equations.",
          },
        ],
      },
      {
        title: "Chemical Changes & Electrolysis",
        desc: "Metal reactivity, reactions of acids, preparation of soluble salts, and electrolysis.",
        points: [
          {
            code: "4.1",
            title: "Reactivity Series & Metal Extraction",
            desc: "Displacement reactions, position of carbon, and reduction extraction.",
          },
          {
            code: "4.2",
            title: "Acids, Bases & Salts Preparation",
            desc: "Acid reactions, pH scale, neutralization, and the copper sulfate required practical.",
          },
          {
            code: "4.3",
            title: "Electrolysis & Aqueous Saline Rules",
            desc: "Decomposition of ionic compounds, electrode half-equations, and aqueous rules.",
          },
        ],
      },
      {
        title: "Energy Changes & Rates",
        desc: "Exothermic/endothermic profiles, collision theory, activation energy, and equilibrium.",
        points: [
          {
            code: "5.1",
            title: "Exothermic & Endothermic Profiles",
            desc: "Reaction profile diagrams, activation energy, and energy calculations.",
          },
          {
            code: "5.2",
            title: "Collision Theory & Rates factors",
            desc: "Explain effects of temperature, concentration, surface area, and catalysts.",
          },
          {
            code: "5.3",
            title: "Dynamic Equilibrium & Le Chatelier",
            desc: "Closed systems, reversible reactions, and predicting yield shifts.",
          },
        ],
      },
      {
        title: "Organic Chemistry & Crude Oil",
        desc: "Hydrocarbons, fractional distillation, cracking, alkenes, and addition polymerisation.",
        points: [
          {
            code: "6.1",
            title: "Fractional Distillation of Crude Oil",
            desc: "Separation based on boiling points, explaining alkane homologous series.",
          },
          {
            code: "6.2",
            title: "Cracking of Alkanes & Alkenes",
            desc: "Thermal and catalytic cracking, testing for unsaturation with bromine water.",
          },
        ],
      },
    ],
    physics: [
      {
        title: "Energy Stores & Transfers",
        desc: "Kinetic, gravitational, elastic, and thermal energy, work done, power, and efficiency.",
        points: [
          {
            code: "1.1",
            title: "Energy Stores and Equations",
            desc: "Calculate kinetic (0.5 * m * v²), gravitational potential (m * g * h), and elastic potential.",
          },
          {
            code: "1.2",
            title: "Power, Work Done & Efficiency",
            desc: "Rate of energy transfer, calculating useful energy efficiency, and thermal insulation.",
          },
        ],
      },
      {
        title: "Electricity & Circuit Theory",
        desc: "Current, charge, IV characteristics, series/parallel rules, domestic safety, and power.",
        points: [
          {
            code: "2.1",
            title: "Current, Charge and IV Characteristics",
            desc: "Q = I * t, and IV graphs of ohmic conductors, bulbs, diodes, LDRs, and thermistors.",
          },
          {
            code: "2.2",
            title: "Series and Parallel Circuit Rules",
            desc: "Rules for current, voltage, and total resistance additions in combinations.",
          },
          {
            code: "2.3",
            title: "Domestic Mains Electricity & Safety",
            desc: "AC mains (230V, 50Hz), live/neutral/earth wires, plugs, fuses, and circuit breakers.",
          },
        ],
      },
      {
        title: "Particle Model of Matter",
        desc: "Density, states of matter, internal energy, latent heat, and gas pressure.",
        points: [
          {
            code: "3.1",
            title: "Density Required Practical",
            desc: "Measure density of regular and irregular solids using displacement cans.",
          },
          {
            code: "3.2",
            title: "Internal Energy & Latent Heat",
            desc: "Kinetic and potential molecular energy, heating/cooling curves, latent heat.",
          },
        ],
      },
      {
        title: "Atomic Structure & Radiation",
        desc: "Atomic history, alpha/beta/gamma decay, half-life, contamination, fission, and fusion.",
        points: [
          {
            code: "4.1",
            title: "Radioactive Decay & Equations",
            desc: "Nuclear structure and balancing alpha, beta, and gamma emission equations.",
          },
          {
            code: "4.2",
            title: "Half-Life Calculation & Activity",
            desc: "Using half-life decay curves and intervals to calculate activity.",
          },
        ],
      },
      {
        title: "Forces, Motion & Momentum",
        desc: "Work, elasticity, speed/acceleration graphs, Newton's laws, stopping, and momentum.",
        points: [
          {
            code: "5.1",
            title: "Hooke's Law & Work Done",
            desc: "Force, elastic extension (F = k * e), limits of proportionality, and work.",
          },
          {
            code: "5.2",
            title: "Newton's Three Laws of Motion",
            desc: "Inertia, Force = mass * acceleration, action-reaction, and transport safety.",
          },
        ],
      },
      {
        title: "Waves & Electromagnetic Spectrum",
        desc: "Transverse/longitudinal waves, wave equations, reflection/refraction, EM waves, hazards.",
        points: [
          {
            code: "6.1",
            title: "Transverse vs Longitudinal Waves",
            desc: "Amplitude, frequency, wavelength, wave speed equation, comparing sound and light.",
          },
          {
            code: "6.2",
            title: "Electromagnetic Spectrum & Hazards",
            desc: "List waves from radio to gamma, detailing communication applications and ionisation.",
          },
        ],
      },
      {
        title: "Electromagnetism & Motor Effect",
        desc: "Magnetic fields, electromagnets, Fleming's left-hand rule, motors, generators, transformers.",
        points: [
          {
            code: "7.1",
            title: "Magnetic Fields & Fleming's Rule",
            desc: "Bar magnets and solenoid fields, calculating force (F = B * I * L) with left-hand rule.",
          },
          {
            code: "7.2",
            title: "Transformers & Induction",
            desc: "Induction, step-up and step-down transformers, primary/secondary voltage-turns ratios.",
          },
        ],
      },
      {
        title: "Space Physics",
        desc: "Star life cycles, orbital motion, red-shift, and expanding universe models.",
        points: [
          {
            code: "8.1",
            title: "Life Cycle of Stars",
            desc: "Fusion stages from nebula, main sequence, red giant, to white dwarf or supernova/black hole.",
          },
          {
            code: "8.2",
            title: "Orbital Motion & Red-Shift",
            desc: "Circular orbits, gravity, and red-shift evidence of the expanding universe.",
          },
        ],
      },
    ],
  },
  alevel: {
    biology: [
      {
        title: "Biological Molecules",
        desc: "Carbohydrates, lipids, proteins, DNA, RNA, ATP, water, and inorganic ions.",
        points: [
          {
            code: "1.1",
            title: "Molecules of Life & Condensation",
            desc: "Monomers, polymers, condensation, and hydrolysis in carbohydrates and lipids.",
          },
          {
            code: "1.2",
            title: "Proteins & Enzyme Kinetics",
            desc: "Primary, secondary, tertiary, quaternary structures, and enzyme competitive/non-competitive inhibition.",
          },
          {
            code: "1.3",
            title: "Nucleic Acids & Semi-Conservative Replication",
            desc: "DNA, RNA structure, semi-conservative replication, DNA helicase, and DNA polymerase.",
          },
        ],
      },
      {
        title: "Cells, Transport & Immunology",
        desc: "Cell ultrastructure, membrane transport, cell cycle, and antigen response.",
        points: [
          {
            code: "2.1",
            title: "Eukaryotic, Prokaryotic & Viral Structure",
            desc: "Ultra-structure of animal/plant organelles, bacterial cells, and non-living viruses.",
          },
          {
            code: "2.2",
            title: "Cell Membrane & Transport Dynamics",
            desc: "Fluid mosaic model, active transport, co-transport, facilitated diffusion, and osmosis.",
          },
          {
            code: "2.3",
            title: "Immunology & Monoclonal Antibodies",
            desc: "Phagocytosis, T-cells, B-cells, antibody structure, vaccines, and monoclonal treatments.",
          },
        ],
      },
      {
        title: "Exchange & Transport Systems",
        desc: "Gas exchange in insects, fish, mammals, and transport of water/nutrients.",
        points: [
          {
            code: "3.1",
            title: "Gas Exchange Surface Adaptation",
            desc: "Fick's law, fish counter-current exchange, insect tracheal systems, human alveoli.",
          },
          {
            code: "3.2",
            title: "Hemoglobin & Oxygen Dissociation",
            desc: "Quaternary structure of hemoglobin, cooperative binding, Bohr shift in carbon dioxide.",
          },
        ],
      },
      {
        title: "Energy Transfers",
        desc: "Respiration pathways, photosynthetic light reactions, and nutrient cycles.",
        points: [
          {
            code: "4.1",
            title: "Photosynthesis: Light & Dark Reactions",
            desc: "Photophosphorylation, photolysis of water, Calvin cycle, Rubisco, limiting constraints.",
          },
          {
            code: "4.2",
            title: "Respiration: Glycolysis & Krebs Cycle",
            desc: "Anaerobic glycolysis, link reaction, Krebs cycle, oxidative phosphorylation electron chain.",
          },
        ],
      },
    ],
    chemistry: [
      {
        title: "Physical Chemistry Foundations",
        desc: "Atomic mass, formulas, bonding structures, kinetics, thermodynamics, and equilibria.",
        points: [
          {
            code: "1.1",
            title: "Moles, Concentration & Stoichiometry",
            desc: "Advanced reacting masses, gas volumes (pV = nRT), atom economy, titrations.",
          },
          {
            code: "1.2",
            title: "Energetics & Born-Haber Cycles",
            desc: "Hess's Law, enthalpy change of formation, lattice enthalpy, Born-Haber cycle grids.",
          },
        ],
      },
      {
        title: "Inorganic Chemistry",
        desc: "Periodicity trends, alkaline earth metals, halogens, transition metals, and complexes.",
        points: [
          {
            code: "2.1",
            title: "Transition Metals & Complex Ions",
            desc: "Coordinate bonding, ligand substitution, d-orbital splitting, colors, and catalysis.",
          },
        ],
      },
      {
        title: "Organic Chemistry & Synthesis",
        desc: "Functional groups, naming conventions, isomerism, reaction mechanisms, and modern analysis.",
        points: [
          {
            code: "3.1",
            title: "Reaction Mechanisms & Isomerism",
            desc: "Nucleophilic substitution, elimination, electrophilic addition, optical isomerism.",
          },
          {
            code: "3.2",
            title: "Modern Spectroscopy (NMR, IR & MS)",
            desc: "Deduce organic structures using Proton/Carbon-13 NMR, Infrared, and Mass spectrometry.",
          },
        ],
      },
    ],
    physics: [
      {
        title: "Particles & Radiation",
        desc: "Constituents of the atom, quarks, leptons, Feynman diagrams, photoelectric effect.",
        points: [
          {
            code: "1.1",
            title: "Standard Model of Matter: Quarks",
            desc: "Quark compositions of protons, neutrons, beta-plus and beta-minus weak decays.",
          },
          {
            code: "1.2",
            title: "Photoelectric Effect & Wave-Duality",
            desc: "Work function, threshold frequency, Einstein's equation, de Broglie wavelength.",
          },
        ],
      },
      {
        title: "Mechanics, Materials & Waves",
        desc: "Vectors, projectiles, moments, Young Modulus, wave superposition, diffraction.",
        points: [
          {
            code: "2.1",
            title: "Young Modulus & Material Stress",
            desc: "Tensile stress, strain, elastic limit, plastic deformation, and Young Modulus curves.",
          },
          {
            code: "2.2",
            title: "Superposition of Waves & Diffraction",
            desc: "Stationary waves, interference, double-slit experiment, diffraction grating formulas.",
          },
        ],
      },
      {
        title: "Fields & Further Mechanics",
        desc: "Gravitational, electrostatic, and magnetic fields, circular/harmonic motion, nuclear physics.",
        points: [
          {
            code: "3.1",
            title: "Circular Motion & Harmonics",
            desc: "Centripetal force, angular speed, simple harmonic motion, resonance, and damping.",
          },
          {
            code: "3.2",
            title: "Gravitational & Electrostatic Fields",
            desc: "Newton's law of gravity, Coulomb's law, field potentials, Kepler's third law orbits.",
          },
        ],
      },
    ],
  },
};

// Generates dynamic topics & spec points on-the-fly for any requested board, level, and subject combination
function getMockCurriculum(
  level: LevelV,
  board: BoardV,
  subject: SubjectV,
): Array<{ topic: Topic; points: SpecPoint[] }> {
  const blueprints = BLUEPRINTS[level]?.[subject] || BLUEPRINTS.gcse.biology;
  const boardLabel = board.toUpperCase();
  const subjectPrefix = board === "aqa" ? "AQA" : board === "edexcel" ? "EDEX" : "OCR";

  return blueprints.map((blueprint, tIndex) => {
    // Preserve old specific IDs if they exist to match original DB schemas perfectly
    let topicId = `${board}-${subject}-${level}-t${tIndex + 1}`;
    if (board === "aqa" && subject === "biology" && level === "gcse") {
      if (tIndex === 0) topicId = "aqa-bio-gcse-t1";
      else if (tIndex === 3) topicId = "aqa-bio-gcse-t2";
    } else if (board === "edexcel" && subject === "biology" && level === "gcse" && tIndex === 0) {
      topicId = "ed-bio-gcse-t1";
    } else if (board === "ocr" && subject === "biology" && level === "gcse" && tIndex === 0) {
      topicId = "ocr-bio-gcse-t1";
    } else if (board === "aqa" && subject === "biology" && level === "alevel" && tIndex === 0) {
      topicId = "aqa-bio-alevel-t1";
    } else if (board === "edexcel" && subject === "chemistry" && level === "gcse" && tIndex === 3) {
      topicId = "ed-chem-gcse-t1";
    }

    const topicCode = level === "alevel" ? `Module ${tIndex + 1}` : `Topic ${tIndex + 1}`;

    const topic: Topic = {
      id: topicId,
      code: topicCode,
      title: `${blueprint.title}`,
      description: blueprint.desc,
      sort_order: tIndex + 1,
    };

    const points: SpecPoint[] = blueprint.points.map((p, pIndex) => {
      const specCode = `${subjectPrefix} ${p.code}`;

      // Preserve old specific point IDs
      let pointId = `${board}-${subject}-${level}-p${tIndex + 1}-${pIndex + 1}`;
      if (topicId === "aqa-bio-gcse-t1") {
        if (pIndex === 0) pointId = "aqa-bio-gcse-p1";
        else if (pIndex === 1) pointId = "aqa-bio-gcse-p2";
        else if (pIndex === 2) pointId = "aqa-bio-gcse-p3";
      } else if (topicId === "aqa-bio-gcse-t2") {
        if (pIndex === 0) pointId = "aqa-bio-gcse-p4";
        else if (pIndex === 1) pointId = "aqa-bio-gcse-p5";
      } else if (topicId === "ed-bio-gcse-t1") {
        if (pIndex === 0) pointId = "ed-bio-gcse-p1";
        else if (pIndex === 1) pointId = "ed-bio-gcse-p2";
      } else if (topicId === "ocr-bio-gcse-t1" && pIndex === 0) {
        pointId = "ocr-bio-gcse-t1-p1";
      } else if (topicId === "aqa-bio-alevel-t1") {
        if (pIndex === 0) pointId = "aqa-bio-alevel-p1";
        else if (pIndex === 1) pointId = "aqa-bio-alevel-p2";
      } else if (topicId === "ed-chem-gcse-t1" && pIndex === 0) {
        pointId = "ed-chem-gcse-p1";
      }

      return {
        id: pointId,
        topic_id: topicId,
        code: specCode,
        title: p.title,
        description: p.desc,
      };
    });

    return { topic, points };
  });
}

function Curriculum() {
  const { isTutor } = useRoles();
  const [subject, setSubject] = useState<SubjectV>("biology");
  const [board, setBoard] = useState<BoardV>("edexcel");
  const [level, setLevel] = useState<LevelV>("gcse");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Selected specification point state to handle full sub-page navigation
  const [selectedSpecPoint, setSelectedSpecPoint] = useState<SpecPoint | null>(null);

  const loadTopics = async () => {
    setLoading(true);
    const isDemo =
      typeof window !== "undefined" && localStorage.getItem("studyhub:is-demo") === "true";
    if (isDemo) {
      const curriculumList = getMockCurriculum(level, board, subject);
      setTopics(curriculumList.map((c) => c.topic));
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("topics")
      .select("id, code, title, description, sort_order")
      .eq("subject", subject)
      .eq("board", board)
      .eq("level", level)
      .order("sort_order")
      .order("code");
    setTopics(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadTopics(); /* eslint-disable-next-line */
  }, [subject, board, level]);

  // Handle viewing full-page specification point details
  if (selectedSpecPoint) {
    return (
      <AppLayout title="Curriculum Point">
        <div className="max-w-4xl mx-auto space-y-6">
          <button
            onClick={() => setSelectedSpecPoint(null)}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition font-semibold"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Curriculum
          </button>

          <div className="rounded-2xl border border-border bg-card p-6 relative overflow-hidden shadow-xs">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary to-accent" />

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-extrabold bg-primary/10 text-primary">
                {level === "alevel" ? "A-Level" : "GCSE"}
              </span>
              <span className="text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-extrabold bg-accent/10 text-accent">
                {board.toUpperCase()}
              </span>
              <span className="text-[10px] px-2.5 py-1 rounded-full uppercase tracking-wider font-extrabold bg-secondary text-foreground">
                {subject.toUpperCase()}
              </span>
            </div>

            <p className="font-mono text-xs text-primary font-bold">
              Specification Point {selectedSpecPoint.code}
            </p>
            <h2 className="font-display text-2xl font-bold text-foreground mt-1.5 leading-snug">
              {selectedSpecPoint.title}
            </h2>
            {selectedSpecPoint.description && (
              <p className="text-sm text-muted-foreground mt-3 leading-relaxed whitespace-pre-wrap">
                {selectedSpecPoint.description}
              </p>
            )}
          </div>

          <div className="mt-8">
            <SpecPointDetail
              point={selectedSpecPoint}
              isTutor={isTutor}
              onChanged={loadTopics}
              level={level}
              subject={subject}
              board={board}
            />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Curriculum">
      <p className="text-muted-foreground mb-6 max-w-2xl">
        Explore interactive specification points across chemistry, physics, and biology. Select your
        level, exam board, and subject to begin.
      </p>

      <div className="rounded-2xl bg-card border border-border p-5 mb-6">
        <div className="grid grid-cols-3 gap-3">
          <Filter
            label="Subject"
            value={subject}
            onChange={(v) => setSubject(v as SubjectV)}
            opts={SUBJECTS}
          />
          <Filter
            label="Board"
            value={board}
            onChange={(v) => setBoard(v as BoardV)}
            opts={BOARDS}
          />
          <Filter
            label="Level"
            value={level}
            onChange={(v) => setLevel(v as LevelV)}
            opts={LEVELS}
          />
        </div>
      </div>

      {isTutor && (
        <TopicCreate subject={subject} board={board} level={level} onCreated={loadTopics} />
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading topics…</p>
      ) : topics.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <BookMarked className="w-8 h-8 mx-auto mb-3 opacity-50" />
          No topics yet for this subject/board/level.
          {isTutor && <p className="mt-2 text-xs">Add one above to get started.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {topics.map((t) => (
            <TopicCard
              key={t.id}
              topic={t}
              open={openTopicId === t.id}
              onToggle={() => setOpenTopicId(openTopicId === t.id ? null : t.id)}
              isTutor={isTutor}
              onDeleted={loadTopics}
              level={level}
              board={board}
              subject={subject}
              onSelectSpecPoint={(p) => setSelectedSpecPoint(p)}
            />
          ))}
        </div>
      )}
    </AppLayout>
  );
}

function Filter<T extends string>({
  label,
  value,
  onChange,
  opts,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  opts: readonly { value: T; label: string }[];
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        {label}
      </label>
      <select
        className={inputCls + " h-10 mt-1"}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TopicCreate({
  subject,
  board,
  level,
  onCreated,
}: {
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  onCreated: () => void;
}) {
  const { userId } = useRoles();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    const { error } = await supabase.from("topics").insert({
      subject,
      board,
      level,
      code: code || null,
      title,
      created_by: userId,
    });
    if (error) return toast.error(error.message);
    setCode("");
    setTitle("");
    setOpen(false);
    onCreated();
    toast.success("Topic created");
  };
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full h-11 border border-dashed border-border rounded-xl flex items-center justify-center gap-2 text-xs font-semibold hover:border-primary/50 text-muted-foreground hover:text-primary mb-4 transition"
      >
        <Plus className="w-4 h-4" /> Add Topic
      </button>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-border p-4 mb-4 bg-muted/40 space-y-3"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        New Topic
      </p>
      <div className="grid grid-cols-1 md:grid-cols-[100px,1fr] gap-3">
        <div>
          <label className="text-[10px] uppercase text-muted-foreground">Code</label>
          <input
            className={inputCls}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="4.1"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-muted-foreground">Title</label>
          <input
            required
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Cell Biology"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-8 px-3 rounded-md text-xs hover:bg-secondary border border-border"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="h-8 px-3 rounded-md text-xs bg-primary text-primary-foreground font-semibold"
        >
          Create
        </button>
      </div>
    </form>
  );
}

function TopicCard({
  topic,
  open,
  onToggle,
  isTutor,
  onDeleted,
  level,
  board,
  subject,
  onSelectSpecPoint,
}: {
  topic: Topic;
  open: boolean;
  onToggle: () => void;
  isTutor: boolean;
  onDeleted: () => void;
  level: LevelV;
  board: BoardV;
  subject: SubjectV;
  onSelectSpecPoint: (p: SpecPoint) => void;
}) {
  const [points, setPoints] = useState<SpecPoint[]>([]);

  useEffect(() => {
    if (!open) return;
    const isDemo =
      typeof window !== "undefined" && localStorage.getItem("studyhub:is-demo") === "true";
    if (isDemo) {
      const curriculumList = getMockCurriculum(level, board, subject);
      const found = curriculumList.find((c) => c.topic.id === topic.id);
      setPoints(found ? found.points : []);
      return;
    }

    supabase
      .from("spec_points")
      .select("id, topic_id, code, title, description")
      .eq("topic_id", topic.id)
      .order("sort_order")
      .order("code")
      .then(({ data }) => {
        setPoints(data ?? []);
      });
  }, [open, topic.id, level, board, subject]);

  const reload = async () => {
    const isDemo =
      typeof window !== "undefined" && localStorage.getItem("studyhub:is-demo") === "true";
    if (isDemo) return;

    const { data } = await supabase
      .from("spec_points")
      .select("id, topic_id, code, title, description")
      .eq("topic_id", topic.id)
      .order("sort_order")
      .order("code");
    setPoints(data ?? []);
  };

  const del = async () => {
    if (!confirm(`Delete topic "${topic.title}" and all its spec points?`)) return;
    const { error } = await supabase.from("topics").delete().eq("id", topic.id);
    if (error) return toast.error(error.message);
    toast.success("Topic deleted");
    onDeleted();
  };

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-secondary/40"
      >
        <div className="flex items-center gap-3">
          <ChevronRight className={`w-4 h-4 transition ${open ? "rotate-90" : ""}`} />
          {topic.code && (
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-primary/15 text-primary">
              {topic.code}
            </span>
          )}
          <span className="font-display font-semibold">{topic.title}</span>
        </div>
        {isTutor && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              del();
            }}
            className="text-muted-foreground hover:text-destructive p-1"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </button>
      {open && (
        <div className="border-t border-border p-5 space-y-4">
          {isTutor && <SpecPointCreate topicId={topic.id} onCreated={reload} />}
          {points.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No spec points yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {points.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSelectSpecPoint(p)}
                  className="text-left p-4 rounded-xl border border-border bg-secondary/10 hover:border-primary/50 hover:bg-secondary/30 transition flex items-start gap-3 group"
                >
                  <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded shrink-0 mt-0.5">
                    {p.code}
                  </span>
                  <div>
                    <h4 className="font-semibold text-sm text-foreground leading-tight group-hover:text-primary transition">
                      {p.title}
                    </h4>
                    {p.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-normal">
                        {p.description}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SpecPointCreate({ topicId, onCreated }: { topicId: string; onCreated: () => void }) {
  const { userId } = useRoles();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    const { error } = await supabase.from("spec_points").insert({
      topic_id: topicId,
      code,
      title,
      description: description || null,
      created_by: userId,
    });
    if (error) return toast.error(error.message);
    setCode("");
    setTitle("");
    setDescription("");
    setOpen(false);
    onCreated();
    toast.success("Spec point added");
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full h-10 border border-dashed border-border rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold hover:border-primary/50 text-muted-foreground hover:text-primary transition"
      >
        <Plus className="w-3.5 h-3.5" /> Add Specification Point
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl bg-secondary/40 border border-border p-4 space-y-3"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        New Spec Point
      </p>
      <div className="grid grid-cols-1 md:grid-cols-[100px,1fr] gap-3">
        <div>
          <label className="text-[10px] uppercase text-muted-foreground">Code</label>
          <input
            required
            className={inputCls}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="4.1.1"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-muted-foreground">Title</label>
          <input
            required
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Structure of organelles"
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] uppercase text-muted-foreground">Description</label>
        <textarea
          className="w-full min-h-16 rounded-md bg-secondary border border-border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Syllabus specification requirements detail"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-8 px-3 rounded-md text-xs hover:bg-secondary border border-border"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="h-8 px-3 rounded-md text-xs bg-primary text-primary-foreground font-semibold"
        >
          Add Point
        </button>
      </div>
    </form>
  );
}

function SpecPointDetail({
  point,
  isTutor,
  onChanged,
  level,
  subject,
  board,
}: {
  point: SpecPoint;
  isTutor: boolean;
  onChanged: () => void;
  level: LevelV;
  subject: SubjectV;
  board: BoardV;
}) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [mcqSets, setMcqSets] = useState<McqSet[]>([]);
  const [genLoading, setGenLoading] = useState(false);
  const genFn = useServerFn(generateMcqSet);

  const reload = async () => {
    const isDemo =
      typeof window !== "undefined" && localStorage.getItem("studyhub:is-demo") === "true";
    if (isDemo) {
      const rList: Resource[] = [];
      const mList: McqSet[] = [];

      // Walkthrough Video
      rList.push({
        id: `res-video-${point.id}`,
        kind: "video",
        title: `Comprehensive Video Guide: ${point.code} ${point.title}`,
        description: `Full syllabus walkthrough of ${point.title} including core concepts, exam mark-scheme guidelines, and common mistakes.`,
        video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        file_path: null,
        file_name: null,
        starts_at: null,
        join_url: null,
        due_at: null,
      });

      // Live Mastery Session
      rList.push({
        id: `res-live-${point.id}`,
        kind: "live_session",
        title: `Live Mastery Session: ${point.title}`,
        description: `Interactive small-group tutorial focusing on high-scoring questions and past-paper analysis.`,
        video_url: null,
        file_path: null,
        file_name: null,
        starts_at: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
        join_url: "/live",
        due_at: null,
      });

      // Homework Assignment
      rList.push({
        id: `res-hw-${point.id}`,
        kind: "homework",
        title: `${point.title} GCSE Assignment Sheet`,
        description: `Download, complete, and submit this assignment for detailed feedback from your tutor.`,
        video_url: null,
        file_path: null,
        file_name: null,
        starts_at: null,
        join_url: null,
        due_at: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
      });

      // Revision cheatsheet download
      rList.push({
        id: `res-dl-${point.id}`,
        kind: "download",
        title: `${point.title} Core Revision Cheatsheet`,
        description: `Essential formulae, definition lists, and active recall flashcards.`,
        video_url: null,
        file_path: "mock-download",
        file_name: `${point.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_revision_sheet.pdf`,
        starts_at: null,
        join_url: null,
        due_at: null,
      });

      // MCQ Assessment Set
      mList.push({
        id: `mcq-set-${point.id}`,
        title: `${level.toUpperCase()} ${subject.charAt(0).toUpperCase() + subject.slice(1)}: ${point.title} (${board.toUpperCase()} ${point.code})`,
        published: true,
      });

      setResources(rList);
      setMcqSets(mList);
      return;
    }

    const [r, m] = await Promise.all([
      supabase
        .from("resources")
        .select(
          "id, kind, title, description, video_url, file_path, file_name, starts_at, join_url, due_at",
        )
        .eq("spec_point_id", point.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("mcq_sets")
        .select("id, title, published")
        .eq("spec_point_id", point.id)
        .order("created_at", { ascending: false }),
    ]);
    setResources(r.data ?? []);
    setMcqSets(m.data ?? []);
  };

  useEffect(() => {
    reload(); /* eslint-disable-next-line */
  }, [point.id, level, subject, board]);

  const generate = async () => {
    setGenLoading(true);
    try {
      const res = await genFn({
        data: {
          specPointId: point.id,
          title: point.title,
          context: point.description || "",
          count: 6,
        },
      });
      toast.success(`Generated ${res.count} questions — review & publish`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenLoading(false);
    }
  };

  const publish = async (setId: string, published: boolean) => {
    const { error } = await supabase
      .from("mcq_sets")
      .update({ published: !published })
      .eq("id", setId);
    if (error) return toast.error(error.message);
    reload();
  };

  const delSet = async (setId: string) => {
    if (!confirm("Delete this MCQ set?")) return;
    const { error } = await supabase.from("mcq_sets").delete().eq("id", setId);
    if (error) return toast.error(error.message);
    reload();
  };

  return (
    <div className="space-y-6">
      {isTutor && (
        <div className="rounded-xl bg-secondary/40 border border-border p-4 flex flex-wrap gap-2">
          <button
            onClick={generate}
            disabled={genLoading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-accent/20 border border-accent/40 text-accent-foreground text-xs font-semibold hover:bg-accent/30 disabled:opacity-60"
          >
            <Sparkles className="w-3.5 h-3.5" /> {genLoading ? "Generating…" : "AI generate MCQs"}
          </button>
          <Link
            to="/tutor"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs text-foreground font-semibold hover:bg-secondary/40 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Add resource in Tutor Studio
          </Link>
        </div>
      )}

      <div className="space-y-4">
        {/* MCQ Sets Section */}
        <CollapsibleSection
          title="MCQ Sets"
          icon={ListChecks}
          count={mcqSets.length}
          defaultOpen={mcqSets.length > 0}
        >
          {mcqSets.length === 0 ? (
            <Empty label="No MCQ sets yet." />
          ) : (
            <ul className="space-y-2.5">
              {mcqSets.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between px-3.5 py-3 rounded-xl bg-secondary/10 border border-border"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 uppercase tracking-wider ${s.published ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
                    >
                      {s.published ? "Published" : "Draft"}
                    </span>
                    <span className="text-sm font-semibold truncate text-foreground">
                      {s.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(s.published || isTutor) && (
                      <Link
                        to="/mcq/$setId"
                        params={{ setId: s.id }}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-border bg-background hover:border-primary/50 text-foreground font-medium transition"
                      >
                        Take
                      </Link>
                    )}
                    {isTutor && (
                      <>
                        <button
                          onClick={() => publish(s.id, s.published)}
                          className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition"
                        >
                          {s.published ? "Unpublish" : "Publish"}
                        </button>
                        <button
                          onClick={() => delSet(s.id)}
                          className="text-muted-foreground hover:text-destructive p-1 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        {/* Syllabus Videos Section */}
        <CollapsibleResourceGroup
          label="Syllabus Videos"
          icon={PlayCircle}
          items={resources.filter((r) => r.kind === "video")}
          render={(r) => (
            <a
              href={r.video_url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold text-foreground hover:text-primary flex items-start gap-2.5 leading-snug w-full"
            >
              <PlayCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <span>{r.title}</span>
                {r.description && (
                  <p className="text-xs font-normal text-muted-foreground mt-0.5 leading-normal">
                    {r.description}
                  </p>
                )}
              </div>
            </a>
          )}
        />

        {/* Live Sessions Section */}
        <CollapsibleResourceGroup
          label="Live Sessions"
          icon={CalendarClock}
          items={resources.filter((r) => r.kind === "live_session")}
          render={(r) => (
            <div className="flex flex-col gap-1.5 w-full">
              <div className="flex items-start justify-between gap-2 text-sm font-semibold text-foreground leading-snug">
                <span>{r.title}</span>
                {r.join_url && (
                  <a
                    href={r.join_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground font-bold"
                  >
                    Join
                  </a>
                )}
              </div>
              {r.description && (
                <p className="text-xs font-normal text-muted-foreground leading-normal">
                  {r.description}
                </p>
              )}
              {r.starts_at && (
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
                  Starts: {new Date(r.starts_at).toLocaleString()}
                </span>
              )}
            </div>
          )}
        />

        {/* Homework Assignments Section */}
        <CollapsibleResourceGroup
          label="Homework Assignments"
          icon={ClipboardList}
          items={resources.filter((r) => r.kind === "homework")}
          render={(r) => (
            <div className="flex flex-col gap-1.5 w-full">
              <div className="flex items-start justify-between gap-2 text-sm font-semibold text-foreground leading-snug">
                <span className="font-semibold">{r.title}</span>
                <Link
                  to="/homework"
                  className="text-[10px] px-2 py-0.5 rounded bg-secondary text-foreground hover:bg-primary hover:text-primary-foreground font-bold transition"
                >
                  View Desk
                </Link>
              </div>
              {r.description && (
                <p className="text-xs text-muted-foreground leading-normal font-normal">
                  {r.description}
                </p>
              )}
              {r.due_at && (
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
                  due {new Date(r.due_at).toLocaleDateString()}
                </span>
              )}
            </div>
          )}
        />

        {/* Revision Downloads Section */}
        <CollapsibleResourceGroup
          label="Revision Downloads"
          icon={Download}
          items={resources.filter((r) => r.kind === "download")}
          render={(r) => (
            <DownloadRow
              file_path={r.file_path}
              title={r.title}
              name={r.file_name}
              description={r.description}
            />
          )}
        />
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  icon: Icon,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden transition-all duration-200">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-secondary/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-bold text-sm text-foreground leading-none">{title}</h3>
            <p className="text-[11px] text-muted-foreground mt-1">
              {count} {count === 1 ? "item" : "items"} available
            </p>
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180 text-primary" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden border-t border-border bg-muted/20"
          >
            <div className="p-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CollapsibleResourceGroup<T extends { id: string }>({
  label,
  icon,
  items,
  render,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: T[];
  render: (r: T) => React.ReactNode;
}) {
  return (
    <CollapsibleSection
      title={label}
      icon={icon}
      count={items.length}
      defaultOpen={items.length > 0}
    >
      {items.length === 0 ? (
        <Empty label={`No ${label.toLowerCase()} yet.`} />
      ) : (
        <ul className="space-y-2.5">
          {items.map((r) => (
            <li
              key={r.id}
              className="p-3.5 rounded-xl bg-secondary/10 border border-border flex flex-col items-start hover:border-primary/20 transition-all"
            >
              {render(r)}
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-xs italic text-muted-foreground">{label}</p>;
}

function DownloadRow({
  file_path,
  title,
  name,
  description,
}: {
  file_path: string | null;
  title: string;
  name: string | null;
  description?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const isDemo =
      typeof window !== "undefined" && localStorage.getItem("studyhub:is-demo") === "true";
    if (isDemo) {
      setUrl("https://www.orpington-tutoring.co.uk/gcse-science-limiting-factors-cheatsheet.pdf");
      return;
    }
    if (!file_path) return;
    supabase.storage
      .from("resources")
      .createSignedUrl(file_path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [file_path]);

  return (
    <div className="w-full">
      <a
        href={url ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-semibold text-foreground hover:text-primary flex items-center gap-2 leading-tight"
      >
        <Download className="w-4 h-4 text-primary shrink-0" />
        <div>
          <span>{title}</span>
          {name && (
            <span className="text-xs font-normal text-muted-foreground ml-1.5">({name})</span>
          )}
        </div>
      </a>
      {description && (
        <p className="text-xs text-muted-foreground font-normal leading-normal mt-1 pl-6">
          {description}
        </p>
      )}
    </div>
  );
}
