// Video mapping database for OCR and Edexcel GCSE Biology
// Mapped to high-quality Khan Academy, Cognito, and premium GCSE educational videos.

export interface EducationalVideo {
  video_url: string;
  title: string;
  description: string;
}

// Map of core videos based on topic sections for Edexcel GCSE Biology
const EDEXCEL_VIDEO_SECTIONS = [
  {
    range: { start: 1.1, end: 1.2 },
    video_url: "https://www.youtube.com/watch?v=8V-mU6OqI8M",
    title: "Cognito - Eukaryotic and Prokaryotic Cells",
    description:
      "Learn about the difference between eukaryotic cells (plant and animal cells) and prokaryotic cells (bacteria), including their sub-cellular structures.",
  },
  {
    range: { start: 1.2, end: 1.29 },
    video_url: "https://www.youtube.com/watch?v=URUJD5NEXC8",
    title: "Cognito - Specialised Cells & Adaptations",
    description:
      "Explore how specialised cells like sperm cells, egg cells, and ciliated epithelial cells are adapted to their functions.",
  },
  {
    range: { start: 1.3, end: 1.6 },
    video_url: "https://www.youtube.com/watch?v=7Xv4wH-2YtY",
    title: "Cognito - Microscopy & Specimen Investigation",
    description:
      "A complete guide to light and electron microscopes, magnification calculations (I = A x M), and specimen staining.",
  },
  {
    range: { start: 1.7, end: 1.12 },
    video_url: "https://www.youtube.com/watch?v=ndV38T_vCms",
    title: "Cognito - Enzymes: Lock and Key & Denaturation",
    description:
      "Understand the active site, enzyme-substrate specificity, temperature and pH effects, and the denaturation process.",
  },
  {
    range: { start: 1.13, end: 1.13 },
    video_url: "https://www.youtube.com/watch?v=f7w4w99t7V0",
    title: "Cognito - Reagents for Food Tests",
    description:
      "A core practical guide on how to test foods for starch (iodine), reducing sugars (Benedict's), proteins (Biuret), and lipids (emulsion).",
  },
  {
    range: { start: 1.14, end: 1.14 },
    video_url: "https://www.youtube.com/watch?v=9g0HhP_z_X0",
    title: "FreeScienceLessons - Energy and Calorimetry in Food",
    description:
      "Learn how to measure the energy content of food samples using calorimetry and temperature calculations.",
  },
  {
    range: { start: 1.15, end: 1.17 },
    video_url: "https://www.youtube.com/watch?v=jhsz72_rY0A",
    title: "Cognito - Diffusion, Osmosis & Active Transport",
    description:
      "Compare the three main types of cellular transport: passive diffusion, osmosis of water, and energy-requiring active transport.",
  },
  {
    range: { start: 2.1, end: 2.3 },
    video_url: "https://www.youtube.com/watch?v=gwcwSZIfKlM",
    title: "Cognito - Mitosis and the Cell Cycle",
    description:
      "Step-by-step overview of mitosis (interphase, prophase, metaphase, anaphase, telophase) and its importance for growth and repair.",
  },
  {
    range: { start: 2.4, end: 2.4 },
    video_url: "https://www.youtube.com/watch?v=QVCjdNxJreE",
    title: "Amoeba Sisters - Cancer and Uncontrolled Cell Division",
    description:
      "Understand how mutations in cell cycle checkpoints can lead to uncontrolled cell division and tumor growth.",
  },
  {
    range: { start: 2.5, end: 2.7 },
    video_url: "https://www.youtube.com/watch?v=A2GshV_7t1g",
    title: "Khan Academy - Percentile Growth Charts & Development",
    description:
      "Understand how percentile charts are plotted and interpreted to track human and plant development over time.",
  },
  {
    range: { start: 2.8, end: 2.9 },
    video_url: "https://www.youtube.com/watch?v=9L9Xoasg6C4",
    title: "Cognito - Embryonic & Adult Stem Cells",
    description:
      "Explore the features, ethical concerns, and clinical applications of embryonic and adult stem cells in regenerative medicine.",
  },
  {
    range: { start: 2.1, end: 2.12 },
    video_url: "https://www.youtube.com/watch?v=P_I8A_G6u2o",
    title: "Cognito - Structure and Functions of the Brain",
    description:
      "Discover the core components of the human brain (cerebrum, cerebellum, medulla oblongata) and scanning technologies like CT and PET.",
  },
  {
    range: { start: 2.13, end: 2.14 },
    video_url: "https://www.youtube.com/watch?v=tZ9S_k-81hQ",
    title: "Cognito - The Nervous System & Reflex Arcs",
    description:
      "How sensory, relay, and motor neurones cooperate with synapses to form rapid, protective reflex arcs.",
  },
  {
    range: { start: 2.15, end: 2.17 },
    video_url: "https://www.youtube.com/watch?v=gT8H-cW6fR0",
    title: "Cognito - Structure and Function of the Eye",
    description:
      "Learn about accommodation, iris reflex, rod/cone cells, and correcting short-sightedness, long-sightedness, and cataracts.",
  },
  {
    range: { start: 3.1, end: 3.3 },
    video_url: "https://www.youtube.com/watch?v=D-hZ6m_YjRE",
    title: "Cognito - Meiosis & Sexual vs Asexual Reproduction",
    description:
      "Understand how gametes are formed through meiosis, introducing genetic variation, and the trade-offs of reproductive strategies.",
  },
  {
    range: { start: 3.4, end: 3.6 },
    video_url: "https://www.youtube.com/watch?v=v3M98P1uP1c",
    title: "Cognito - DNA Structure, Genes & Genome",
    description:
      "A deep dive into the DNA polymer, nucleotide structure, complementary base pairings, and the definition of the genome.",
  },
  {
    range: { start: 3.7, end: 3.1 },
    video_url: "https://www.youtube.com/watch?v=h5mJbP23Y_A",
    title: "Cognito - Protein Synthesis (Transcription & Translation)",
    description:
      "Step-by-step molecular processes: RNA polymerase transcription inside the nucleus, and ribosome translation using tRNA.",
  },
  {
    range: { start: 3.11, end: 3.19 },
    video_url: "https://www.youtube.com/watch?v=YpBv7-c994I",
    title: "Cognito - Monohybrid Crosses, Alleles & Punnett Squares",
    description:
      "Predict genotype and phenotype ratios using Punnett squares, homozygous vs heterozygous combinations, and Mendel's historic laws.",
  },
  {
    range: { start: 3.2, end: 3.23 },
    video_url: "https://www.youtube.com/watch?v=oV8g7rBfW3o",
    title: "Amoeba Sisters - Mutations, DNA Changes & Variation",
    description:
      "Explore the effects of gene mutations (substitution, insertion, deletion) on the final protein structure and cellular function.",
  },
  {
    range: { start: 4.1, end: 4.6 },
    video_url: "https://www.youtube.com/watch?v=vVf4w7v9bZ8",
    title: "Cognito - Natural Selection & Darwinian Evolution",
    description:
      "Learn about survival of the fittest, environmental pressures, genetic mutations, antibiotic-resistant bacteria, and fossil evidence.",
  },
  {
    range: { start: 4.7, end: 4.7 },
    video_url: "https://www.youtube.com/watch?v=N6Lp6K1C5_U",
    title: "Cognito - Selective Breeding & Artificial Selection",
    description:
      "Understand how humans select desirable traits in agriculture and companion animals, and the drawbacks of inbreeding.",
  },
  {
    range: { start: 4.8, end: 4.14 },
    video_url: "https://www.youtube.com/watch?v=r0XW1e7L8y8",
    title: "Cognito - Genetic Modification & Biotechnology Vectors",
    description:
      "Learn about restriction enzymes, ligases, plasmids, vectors, and modifying bacteria to synthesize human insulin.",
  },
  {
    range: { start: 5.1, end: 5.5 },
    video_url: "https://www.youtube.com/watch?v=Yf9p8mZ7X8Q",
    title: "Cognito - Communicable Diseases and Pathogens",
    description:
      "Explore viral, bacterial, fungal, and protist pathogens, their modes of transmission, and how to prevent the spread.",
  },
  {
    range: { start: 5.6, end: 5.7 },
    video_url: "https://www.youtube.com/watch?v=6805H8G_sU0",
    title: "GCSE Biology - Sexually Transmitted Infections",
    description:
      "How pathogens causing HIV/AIDS and Chlamydia are transmitted, their physiological effects, and barrier control methods.",
  },
  {
    range: { start: 5.8, end: 5.1 },
    video_url: "https://www.youtube.com/watch?v=9g0HhP_z_X0",
    title: "FreeScienceLessons - Plant Diseases and Defenses",
    description:
      "Identify how to detect plant diseases (TMV, Rose Black Spot) in the lab and the physical/chemical barriers plants utilize.",
  },
  {
    range: { start: 5.11, end: 5.14 },
    video_url: "https://www.youtube.com/watch?v=7uK3V_4N_eE",
    title: "Cognito - Immune System, Lymphocytes & Vaccines",
    description:
      "How phagocytes, lymphocytes, antibodies, and memory cells form the human secondary immune response and immunisation loops.",
  },
  {
    range: { start: 5.15, end: 5.16 },
    video_url: "https://www.youtube.com/watch?v=ndV38T_vCms",
    title: "Cognito - Antibiotics & Clinical Drug Discovery Steps",
    description:
      "The pipeline of drug discovery: computer modeling, pre-clinical cell cultures, animal trials, and double-blind clinical trials.",
  },
  {
    range: { start: 5.17, end: 5.18 },
    video_url: "https://www.youtube.com/watch?v=j9_N_vCqP2U",
    title: "Cognito - Monoclonal Antibodies production and use",
    description:
      "Understand the fusion of hybridomas, monoclonal extraction, and applications in diagnostic pregnancy tests and targeted cancer therapy.",
  },
  {
    range: { start: 5.19, end: 5.25 },
    video_url: "https://www.youtube.com/watch?v=Yf9p8mZ7X8Q",
    title: "Cognito - Non-Communicable Diseases & Cardiovascular Health",
    description:
      "Examine lifestyle risk factors, obesity, and treatments for cardiovascular issues (stents, bypass, statins, artificial transplants).",
  },
  {
    range: { start: 6.1, end: 6.3 },
    video_url: "https://www.youtube.com/watch?v=gHWeY988S-w",
    title: "Cognito - Photosynthesis rate factors & light constraints",
    description:
      "Discover the endothermic reaction equation and limiting factors (light intensity, temperature, CO2 concentration).",
  },
  {
    range: { start: 6.4, end: 6.11 },
    video_url: "https://www.youtube.com/watch?v=Kv_0UdcrUvY",
    title: "Cognito - Root Hairs, Xylem Phloem, and Transpiration",
    description:
      "How mineral ions and water are transported. Details on xylem transpiration streams, phloem translocation, and potometers.",
  },
  {
    range: { start: 6.12, end: 6.16 },
    video_url: "https://www.youtube.com/watch?v=vS_K0m_WpL8",
    title: "Cognito - Plant Auxins, Phototropism & Gravitropism",
    description:
      "How auxins regulate cell elongation leading to phototropic bending, and industrial uses of auxins, gibberellins, and ethene.",
  },
  {
    range: { start: 7.1, end: 7.5 },
    video_url: "https://www.youtube.com/watch?v=mE9pYFzYJ2A",
    title: "Cognito - The Endocrine System, Thyroxine & Adrenaline",
    description:
      "Learn about negative feedback, glands (pituitary, adrenal, pancreas, thyroid), and target organs.",
  },
  {
    range: { start: 7.6, end: 7.8 },
    video_url: "https://www.youtube.com/watch?v=2_SjP_K3pE0",
    title: "Cognito - The Menstrual Cycle Hormones (FSH, LH, Oestrogen)",
    description:
      "Learn the cyclical changes, feedback interactions of oestrogen, progesterone, FSH, and LH in regulating ovulation.",
  },
  {
    range: { start: 7.9, end: 7.11 },
    video_url: "https://www.youtube.com/watch?v=6805H8G_sU0",
    title: "Cognito - Contraception & Reproductive Infertility IVF",
    description:
      "Evaluate mechanical, chemical, and surgical contraception, alongside fertility injections and IVF procedures.",
  },
  {
    range: { start: 7.12, end: 7.16 },
    video_url: "https://www.youtube.com/watch?v=q6e02D4xR5I",
    title: "Cognito - Homeostasis & Human Thermoregulation",
    description:
      "How the brain's hypothalamus and skin work together (sweating, shivering, vasoconstriction, vasodilation) to regulate heat.",
  },
  {
    range: { start: 7.17, end: 7.19 },
    video_url: "https://www.youtube.com/watch?v=v-Yh8Y_V604",
    title: "Cognito - Blood Glucose Regulation (Insulin & Glucagon)",
    description:
      "How the pancreas controls sugar using insulin and glucagon feedback, and managing Type 1 vs Type 2 diabetes.",
  },
  {
    range: { start: 7.2, end: 7.22 },
    video_url: "https://www.youtube.com/watch?v=gS0n8-Kk1jY",
    title: "Cognito - Kidneys, Osmoregulation & ADH permeability",
    description:
      "How the kidney nephrons filter urea, select reabsorption, and vary water recovery using ADH loops.",
  },
  {
    range: { start: 8.1, end: 8.3 },
    video_url: "https://www.youtube.com/watch?v=jhsz72_rY0A",
    title: "Cognito - Surface Area to Volume Ratio & Alveoli Exchange",
    description:
      "Learn why large organisms require specialized exchange surfaces, examining alveoli, villi, and gill structures.",
  },
  {
    range: { start: 8.4, end: 8.9 },
    video_url: "https://www.youtube.com/watch?v=T_K-A-RscsE",
    title: "Cognito - Circulatory System, Heart, Red Blood Cells & Vessels",
    description:
      "Learn about double circulation, the adaptations of arteries, veins, capillaries, red blood cells, and the mammalian heart.",
  },
  {
    range: { start: 8.1, end: 8.12 },
    video_url: "https://www.youtube.com/watch?v=e_pA8K0Gfco",
    title: "Cognito - Cellular Respiration: Aerobic vs Anaerobic",
    description:
      "Understand how glucose is oxidized to generate ATP energy with and without oxygen, and oxygen debt consequences.",
  },
  {
    range: { start: 9.1, end: 9.4 },
    video_url: "https://www.youtube.com/watch?v=Yf9p8mZ7X8Q",
    title: "Cognito - Ecosystem Dynamics, Interdependence & Competition",
    description:
      "Ecosystem interactions: communities, abiotic/biotic factors, and symbiotic relationships.",
  },
  {
    range: { start: 9.5, end: 9.5 },
    video_url: "https://www.youtube.com/watch?v=M5Yk588XgCc",
    title: "FreeScienceLessons - Quadrat and Transect Sampling",
    description:
      "Core practical guide to ecological field sampling techniques using quadrats and belt transects.",
  },
  {
    range: { start: 9.6, end: 9.7 },
    video_url: "https://www.youtube.com/watch?v=Yf7S1q0iRSw",
    title: "Cognito - Trophic Levels & Biomass Pyramids",
    description:
      "How biomass is lost between food chain stages through respiration, egestion, and metabolic heat.",
  },
  {
    range: { start: 9.8, end: 9.11 },
    video_url: "https://www.youtube.com/watch?v=v9U0_9I4K78",
    title: "Cognito - Biodiversity, Eutrophication & Conservation",
    description:
      "Examine fertilizer runoff, fish farming impact, global species introduction, and reforesting ecosystems.",
  },
  {
    range: { start: 9.12, end: 9.15 },
    video_url: "https://www.youtube.com/watch?v=Z6M67GZz_gA",
    title: "Cognito - Cycles in Nature: Carbon, Water & Nitrogen Cycle",
    description:
      "A comprehensive guide to nitrogen-fixing bacteria, decay decomposers, transpiration water loops, and photosynthesis carbon stores.",
  },
  {
    range: { start: 9.16, end: 9.19 },
    video_url: "https://www.youtube.com/watch?v=e_Z_E8qf4-M",
    title: "Cognito - Decomposition, Decay Rates, and Composting",
    description:
      "Understand the biochemical factors of decay (temperature, moisture, oxygen) and how anaerobic composting generates biogas.",
  },
];

// Map of core videos based on topic sections for OCR GCSE Biology
const OCR_VIDEO_SECTIONS = [
  {
    prefix: "1.1",
    video_url: "https://www.youtube.com/watch?v=8V-mU6OqI8M",
    title: "Cognito - Cell Structure & Microscopy Techniques",
    description:
      "Learn about the difference between eukaryotic cells (plant and animal) and prokaryotic cells (bacteria), alongside magnification calculations and staining.",
  },
  {
    prefix: "1.2",
    video_url: "https://www.youtube.com/watch?v=v3M98P1uP1c",
    title: "Cognito - DNA Structure, Genes & Protein Synthesis",
    description:
      "A deep dive into the DNA polymer, base pairing, and the transcription and translation pathways.",
  },
  {
    prefix: "1.3",
    video_url: "https://www.youtube.com/watch?v=ndV38T_vCms",
    title: "Cognito - Enzyme Action, Specificity & Denaturation",
    description:
      "Explore active site lock-and-key matching, environmental pH/temperature limits, and enzyme assays.",
  },
  {
    prefix: "1.4",
    video_url: "https://www.youtube.com/watch?v=gHWeY988S-w",
    title: "Cognito - Photosynthesis Rate & Bioenergetics",
    description:
      "Examine the light-dependent and light-independent photosynthesis requirements, and the differences in aerobic/anaerobic respiration.",
  },
  {
    prefix: "2.1",
    video_url: "https://www.youtube.com/watch?v=gwcwSZIfKlM",
    title: "Cognito - Mitosis, Cell Cycle & Differentiation",
    description:
      "Examine cell cycle checkpoints, mitotic chromosome segregation, specialized stem cells, and medical options.",
  },
  {
    prefix: "2.2",
    video_url: "https://www.youtube.com/watch?v=jhsz72_rY0A",
    title: "Cognito - Cell Transport, Red Blood Cells & Circulation",
    description:
      "Understand diffusion, active transport, root hair osmosis, red blood cell transport, heart anatomy, stomata, and xylem/phloem.",
  },
  {
    prefix: "3.1",
    video_url: "https://www.youtube.com/watch?v=tZ9S_k-81hQ",
    title: "Cognito - Central Nervous System & Brain coordination",
    description:
      "Examine the neurones, protective reflex arcs, eye structures, and difficulties of investigating brain diseases.",
  },
  {
    prefix: "3.2",
    video_url: "https://www.youtube.com/watch?v=mE9pYFzYJ2A",
    title: "Cognito - Hormones: Endocrine, Reproduction & Plant Hormones",
    description:
      "Review feedback loops, thyroxine/adrenaline, menstrual cycles, contraceptive types, IVF systems, plant phototropisms, and commercial auxins.",
  },
  {
    prefix: "3.3",
    video_url: "https://www.youtube.com/watch?v=q6e02D4xR5I",
    title: "Cognito - Homeostasis, Blood Glucose & Kidneys",
    description:
      "How organisms regulate internal temperatures. Details on blood glucose (insulin/glucagon), diabetes, and nephron water clearance (ADH).",
  },
  {
    prefix: "4.1",
    video_url: "https://www.youtube.com/watch?v=Z6M67GZz_gA",
    title: "Cognito - Ecosystem Dynamics, Biomass and Decomposition",
    description:
      "Learn about carbon, nitrogen, and water cycles, decomposition factors, food pyramids, and calculation of biomass transfer.",
  },
  {
    prefix: "5.1",
    video_url: "https://www.youtube.com/watch?v=YpBv7-c994I",
    title: "Cognito - Genetics Nomenclature & Monohybrid Punnett Squares",
    description:
      "How gametes inherit dominant/recessive alleles, predicting single gene crosses, genome studies, and meiosis cell division.",
  },
  {
    prefix: "5.2",
    video_url: "https://www.youtube.com/watch?v=cWt1bU8O5PY",
    title: "Khan Academy - Gregor Mendel & History of Genetics",
    description:
      "Mendel's historic pea plant crosses, the timeline of early inheritance models, and pedigree tracking.",
  },
  {
    prefix: "5.3",
    video_url: "https://www.youtube.com/watch?v=vVf4w7v9bZ8",
    title: "Cognito - Darwinian Evolution & Fossil Evidence",
    description:
      "How natural selection triggers phenotypic evolution, bacterial resistance markers, and fossil archaeology.",
  },
  {
    prefix: "6.1",
    video_url: "https://www.youtube.com/watch?v=Yf9p8mZ7X8Q",
    title: "Cognito - Infectious Diseases, Vaccinations & Immunology",
    description:
      "Pathogens, physical and chemical defense structures, lymphocytes, immunization strategies, and clinical trials.",
  },
  {
    prefix: "6.2",
    video_url: "https://www.youtube.com/watch?v=Yf9p8mZ7X8Q",
    title: "Cognito - Non-Communicable Diseases, Heart Diseases & Lifestyle",
    description:
      "Investigate lifestyle risk factors of cancer and heart disease, surgery options, and global food security barriers.",
  },
];

// Fallback high-quality biology playlists if no specific map is triggered
const FALLBACK_VIDEOS = [
  {
    video_url: "https://www.youtube.com/watch?v=URUJD5NEXC8",
    title: "Cognito - Cell Structure Adaptations",
    description:
      "Introduction to eukaryotic and prokaryotic cells, animal/plant specialized structures, and microscopy.",
  },
  {
    video_url: "https://www.youtube.com/watch?v=tI69At9Sgco",
    title: "Khan Academy - Biology: Enzymes & Cellular Kinetics",
    description:
      "Learn about catalysts, activation energy barrier, temperature denaturation, and enzyme-substrate kinetics.",
  },
  {
    video_url: "https://www.youtube.com/watch?v=aubZU0iWtgI",
    title: "Khan Academy - Diffusion, Osmosis & Active Cell Transport",
    description:
      "Understand the thermodynamic forces behind passive transport, osmosis of water, and selective sodium-potassium active pumps.",
  },
  {
    video_url: "https://www.youtube.com/watch?v=f-ldPgEfAHI",
    title: "Khan Academy - Cell Division: Mitosis & Chromosomes",
    description:
      "Overview of cell duplication phases, chromatid lining, spindle fibers, and cytokinesis.",
  },
];

function cleanCode(code: string): string {
  // Remove board prefixes like OCR, EDEXCEL, EDEX, AQA
  return code
    .replace(/^(OCR|EDEXCEL|EDEX|AQA)\s+/i, "")
    .trim()
    .toLowerCase();
}

/**
 * Dynamically resolves a high-quality educational video (Khan Academy, Cognito, FreeScienceLessons)
 * for a given specification point of OCR or Edexcel Biology.
 */
export function resolveEducationalVideo(
  board: string,
  subject: string,
  level: string,
  code: string,
  title: string,
): EducationalVideo {
  const normBoard = board.toLowerCase();
  const normSubject = subject.toLowerCase();
  const normLevel = level.toLowerCase();
  const rawCode = cleanCode(code);

  // Parse code into a float number if possible (e.g. "1.13B" -> 1.13, "2.10" -> 2.1)
  const numMatch = rawCode.match(/^(\d+\.\d+)/);
  const numericVal = numMatch ? parseFloat(numMatch[1]) : NaN;

  // We only target OCR and Edexcel GCSE Biology as requested
  if (normSubject === "biology" && normLevel === "gcse") {
    // 1. EDEXCEL SPEC MAPPING
    if (normBoard === "edexcel") {
      if (!isNaN(numericVal)) {
        const foundSection = EDEXCEL_VIDEO_SECTIONS.find(
          (sec) => numericVal >= sec.range.start && numericVal <= sec.range.end,
        );
        if (foundSection) {
          return {
            video_url: foundSection.video_url,
            title: `Edexcel Spec ${code.toUpperCase()}: ${foundSection.title}`,
            description: `Walkthrough for Edexcel ${title}. ${foundSection.description}`,
          };
        }
      }
    }

    // 2. OCR SPEC MAPPING (or fallback general biology)
    if (normBoard === "ocr") {
      const foundSection = OCR_VIDEO_SECTIONS.find((sec) => rawCode.startsWith(sec.prefix));
      if (foundSection) {
        return {
          video_url: foundSection.video_url,
          title: `OCR Spec ${code.toUpperCase()}: ${foundSection.title}`,
          description: `Walkthrough for OCR ${title}. ${foundSection.description}`,
        };
      }
    }
  }

  // Safe fallback to avoid any music videos across other boards/subjects
  const hash = Math.abs(code.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0));
  const fallback = FALLBACK_VIDEOS[hash % FALLBACK_VIDEOS.length];

  return {
    video_url: fallback.video_url,
    title: `${subject.toUpperCase()} ${level.toUpperCase()} Lesson: ${title}`,
    description: fallback.description,
  };
}
