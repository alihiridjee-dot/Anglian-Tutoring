export const BLUEPRINTS: Record<
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
    edexcel_biology: [
      {
        title: "Topic 1: Key concepts in biology",
        desc: "Explain how sub-cellular structures of eukaryotic and prokaryotic cells are related to their functions, specialised cell adaptations, microscopes, size/scale, enzymes, food tests, calorimetry, and transport across membranes.",
        points: [
          {
            code: "1.1",
            title: "Eukaryotic and Prokaryotic Cells",
            desc: "Explain how sub-cellular structures of eukaryotic (plant, animal) and prokaryotic (bacterial) cells are related to their functions, including organelles like mitochondria, ribosomes, chloroplasts, and plasmids.",
          },
          {
            code: "1.2",
            title: "Specialised Cell Adaptations",
            desc: "Describe how specialised cells are adapted to their function, including sperm cells (acrosome, haploid nucleus), egg cells, and ciliated epithelial cells.",
          },
          {
            code: "1.3",
            title: "Microscope Technology Evolution",
            desc: "Explain how changes in microscope technology, including electron microscopy, have enabled us to see sub-cellular structures with much greater clarity and detail.",
          },
          {
            code: "1.4",
            title: "Number, Size, and Scale",
            desc: "Demonstrate an understanding of number, size and scale, including the use of estimations and unit calculations when studying cells.",
          },
          {
            code: "1.5",
            title: "Quantitative Units in Cell Biology",
            desc: "Demonstrate an understanding of quantitative units in relation to cells: milli (10^-3), micro (10^-6), nano (10^-9), pico (10^-12), and standard form calculations.",
          },
          {
            code: "1.6",
            title: "Core Practical - Microscopy Specimen Investigation",
            desc: "Investigate biological specimens using microscopes, including magnification calculations and labelled scientific drawings from observations.",
          },
          {
            code: "1.7",
            title: "Enzyme Action & Specificity Lock-and-Key",
            desc: "Explain the mechanism of enzyme action, including active site structure and enzyme-substrate specificity.",
          },
          {
            code: "1.8",
            title: "Enzyme Denaturation",
            desc: "Explain how enzymes can be denatured due to changes in active site shape from extreme temperature or pH.",
          },
          {
            code: "1.9",
            title: "Factors Affecting Enzyme Activity",
            desc: "Explain the effects of temperature, substrate concentration, and pH on enzyme activity.",
          },
          {
            code: "1.10",
            title: "Core Practical - Effect of pH on Amylase",
            desc: "Investigate the effect of pH on enzyme activity using amylase to break down starch, monitored with iodine.",
          },
          {
            code: "1.11",
            title: "Rate Calculations for Enzymes",
            desc: "Demonstrate an understanding of rate calculations for enzyme activity using mathematical ratios or slopes.",
          },
          {
            code: "1.12",
            title: "Enzymes as Biological Catalysts",
            desc: "Explain the importance of enzymes as biological catalysts in the synthesis and breakdown of carbohydrates, proteins, and lipids.",
          },
          {
            code: "1.13B",
            title: "Core Practical - Reagents for Food Tests",
            desc: "Investigate the use of chemical reagents (iodine, Benedict's, Biuret, emulsion test) to identify starch, reducing sugars, proteins, and fats.",
          },
          {
            code: "1.14B",
            title: "Energy and Calorimetry in Food",
            desc: "Explain how the energy contained in food can be measured using calorimetry experiments.",
          },
          {
            code: "1.15",
            title: "Active, Passive & Osmotic Transport",
            desc: "Explain how substances are transported into and out of cells, including by diffusion, osmosis, and active transport.",
          },
          {
            code: "1.16",
            title: "Core Practical - Osmosis in Potatoes",
            desc: "Investigate osmosis in potatoes by measuring changes in mass in different sucrose/salt concentrations.",
          },
          {
            code: "1.17",
            title: "Percentage Gain and Loss of Mass",
            desc: "Calculate percentage gain and loss of mass in osmosis data.",
          },
        ],
      },
      {
        title: "Topic 2: Cells and control",
        desc: "Mitosis stages, the cell cycle, cancer as uncontrolled division, organism growth, cell differentiation, percentile growth charts, embryonic and adult stem cells, brain structures, CT and PET scans, sensory receptors, synapses, reflex arcs, and eye structure/defects.",
        points: [
          {
            code: "2.1",
            title: "Mitosis and the Cell Cycle",
            desc: "Describe mitosis as part of the cell cycle, including the stages of interphase, prophase, metaphase, anaphase, telophase, and cytokinesis.",
          },
          {
            code: "2.2",
            title: "Mitosis for Growth and Repair",
            desc: "Describe the importance of mitosis in growth, repair, and asexual reproduction.",
          },
          {
            code: "2.3",
            title: "Diploid Cell Division Outcome",
            desc: "Describe cell division by mitosis producing two genetically identical diploid body cells, each with identical chromosomes.",
          },
          {
            code: "2.4",
            title: "Cancer and Uncontrolled Division",
            desc: "Describe cancer as the result of changes in cells that lead to uncontrolled cell division.",
          },
          {
            code: "2.5",
            title: "Growth in Plants and Animals",
            desc: "Describe growth in organisms, including cell division/differentiation in animals and division, elongation, and differentiation in plants.",
          },
          {
            code: "2.6",
            title: "Cell Differentiation and Specialisation",
            desc: "Explain the importance of cell differentiation in the development of specialised cells.",
          },
          {
            code: "2.7",
            title: "Percentile Growth Charts",
            desc: "Demonstrate an understanding of the use of percentile charts to monitor growth in weight or height over time.",
          },
          {
            code: "2.8",
            title: "Functions of Embryonic & Adult Stem Cells",
            desc: "Describe the function of embryonic stem cells, adult stem cells in animals, and meristems in plants.",
          },
          {
            code: "2.9",
            title: "Stem Cells in Medicine Benefits and Risks",
            desc: "Discuss the potential benefits and risks associated with the clinical use of stem cells in modern medicine.",
          },
          {
            code: "2.10B",
            title: "Structures and Functions of the Brain",
            desc: "Describe the structures and functions of the brain, including the cerebellum, cerebral hemispheres, and medulla oblongata.",
          },
          {
            code: "2.11B",
            title: "Brain Imaging CT and PET Scans",
            desc: "Explain how the difficulties of accessing brain tissue inside the skull can be overcome by using CT and PET scanning to investigate function.",
          },
          {
            code: "2.12B",
            title: "Spinal & Brain Damage Treatment Limitations",
            desc: "Explain some of the limitations in treating damage and disease in the brain and nervous system, including spinal injuries and brain tumours.",
          },
          {
            code: "2.13",
            title: "Sensory Receptors and Reflex Impulses",
            desc: "Explain the structure and function of sensory receptors, sensory, relay, and motor neurones, synapses, axon, dendron, myelin sheath, and neurotransmitters.",
          },
          {
            code: "2.14",
            title: "Reflex Arc Coordination",
            desc: "Explain the structure and function of a reflex arc, including sensory, relay, and motor neurones, for automatic responses.",
          },
          {
            code: "2.15B",
            title: "Structure and Function of the Eye",
            desc: "Explain the structure and function of the eye as a sensory receptor, including the cornea, lens, iris, and rod and cone cells.",
          },
          {
            code: "2.16B",
            title: "Common Eye Defects",
            desc: "Describe defects of the eye, including cataracts, long-sightedness, short-sightedness, and colour blindness.",
          },
          {
            code: "2.17B",
            title: "Correcting Cataracts and Vision Defects",
            desc: "Explain how cataracts, long-sightedness, and short-sightedness can be corrected using lenses or surgery.",
          },
        ],
      },
      {
        title: "Topic 3: Genetics",
        desc: "Asexual vs sexual reproduction, meiotic division, DNA double helix polymer, genome definition, fruit DNA extraction, protein synthesis transcription and translation, genetic variants (coding & non-coding), Mendel's work, alleles, monohybrid crosses, sex determination, and mutations.",
        points: [
          {
            code: "3.1B",
            title: "Advantages & Disadvantages of Asexual Reproduction",
            desc: "Explain some of the advantages and disadvantages of asexual reproduction, including rapid reproduction cycles but lack of variation.",
          },
          {
            code: "3.2B",
            title: "Advantages & Disadvantages of Sexual Reproduction",
            desc: "Explain some of the advantages and disadvantages of sexual reproduction, including genetic variation but needing to find a mate.",
          },
          {
            code: "3.3",
            title: "Meiotic Division and Haploid Gametes",
            desc: "Explain the role of meiotic cell division, including the production of four genetically different haploid gametes with half the chromosomes.",
          },
          {
            code: "3.4",
            title: "DNA Double Helix Polymer Model",
            desc: "Describe DNA as a double helix polymer made of strands linked by complementary base pairs joined together by weak hydrogen bonds.",
          },
          {
            code: "3.5",
            title: "Genomes and Genes Definition",
            desc: "Describe the genome as the entire DNA of an organism, and a gene as a section of DNA that codes for a specific protein.",
          },
          {
            code: "3.6",
            title: "Extracting DNA from Fruit",
            desc: "Explain how DNA can be extracted from fruit using crushing, detergent, salt, and cold ethanol.",
          },
          {
            code: "3.7B",
            title: "Base Ordering and Protein Folding",
            desc: "Explain how the order of bases in a section of DNA decides the order of amino acids in a protein and how they fold into specific shapes.",
          },
          {
            code: "3.8B",
            title: "Stages of Protein Synthesis",
            desc: "Describe the stages of protein synthesis, including transcription (RNA polymerase binding, mRNA production) and translation (triplets/codons, tRNA transfer, polypeptide linking).",
          },
          {
            code: "3.9B",
            title: "Non-Coding DNA Variants",
            desc: "Describe how genetic variants in the non-coding DNA of a gene can affect phenotype by influencing the binding of RNA polymerase and altering protein quantity.",
          },
          {
            code: "3.10B",
            title: "Coding DNA Variants",
            desc: "Describe how genetic variants in the coding DNA of a gene can affect phenotype by altering the sequence of amino acids and enzyme activity.",
          },
          {
            code: "3.11B",
            title: "Mendel's Work on Inheritance",
            desc: "Describe the historical work of Gregor Mendel in discovering the basis of genetics and the difficulties of understanding inheritance before chromosomes.",
          },
          {
            code: "3.12",
            title: "Alleles and Inherited Differences",
            desc: "Explain why there are differences in the inherited characteristics of individuals as a result of dominant and recessive alleles.",
          },
          {
            code: "3.13",
            title: "Genetic Terms and Definitions",
            desc: "Explain genetic terminology: chromosome, gene, allele, dominant, recessive, homozygous, heterozygous, genotype, phenotype, gamete, and zygote.",
          },
          {
            code: "3.14",
            title: "Monohybrid Inheritance Pedigrees",
            desc: "Explain monohybrid inheritance using genetic diagrams, Punnett squares, and family pedigrees.",
          },
          {
            code: "3.15",
            title: "Sex Determination Crosses",
            desc: "Describe how the sex of offspring is determined at fertilisation, using genetic crosses.",
          },
          {
            code: "3.16",
            title: "Probability and Monohybrid Outcomes",
            desc: "Calculate and analyse outcomes (using probabilities, ratios and percentages) from monohybrid crosses and pedigree analysis.",
          },
          {
            code: "3.17B",
            title: "ABO Blood Group Inheritance",
            desc: "Describe the inheritance of the ABO blood groups with reference to codominance and multiple alleles.",
          },
          {
            code: "3.18B",
            title: "Sex-Linked Genetic Disorders",
            desc: "Explain how sex-linked genetic disorders, such as red-green colour blindness and haemophilia, are inherited on the X chromosome.",
          },
          {
            code: "3.19",
            title: "Polygenic Inheritance",
            desc: "State that most phenotypic features are the result of multiple genes rather than single gene inheritance.",
          },
          {
            code: "3.20",
            title: "Causes of Genetic and Environmental Variation",
            desc: "Describe the causes of variation that influence phenotype, including genetic variation (mutation, sexual reproduction) and environmental variation.",
          },
          {
            code: "3.21",
            title: "Human Genome Project Outcomes",
            desc: "Discuss the outcomes of the Human Genome Project and its potential medical applications in predictive medicine.",
          },
          {
            code: "3.22",
            title: "Genetic Variation and Mutation",
            desc: "State that there is usually extensive genetic variation within a population of a species and that these arise through mutations.",
          },
          {
            code: "3.23",
            title: "Mutation Phenotypic Outcomes",
            desc: "State that most genetic mutations have no effect on the phenotype, some have a small effect, and rarely, a single mutation will significantly affect phenotype.",
          },
        ],
      },
      {
        title: "Topic 4: Natural selection and genetic modification",
        desc: "Darwin and Wallace theories, evolution by natural selection, antibiotic resistance in bacteria, human evolution fossil evidence (Ardi, Lucy, Leakey), stone tool dating, pentadactyl limb, three domains vs five kingdoms classification, selective breeding, tissue culture, genetic engineering, Bacillus thuringiensis, and GM crops.",
        points: [
          {
            code: "4.1B",
            title: "Darwin and Wallace Evolution Theories",
            desc: "Describe the work of Charles Darwin and Alfred Wallace in the development of the theory of evolution by natural selection and its impact.",
          },
          {
            code: "4.2",
            title: "Charles Darwin's Theory of Natural Selection",
            desc: "Explain Charles Darwin's theory of evolution by natural selection: variation, competition, survival, reproduction, and inheritance.",
          },
          {
            code: "4.3",
            title: "Antibiotic Resistance in Bacteria",
            desc: "Explain how the emergence of resistant bacterial organisms supports Charles Darwin's theory of evolution.",
          },
          {
            code: "4.4",
            title: "Fossil Evidence for Human Evolution",
            desc: "Describe evidence for human evolution based on fossils, including Ardi (4.4m yrs), Lucy (3.2m yrs), and Richard Leakey's fossil discoveries (1.6m yrs).",
          },
          {
            code: "4.5",
            title: "Stone Tool Evidence and Dating",
            desc: "Describe the evidence for human evolution based on stone tools, their development over time, and how they can be dated from soil layers.",
          },
          {
            code: "4.6B",
            title: "Pentadactyl Limb Anatomy",
            desc: "Describe how the anatomy of the pentadactyl limb provides scientists with evidence for evolution and shared ancestry.",
          },
          {
            code: "4.7",
            title: "Three Domains vs Five Kingdoms",
            desc: "Describe how genetic analysis and molecular phylogenetics led to the classification of life into three domains rather than five kingdoms.",
          },
          {
            code: "4.8",
            title: "Selective Breeding and Agricultural Impact",
            desc: "Explain selective breeding of food plants and domesticated animals, and its impact on characteristics.",
          },
          {
            code: "4.9B",
            title: "Tissue Culture Process and Benefits",
            desc: "Describe the process of tissue culture and its advantages in medical research and plant breeding programmes.",
          },
          {
            code: "4.10",
            title: "Genetic Engineering and Genome Modification",
            desc: "Describe genetic engineering as a process which involves modifying the genome of an organism to introduce desirable characteristics.",
          },
          {
            code: "4.11",
            title: "Main Stages of Genetic Engineering",
            desc: "Describe the main stages of genetic engineering: restriction enzymes, ligase, sticky ends, and vectors (plasmids).",
          },
          {
            code: "4.12B",
            title: "GM Organisms and Bacillus thuringiensis",
            desc: "Explain advantages and disadvantages of genetic engineering to produce GM crop plants, including insect resistance via Bacillus thuringiensis (Bt) genes.",
          },
          {
            code: "4.13B",
            title: "Agricultural Food Solutions",
            desc: "Explain advantages and disadvantages of agricultural solutions to the demands of a growing human population, including fertilisers and biological control.",
          },
          {
            code: "4.14",
            title: "Evaluation of Genetic Modification",
            desc: "Evaluate the benefits and risks of genetic engineering and selective breeding in modern agriculture and medicine.",
          },
        ],
      },
      {
        title: "Topic 5: Health, disease and the development of medicines",
        desc: "WHO health definition, communicable vs non-communicable, disease susceptibility, pathogen types, common bacterial/viral/protist infections, lytic & lysogenic lifecycles, STIs, physical and chemical defences (plants and humans), immunisation/vaccines, herd immunity, antibiotics, aseptic techniques, agar plate investigations, drug development stages, monoclonal antibodies, non-communicable factors, BMI, and cardiovascular treatments.",
        points: [
          {
            code: "5.1",
            title: "WHO Health Definition",
            desc: "Describe health as a state of complete physical, mental and social well-being, as defined by the World Health Organization.",
          },
          {
            code: "5.2",
            title: "Communicable vs Non-Communicable",
            desc: "Describe the difference between communicable and non-communicable diseases.",
          },
          {
            code: "5.3",
            title: "Interactions Between Different Diseases",
            desc: "Explain why the presence of one disease can lead to a higher susceptibility to other diseases.",
          },
          {
            code: "5.4",
            title: "Pathogens & Infectious Agents",
            desc: "Describe a pathogen as a disease-causing organism, including viruses, bacteria, fungi and protists.",
          },
          {
            code: "5.5",
            title: "Common Human and Plant Infections",
            desc: "Describe some common infections: cholera, tuberculosis, Chalara ash dieback, malaria, HIV/AIDS, Helicobacter stomach ulcers, and Ebola.",
          },
          {
            code: "5.6",
            title: "Pathogen Spread and Prevention",
            desc: "Explain how pathogens are spread (water, air, vectors, contact, oral) and how this spread can be reduced or prevented.",
          },
          {
            code: "5.7B",
            title: "Viral Lifecycles: Lytic & Lysogenic",
            desc: "Describe the lifecycle of a virus, comparing the lytic pathway and lysogenic pathway of reproduction.",
          },
          {
            code: "5.8",
            title: "STI Transmission and Prevention",
            desc: "Explain how sexually transmitted infections (STIs), including Chlamydia and HIV, are spread and prevented.",
          },
          {
            code: "5.9B",
            title: "Physical Plant Defences",
            desc: "Describe how some plants defend themselves against attack from pests and pathogens by physical barriers, including leaf cuticle and cell wall.",
          },
          {
            code: "5.10B",
            title: "Chemical Plant Defences",
            desc: "Describe how plants defend themselves against attack by producing antimicrobial chemicals, some of which are used in medicines.",
          },
          {
            code: "5.11B",
            title: "Detecting Plant Diseases",
            desc: "Describe different ways plant diseases can be detected and identified, in the lab and in the field, including diagnostic testing.",
          },
          {
            code: "5.12",
            title: "Physical and Chemical Human Defences",
            desc: "Describe how physical barriers (skin, mucus, cilia) and chemical defences (lysozymes, hydrochloric acid) provide protection from pathogens.",
          },
          {
            code: "5.13",
            title: "Specific Human Immune Response",
            desc: "Explain the role of the specific immune system in defence, including exposure to antigens, antibody production, and memory lymphocytes.",
          },
          {
            code: "5.14",
            title: "Immunisation and Vaccines",
            desc: "Explain the body’s response to immunisation using an inactive form of a pathogen to trigger secondary immune memory.",
          },
          {
            code: "5.15B",
            title: "Herd Immunity Advantages",
            desc: "Discuss the advantages and disadvantages of immunisation, including the concept of herd immunity to protect unvaccinated individuals.",
          },
          {
            code: "5.16",
            title: "Antibiotics vs Viral Processes",
            desc: "Explain that antibiotics can only be used to treat bacterial infections because they inhibit bacterial cell processes but not viruses or host cells.",
          },
          {
            code: "5.17B",
            title: "Aseptic Laboratory Techniques",
            desc: "Explain aseptic techniques used in culturing microorganisms in the laboratory, including autoclaves, sterile loops, and petri dish lids.",
          },
          {
            code: "5.18B",
            title: "Core Practical - Effects of Antiseptics on Agar",
            desc: "Investigate the effects of antiseptics, antibiotics or plant extracts on microbial cultures using agar plates and zones of inhibition.",
          },
          {
            code: "5.19B",
            title: "Calculating Zones of Inhibition",
            desc: "Calculate cross-sectional areas of bacterial cultures and clear agar zones using the mathematical area formula πr^2.",
          },
          {
            code: "5.20",
            title: "Drug Development Stages",
            desc: "Describe the process of developing new medicines: discovery, development, preclinical testing (cells/animals), and clinical testing (healthy/sick humans).",
          },
          {
            code: "5.21B",
            title: "Production of Monoclonal Antibodies",
            desc: "Describe the production of monoclonal antibodies: using lymphocytes fused with hybridoma cells that divide rapidly.",
          },
          {
            code: "5.22B",
            title: "Monoclonal Antibody Applications",
            desc: "Explain the use of monoclonal antibodies in pregnancy testing, locating blood clots/cancer cells, and targeting cancer cells during treatment.",
          },
          {
            code: "5.23",
            title: "Multifactorial Non-Communicable Diseases",
            desc: "Describe that many non-communicable human diseases are caused by the interaction of a number of factors, including cardiovascular diseases, cancer, and liver diseases.",
          },
          {
            code: "5.24",
            title: "Lifestyle Factors on Health & BMI",
            desc: "Explain the effect of lifestyle factors (exercise, diet, alcohol, smoking) on health, calculating BMI (mass / height^2) and waist-to-hip ratios.",
          },
          {
            code: "5.25",
            title: "Cardiovascular Disease Treatments",
            desc: "Evaluate some different treatments for cardiovascular disease, including life-long medication, surgical procedures (stents, bypass), and lifestyle changes.",
          },
        ],
      },
      {
        title: "Topic 6: Plant structures and their functions",
        desc: "Photosynthesis and biomass, endothermic reaction reactants, rate limiting factors on photosynthesis, core practical on light intensity, inverse square law calculations, root hair cells, xylem and phloem, transpiration, translocation, leaf adaptations, transpiration potometer rate calculations, extremophile adaptations, plant tropisms, and commercial plant hormone uses.",
        points: [
          {
            code: "6.1",
            title: "Photosynthesis and Biomass",
            desc: "Describe photosynthetic organisms as the main producers of food and therefore biomass.",
          },
          {
            code: "6.2",
            title: "Photosynthesis Endothermic Reactants",
            desc: "Describe photosynthesis in plants and algae as an endothermic reaction using light energy to react carbon dioxide and water to produce glucose and oxygen.",
          },
          {
            code: "6.3",
            title: "Rate Limiting Factors on Photosynthesis",
            desc: "Explain the effect of temperature, light intensity and carbon dioxide concentration as limiting factors on the rate of photosynthesis.",
          },
          {
            code: "6.4",
            title: "Interacting Photosynthesis Limiting Factors",
            desc: "Explain the interactions of temperature, light intensity and carbon dioxide concentration in limiting the rate of photosynthesis.",
          },
          {
            code: "6.5",
            title: "Core Practical - Light Intensity and Algal Balls",
            desc: "Investigate the effect of light intensity on the rate of photosynthesis using algal balls in indicator solutions.",
          },
          {
            code: "6.6",
            title: "Inverse Square Law Calculation",
            desc: "Explain how the rate of photosynthesis is directly proportional to light intensity and inversely proportional to the square of the distance from light source.",
          },
          {
            code: "6.7",
            title: "Root Hair Cell Water Uptake",
            desc: "Explain how the structure of root hair cells is adapted to absorb water (by osmosis) and mineral ions (by active transport).",
          },
          {
            code: "6.8",
            title: "Xylem and Phloem Structures",
            desc: "Explain how the structures of xylem (lignified dead cells) and phloem (living cells using active transport energy) are adapted to transport water, minerals, and sucrose.",
          },
          {
            code: "6.9",
            title: "Transpiration and Stomata",
            desc: "Explain how water and mineral ions are transported through the plant by transpiration, including the structure and function of the stomata.",
          },
          {
            code: "6.10",
            title: "Translocation of Sucrose",
            desc: "Describe how sucrose is transported around the plant from source to sink by translocation in the phloem.",
          },
          {
            code: "6.11B",
            title: "Leaf Structure Adaptations",
            desc: "Explain how the structure of a leaf is adapted for photosynthesis and gas exchange (palisade mesophyll, spongy mesophyll, air spaces).",
          },
          {
            code: "6.12",
            title: "Environmental Factors on Water Uptake",
            desc: "Explain the effect of environmental factors (light intensity, air movement, temperature) on the rate of water uptake by a plant.",
          },
          {
            code: "6.13",
            title: "Transpiration Rate Calculations",
            desc: "Demonstrate an understanding of rate calculations for transpiration using potometer water movement data.",
          },
          {
            code: "6.14B",
            title: "Extremophile Plant Adaptations",
            desc: "Explain how plants are adapted to survive in extreme environments, including the effect of leaf size, thick cuticle, and rolled stomata.",
          },
          {
            code: "6.15B",
            title: "Plant Tropisms and Auxins",
            desc: "Explain how plant hormones control and coordinate plant growth, including the role of auxins in phototropisms and gravitropisms.",
          },
          {
            code: "6.16B",
            title: "Commercial Plant Hormone Uses",
            desc: "Describe the commercial uses of auxins (weedkillers, rooting powders), gibberellins (germination, seedless fruit), and ethene (fruit ripening).",
          },
        ],
      },
      {
        title: "Topic 7: Animal coordination, control and homeostasis",
        desc: "Endocrine glands, adrenal glands fight or flight, thyroxine negative feedback, menstrual cycle stages, menstrual cycle hormones, hormonal contraception, assisted reproductive technology (ART), homeostatic regulation, thermoregulation, skin hypothalamus, shivering/vasoconstriction, insulin blood glucose, glucagon glucose regulation, type 1 & type 2 diabetes cause and control, BMI/waist correlation, urinary system structure, nephron filtration, ADH collecting duct permeability, dialysis/organ donation, and urea production.",
        points: [
          {
            code: "7.1",
            title: "Endocrine Glands and Target Organs",
            desc: "Describe where hormones are produced and how they are transported from endocrine glands (pituitary, thyroid, pancreas, adrenal, ovaries, testes) to target organs.",
          },
          {
            code: "7.2",
            title: "Adrenalin & Fight-or-Flight Response",
            desc: "Explain that adrenalin is produced by the adrenal glands to prepare the body for fight or flight, increasing heart rate and blood pressure.",
          },
          {
            code: "7.3",
            title: "Thyroxine and Negative Feedback",
            desc: "Explain how thyroxine controls metabolic rate as an example of negative feedback, involving TRH and TSH.",
          },
          {
            code: "7.4",
            title: "Menstrual Cycle Stages",
            desc: "Describe the stages of the menstrual cycle, including the roles of the hormones oestrogen and progesterone.",
          },
          {
            code: "7.5",
            title: "Oestrogen, Progesterone, FSH and LH",
            desc: "Explain the interactions of oestrogen, progesterone, FSH and LH in the control of the menstrual cycle and ovulation.",
          },
          {
            code: "7.6",
            title: "Hormonal Contraception",
            desc: "Explain how hormonal contraception influences the menstrual cycle and prevents pregnancy by suppressing ovulation.",
          },
          {
            code: "7.7",
            title: "Barrier vs Hormonal Contraception Evaluation",
            desc: "Evaluate hormonal and barrier methods of contraception in terms of safety, reliability, and ethics.",
          },
          {
            code: "7.8",
            title: "Infertility Treatments and ART",
            desc: "Explain the use of hormones in Assisted Reproductive Technology (ART) including IVF and clomifene therapy.",
          },
          {
            code: "7.9",
            title: "Constant Internal Environment Importance",
            desc: "Explain the importance of maintaining a constant internal environment in response to internal and external change (homeostasis).",
          },
          {
            code: "7.10B",
            title: "Thermoregulation and Osmoregulation",
            desc: "Explain the importance of homeostasis, including thermoregulation (effects on enzyme activity) and osmoregulation (effects on animal cells).",
          },
          {
            code: "7.11B",
            title: "Dermis and Hypothalamus Function",
            desc: "Explain how thermoregulation takes place, with reference to the function of the skin (dermis, epidermis) and the hypothalamus.",
          },
          {
            code: "7.12B",
            title: "Shivering, Vasoconstriction and Vasodilation",
            desc: "Explain how thermoregulation takes place, with reference to shivering, vasoconstriction, and vasodilation.",
          },
          {
            code: "7.13",
            title: "Insulin and Glucose Concentration",
            desc: "Explain how the hormone insulin controls blood glucose concentration when levels are high.",
          },
          {
            code: "7.14",
            title: "Glucagon and Glucose Regulation",
            desc: "Explain how blood glucose concentration is regulated by glucagon when levels are low.",
          },
          {
            code: "7.15",
            title: "Type 1 Diabetes Cause and Control",
            desc: "Explain the cause of type 1 diabetes (insulin deficiency) and how it is controlled using insulin injections.",
          },
          {
            code: "7.16",
            title: "Type 2 Diabetes Cause and Control",
            desc: "Explain the cause of type 2 diabetes (insulin resistance) and how it is controlled using diet, exercise, or medication.",
          },
          {
            code: "7.17",
            title: "BMI and Waist-to-Hip Ratio Correlation",
            desc: "Evaluate the correlation between body mass and type 2 diabetes, calculating BMI and waist:hip ratios to assess risks.",
          },
          {
            code: "7.18B",
            title: "Structure of the Urinary System",
            desc: "Describe the structure of the urinary system, including kidneys, ureters, bladder, and urethra.",
          },
          {
            code: "7.19B",
            title: "Nephron Structure and Filtration",
            desc: "Explain how the structure of the nephron is related to its function in filtering blood: filtration in the glomerulus/Bowman's capsule, selective reabsorption of glucose, and reabsorption of water.",
          },
          {
            code: "7.20B",
            title: "ADH and Collecting Duct Permeability",
            desc: "Explain the effect of ADH on the permeability of the collecting duct in regulating the water content of the blood (negative feedback).",
          },
          {
            code: "7.21B",
            title: "Dialysis and Organ Donation Treatments",
            desc: "Describe the treatments for kidney failure, including kidney dialysis and organ donation.",
          },
          {
            code: "7.22B",
            title: "Urea Production from Amino Acids",
            desc: "State that urea is produced from the breakdown of excess amino acids in the liver.",
          },
        ],
      },
      {
        title: "Topic 8: Exchange and transport in animals",
        desc: "Transport of respiratory substances, exchange surfaces and SA:V ratios, alveoli adaptations, rate of diffusion factors, Fick's law, blood components, blood vessels, heart and circulatory system adaptations, exothermic respiration, comparing aerobic/anaerobic respiration, core practical on respirometers, and heart rate/cardiac output calculations.",
        points: [
          {
            code: "8.1",
            title: "Transport of Respiratory Substances",
            desc: "Describe the need to transport substances into and out of a range of organisms, including oxygen, carbon dioxide, water, dissolved food molecules, mineral ions and urea.",
          },
          {
            code: "8.2",
            title: "Exchange Surface Adaptations and SA:V",
            desc: "Explain the need for exchange surfaces and a transport system in multicellular organisms, including the calculation of surface area : volume ratio.",
          },
          {
            code: "8.3",
            title: "Alveoli Adaptations for Diffusion",
            desc: "Explain how alveoli are adapted for gas exchange by diffusion between air in the lungs and blood in capillaries (large surface area, thin walls).",
          },
          {
            code: "8.4B",
            title: "Factors Affecting Rate of Diffusion",
            desc: "Describe the factors affecting the rate of diffusion, including surface area, concentration gradient and diffusion distance.",
          },
          {
            code: "8.5B",
            title: "Fick's Law of Diffusion",
            desc: "Calculate the rate of diffusion using Fick’s law: rate of diffusion is proportional to (surface area x concentration difference) / thickness of membrane.",
          },
          {
            code: "8.6",
            title: "Blood Cellular Components Structure",
            desc: "Explain how the structure of the blood is related to its function: red blood cells (erythrocytes), white blood cells (phagocytes, lymphocytes), plasma, and platelets.",
          },
          {
            code: "8.7",
            title: "Blood Vessel Adaptations",
            desc: "Explain how the structure of arteries, veins, and capillaries are related to their function.",
          },
          {
            code: "8.8",
            title: "Heart and Circulatory Adaptations",
            desc: "Explain how the structure of the heart and circulatory system is related to its function, including the role of major blood vessels, valves, and wall thickness.",
          },
          {
            code: "8.9",
            title: "Exothermic Respiration & Cellular energy",
            desc: "Describe cellular respiration as an exothermic reaction which occurs continuously in living cells to release energy for metabolic processes.",
          },
          {
            code: "8.10",
            title: "Comparing Aerobic & Anaerobic respiration",
            desc: "Compare the process of aerobic respiration with the process of anaerobic respiration in terms of reactants, products, and energy yields.",
          },
          {
            code: "8.11",
            title: "Core Practical - Respirometer Investigation",
            desc: "Investigate the rate of respiration in living organisms (using a simple respirometer containing soda lime and small organisms).",
          },
          {
            code: "8.12",
            title: "Heart Rate and Cardiac Output",
            desc: "Calculate heart rate, stroke volume and cardiac output, using the equation: cardiac output = stroke volume × heart rate.",
          },
        ],
      },
      {
        title: "Topic 9: Ecosystems and material cycles",
        desc: "Organisation levels in ecosystems, abiotic/biotic community factors, interdependence, parasitism/mutualism, core practical on belt transects and quadrats, determining abundance, trophic levels, energy transfer efficiency, human impacts on biodiversity, conservation/reforestation, food security factors, cycling of materials, carbon cycle, water cycle, nitrogen cycle/nitrates, evaluation of indicator species, and decomposition in food/compost.",
        points: [
          {
            code: "9.1",
            title: "Organisation Levels in Ecosystems",
            desc: "Describe the different levels of organisation from individual organisms, populations, communities, to the whole ecosystem.",
          },
          {
            code: "9.2",
            title: "Abiotic and Biotic Community Factors",
            desc: "Explain how communities can be affected by abiotic (temperature, light, water, pollutants) and biotic (competition, predation) factors.",
          },
          {
            code: "9.3",
            title: "Interdependence in communities",
            desc: "Describe the importance of interdependence in a community for survival and species stability.",
          },
          {
            code: "9.4",
            title: "Parasitism and Mutualism Relationships",
            desc: "Describe how the survival of some organisms is dependent on other species, including parasitism and mutualism.",
          },
          {
            code: "9.5",
            title: "Core Practical - Belt Transects and Quadrats",
            desc: "Investigate the relationship between organisms and their environment using field-work techniques, including quadrats and belt transects.",
          },
          {
            code: "9.6",
            title: "Determining Abundance from Raw Data",
            desc: "Explain how to determine the number of organisms in a given area using raw data from field-work techniques, including quadrats and belt transects.",
          },
          {
            code: "9.7B",
            title: "Trophic Levels & Biomass Pyramids",
            desc: "Explain how some energy is transferred to less useful forms at each trophic level, limiting food chain length and determining biomass pyramid shapes.",
          },
          {
            code: "9.8B",
            title: "Energy Transfer Efficiency calculations",
            desc: "Calculate the efficiency of energy transfers between trophic levels and percentage calculations of biomass.",
          },
          {
            code: "9.9",
            title: "Human Impacts on Biodiversity",
            desc: "Explain the positive and negative human interactions within ecosystems and their impacts on biodiversity, including fish farming, non-indigenous species, and eutrophication.",
          },
          {
            code: "9.10",
            title: "Conservation and Reforestation",
            desc: "Explain the benefits of maintaining local and global biodiversity, including the conservation of animal species and the impact of reforestation.",
          },
          {
            code: "9.11B",
            title: "Food Security and Sustainability",
            desc: "Describe the biological factors affecting levels of food security (increasing population, animal farming, new pests/pathogens, climate change, sustainability).",
          },
          {
            code: "9.12",
            title: "Cycling of Materials through Abiotic Components",
            desc: "Describe how different materials cycle through the abiotic and biotic components of an ecosystem.",
          },
          {
            code: "9.13",
            title: "Carbon Cycle and Decomposers",
            desc: "Explain the importance of the carbon cycle, including the processes involved and the role of microorganisms as decomposers.",
          },
          {
            code: "9.14",
            title: "Water Cycle and Potable Desalination",
            desc: "Explain the importance of the water cycle, including the processes involved and the production of potable water in areas of drought including desalination.",
          },
          {
            code: "9.15",
            title: "Nitrates and Nitrogen Cycle",
            desc: "Explain how nitrates are made available for plant uptake, including the use of fertilisers, crop rotation and the role of bacteria in the nitrogen cycle.",
          },
          {
            code: "9.16B",
            title: "Indicator Species and Pollution levels",
            desc: "Evaluate the use of indicator species as evidence to assess the level of pollution (bloodworm/sludgeworm, freshwater shrimps/stonefly, lichens/blackspot fungus).",
          },
          {
            code: "9.17B",
            title: "Decomposition in Food Preservation",
            desc: "Explain the effects of temperature, water content and oxygen availability on the rate of decomposition in food preservation.",
          },
          {
            code: "9.18B",
            title: "Decomposition in Composting",
            desc: "Explain the effects of temperature, water content and oxygen availability on the rate of decomposition in composting.",
          },
          {
            code: "9.19B",
            title: "Rate Changes in Material Decay",
            desc: "Calculate rate changes in the decay of biological material over time.",
          },
        ],
      },
    ],
    biology: [
      {
        title: "B1: Cell Level Systems",
        desc: "Cell structures, eukaryotic and prokaryotic organelles, microscopy techniques, DNA polymer and double helix model, protein synthesis, enzymatic mechanisms, and bioenergetics of cellular respiration and photosynthesis.",
        points: [
          {
            code: "1.1a",
            title: "Microscopy and Light Imaging",
            desc: "Describe how light microscopes and staining can be used to view colourless specimens and calculate magnification equations (image size / actual size).",
          },
          {
            code: "1.1b",
            title: "Eukaryotic and Prokaryotic Structures",
            desc: "Explain how main sub-cellular structures (nucleus, mitochondria, chloroplasts, cell membranes, plasmids, ribosomes) relate to their functions.",
          },
          {
            code: "1.1c",
            title: "Electron Microscopy Resolution",
            desc: "Explain how electron microscopy has increased our understanding of sub-cellular structures via significantly increased resolution and magnification.",
          },
          {
            code: "1.2a",
            title: "DNA as a Polymer",
            desc: "Describe DNA as a biological polymer made of repeating nucleotides.",
          },
          {
            code: "1.2b",
            title: "Double Helix Structure",
            desc: "Describe DNA as being made up of two complementary strands forming a double helix shape.",
          },
          {
            code: "1.2c",
            title: "Nucleotides and Complementary Bases",
            desc: "Describe that DNA is made from four different nucleotides; each consisting of a common sugar and phosphate group with one of four bases (A-T and G-C).",
          },
          {
            code: "1.2d",
            title: "Protein Synthesis: Transcription & Translation",
            desc: "Recall a simple description of protein synthesis: unzipping the DNA molecule around the gene, copying to mRNA in nucleus, and translating sequence in cytoplasm using tRNA.",
          },
          {
            code: "1.2e",
            title: "Triplet Genetic Code",
            desc: "Explain simply how the triplet code of DNA determines amino acid order in a protein.",
          },
          {
            code: "1.2f",
            title: "Enzyme Experiments",
            desc: "Describe experiments that can be used to investigate enzymatic reactions and rates.",
          },
          {
            code: "1.2g",
            title: "Mechanism of Enzyme Action",
            desc: "Explain the active site specificity lock and key model, and factors affecting rates of reaction (pH, temperature, substrate/enzyme concentration).",
          },
          {
            code: "1.3a",
            title: "Cellular Respiration as Universal ATP Source",
            desc: "Describe cellular respiration as a universal chemical process continuously occurring to supply ATP in all living cells.",
          },
          {
            code: "1.3b",
            title: "Exothermic Nature of Respiration",
            desc: "Describe cellular respiration as an exothermic reaction releasing heat energy.",
          },
          {
            code: "1.3c",
            title: "Aerobic vs Anaerobic Comparison",
            desc: "Compare the conditions, substrates, products, and relative yields of ATP for aerobic and anaerobic respiration in plants/fungi and animals.",
          },
          {
            code: "1.3d",
            title: "Sugar Synthesis and Polymers",
            desc: "Explain the importance of sugars in the synthesis and breakdown of carbohydrates using the terms monomer and polymer.",
          },
          {
            code: "1.3e",
            title: "Amino Acid Synthesis and Proteins",
            desc: "Explain the importance of amino acids in the synthesis and breakdown of proteins using the terms monomer and polymer.",
          },
          {
            code: "1.3f",
            title: "Lipid Synthesis and breakdown",
            desc: "Explain the importance of fatty acids and glycerol in the synthesis and breakdown of lipids.",
          },
          {
            code: "1.4a",
            title: "Photosynthetic Organisms as Biomass Producers",
            desc: "Describe photosynthetic organisms as the main producers of food and therefore biomass for life on Earth.",
          },
          {
            code: "1.4b",
            title: "Process of Photosynthesis",
            desc: "Describe the reactants, products, location in chloroplasts, and two-stage process of photosynthesis.",
          },
          {
            code: "1.4c",
            title: "Endothermic Nature of Photosynthesis",
            desc: "Describe photosynthesis as an endothermic reaction absorbing light energy.",
          },
          {
            code: "1.4d",
            title: "Photosynthesis Experiments",
            desc: "Describe experiments to investigate photosynthesis and rate limiting factors.",
          },
          {
            code: "1.4e",
            title: "Factors Affecting Photosynthetic Rates",
            desc: "Explain the effect of temperature, light intensity, and carbon dioxide concentration on the rate of photosynthesis.",
          },
          {
            code: "1.4f",
            title: "Limiting Factors Interactions",
            desc: "Explain the interaction of temperature, light intensity, and carbon dioxide concentration in limiting the rate of photosynthesis.",
          },
        ],
      },
      {
        title: "B2: Scaling Up",
        desc: "Transport mechanisms (diffusion, osmosis, active transport), cell cycle and mitosis, stem cells and differentiation, surface area to volume ratio, human circulatory system, heart structure, plant transpiration and translocation.",
        points: [
          {
            code: "2.1a",
            title: "Substance Transport across Membranes",
            desc: "Explain how substances are transported into and out of cells through diffusion, osmosis, and active transport (including the term water potential).",
          },
          {
            code: "2.1b",
            title: "Mitosis and the Cell Cycle",
            desc: "Describe the process of mitosis in growth, including stages of the cell cycle: growth, DNA replication, and chromosome movement.",
          },
          {
            code: "2.1c",
            title: "Cell Differentiation & Specialisation",
            desc: "Explain the importance of cell differentiation in producing specialised cells that allow multicellular organisms to function efficiently.",
          },
          {
            code: "2.1d",
            title: "Stem Cell Sources",
            desc: "Recall that stem cells are present in embryonic and adult animals, and meristems in plants.",
          },
          {
            code: "2.1e",
            title: "Functions of Stem Cells",
            desc: "Describe the functions of stem cells in division to produce a range of different cell types for development, growth, and repair.",
          },
          {
            code: "2.1f",
            title: "Embryonic vs Adult Stem Cells",
            desc: "Describe the difference between embryonic and adult stem cells in animals.",
          },
          {
            code: "2.2a",
            title: "Surface Area to Volume Ratio (SA:V)",
            desc: "Explain the need for exchange surfaces and a transport system in multicellular organisms in terms of SA:V ratio and diffusion distances.",
          },
          {
            code: "2.2b",
            title: "Transported Substances",
            desc: "Describe some of the substances transported into and out of organisms (oxygen, carbon dioxide, water, dissolved food molecules, mineral ions, and urea).",
          },
          {
            code: "2.2c",
            title: "Human Circulatory System",
            desc: "Describe the human circulatory system, its relationship with the gaseous exchange system, and the need for double circulation in mammals.",
          },
          {
            code: "2.2d",
            title: "Heart and Blood Vessel Adaptations",
            desc: "Explain how the structure of the mammalian heart (cardiac muscle, valves, chambers) and blood vessels (arteries, veins, capillaries) are adapted to their functions.",
          },
          {
            code: "2.2e",
            title: "Red Blood Cell and Plasma Adaptations",
            desc: "Explain how red blood cells and plasma are adapted to their transport functions in the blood.",
          },
          {
            code: "2.2f",
            title: "Plant Water and Mineral Uptake",
            desc: "Explain how water and mineral ions are taken up by plants, relating the structure of root hair cells to their function.",
          },
          {
            code: "2.2g",
            title: "Transpiration and Translocation",
            desc: "Describe the processes of transpiration and translocation, including the structure and function of stomata.",
          },
          {
            code: "2.2h",
            title: "Xylem and Phloem Adaptations",
            desc: "Explain how the structure of the xylem and phloem are adapted to their functions in the plant.",
          },
          {
            code: "2.2i",
            title: "Factors Affecting Water Uptake",
            desc: "Explain the effect of a variety of environmental factors (light intensity, air movement, and temperature) on the rate of water uptake by a plant.",
          },
          {
            code: "2.2j",
            title: "Potometer Investigations",
            desc: "Describe how a simple potometer can be used to investigate factors that affect the rate of water uptake.",
          },
        ],
      },
      {
        title: "B3: Organism Level Systems",
        desc: "Human nervous coordination, reflex arc, eye structures and defects, brain structure, principles of endocrine hormone regulation, thyroxine and adrenaline feedback loops, insulin and diabetes, kidney water balance.",
        points: [
          {
            code: "3.1a",
            title: "Structure of the Nervous System",
            desc: "Describe the structure of the nervous system (Central Nervous System, sensory/motor/relay neurones, sensory receptors, synapses, and effectors).",
          },
          {
            code: "3.1b",
            title: "Nervous Coordination and Response",
            desc: "Explain how components of the nervous system produce a coordinated response, passing signals across parts of the body.",
          },
          {
            code: "3.1c",
            title: "Reflex Arc Function",
            desc: "Explain how the structure of a reflex arc (stimulus, receptor, neurones, effector) is related to its rapid protective function.",
          },
          {
            code: "3.1d",
            title: "Structures of the Eye",
            desc: "Explain how the main structures of the eye (cornea, iris, pupil, lens, retina, optic nerve, ciliary body, suspensory ligaments) relate to their functions.",
          },
          {
            code: "3.1e",
            title: "Common Eye Defects",
            desc: "Describe common defects of the eye (colour blindness, short-sightedness, and long-sightedness) and explain how they can be overcome.",
          },
          {
            code: "3.1f",
            title: "Structure and Function of the Brain",
            desc: "Describe the structure and function of key brain regions: cerebrum, cerebellum, medulla, hypothalamus, and pituitary gland.",
          },
          {
            code: "3.1g",
            title: "Brain Investigation Challenges",
            desc: "Explain some of the difficulties of investigating brain function, including ethical issues and case study interpretation.",
          },
          {
            code: "3.1h",
            title: "Limitations of Nervous Treatments",
            desc: "Explain limitations in treating damage and disease in the brain and other parts of the nervous system (limited repair, irreversible damage).",
          },
          {
            code: "3.2a",
            title: "Principles of Endocrine Coordination",
            desc: "Describe the principles of hormonal coordination and control by the human endocrine system (chemical messengers, blood transport, glands, receptors).",
          },
          {
            code: "3.2b",
            title: "Thyroxine and Adrenaline",
            desc: "Explain the roles of thyroxine (as an example of negative feedback) and adrenaline in the body's response.",
          },
          {
            code: "3.2c",
            title: "Hormones in Human Reproduction",
            desc: "Describe the role of hormones (oestrogen, progesterone, FSH, LH, and testosterone) in human reproduction, including control of the menstrual cycle.",
          },
          {
            code: "3.2d",
            title: "Menstrual Cycle Interactions",
            desc: "Explain the interactions of FSH, LH, oestrogen, and progesterone in the control of the menstrual cycle.",
          },
          {
            code: "3.2e",
            title: "Use of Hormones in Contraception",
            desc: "Explain the use of hormones in contraception, and evaluate hormonal and non-hormonal methods of contraception.",
          },
          {
            code: "3.2f",
            title: "Reproductive Infertility Technologies",
            desc: "Explain the use of hormones in modern reproductive technologies to treat infertility (such as IVF and follicle stimulation).",
          },
          {
            code: "3.2g",
            title: "Plant Auxins & Tropisms",
            desc: "Explain how plant hormones are important in phototropisms and gravitropisms via unequal distribution of auxin.",
          },
          {
            code: "3.2h",
            title: "Auxins, Gibberellins, and Ethene",
            desc: "Describe some of the variety of effects of plant hormones, relating to auxins, gibberellins, and ethene (growth, germination, ripening, leaf shed).",
          },
          {
            code: "3.2i",
            title: "Commercial Use of Plant Hormones",
            desc: "Describe some of the different ways in which people use plant hormones to control plant growth (herbicides, rooting powders, seedless fruit).",
          },
          {
            code: "3.3a",
            title: "Importance of Homeostasis",
            desc: "Explain the importance of maintaining a constant internal environment in response to internal and external changes.",
          },
          {
            code: "3.3b",
            title: "Skin and Thermoregulation",
            desc: "Describe the function of the skin in the control of body temperature (sweating, shivering, vasoconstriction, vasodilation, blood flow).",
          },
          {
            code: "3.3c",
            title: "Insulin Regulation of Blood Glucose",
            desc: "Explain how insulin controls blood sugar levels in the body by promoting glucose absorption.",
          },
          {
            code: "3.3d",
            title: "Glucagon and Insulin Interactions",
            desc: "Explain how glucagon interacts with insulin to control blood sugar levels in the body via homeostatic feedback loops.",
          },
          {
            code: "3.3e",
            title: "Type 1 vs Type 2 Diabetes",
            desc: "Compare type 1 and type 2 diabetes, explaining causes, characteristics, and treatment options.",
          },
          {
            code: "3.3f",
            title: "Osmotic Changes in Body Fluids",
            desc: "Explain the effect on animal cells of osmotic changes in body fluids (lysis, shrinking, turgor).",
          },
          {
            code: "3.3g",
            title: "Kidneys and Water Balance",
            desc: "Describe the function of the kidneys in maintaining the water balance of the body by varying urine amount and concentration.",
          },
          {
            code: "3.3h",
            title: "Structure of Kidney Tubules",
            desc: "Describe the gross structure of the kidney and the structure of the kidney tubule (Bowman’s capsule, proximal convoluted tubule, loop of Henle, collecting duct).",
          },
          {
            code: "3.3i",
            title: "ADH Permeability Feedback",
            desc: "Describe the effect of ADH on the permeability of the kidney tubules and negative feedback regulation of water absorption.",
          },
          {
            code: "3.3j",
            title: "Osmotic and Temperature Challenges",
            desc: "Explain the response of the body to different temperature and osmotic challenges (dehydration, excess water/salt intake).",
          },
        ],
      },
      {
        title: "B4: Community Level Systems",
        desc: "Ecosystems dynamics, material cycles (carbon, nitrogen, water), factors affecting decomposition, trophic levels, pyramids of biomass, and efficiency of biomass transfer.",
        points: [
          {
            code: "4.1a",
            title: "Abiotic and Biotic Cycles",
            desc: "Recall that many different materials cycle through the abiotic and biotic components of an ecosystem (e.g., carbon and nitrogen).",
          },
          {
            code: "4.1b",
            title: "Microorganisms and Decomposition",
            desc: "Explain the role of microorganisms in the cycling of materials through an ecosystem.",
          },
          {
            code: "4.1c",
            title: "Carbon and Water Cycles",
            desc: "Explain the importance of the carbon cycle and the water cycle to living organisms.",
          },
          {
            code: "4.1d",
            title: "Factors Affecting Decomposition",
            desc: "Explain the effect of factors such as temperature, water content, and oxygen availability on the rate of decomposition (aerobic and anaerobic).",
          },
          {
            code: "4.1e",
            title: "Ecosystem Organisation Levels",
            desc: "Describe different levels of organisation in an ecosystem from individual organisms to populations, communities, and the whole ecosystem.",
          },
          {
            code: "4.1f",
            title: "Abiotic and Biotic Factors on Communities",
            desc: "Explain how abiotic and biotic factors (temperature, light intensity, moisture, pH, predators, food) can affect communities.",
          },
          {
            code: "4.1g",
            title: "Interdependence and Competition",
            desc: "Describe the importance of interdependence and competition in a community relating to predation, mutualism, and parasitism.",
          },
          {
            code: "4.1h",
            title: "Trophic Levels Differences",
            desc: "Describe the differences between the trophic levels of organisms within an ecosystem (producers, consumers).",
          },
          {
            code: "4.1i",
            title: "Pyramids of Biomass",
            desc: "Describe pyramids of biomass and explain, with examples, how biomass is lost between different trophic levels (egestion, excretion, respiration).",
          },
          {
            code: "4.1j",
            title: "Biomass Transfer Efficiency",
            desc: "Calculate the efficiency of biomass transfers between trophic levels and explain how this affects the number of trophic levels in a food chain.",
          },
        ],
      },
      {
        title: "B5: Genes, Inheritance and Selection",
        desc: "Genetic nomenclature, genome definition, continuous and discontinuous variation, mutations, asexual vs sexual reproduction, meiotic cell division, Punnett squares, single gene crosses, Mendel's work, natural selection, evidence of evolution, and classification systems.",
        points: [
          {
            code: "5.1a",
            title: "Genetic Terminology Nomenclature",
            desc: "Explain genetic terms: gamete, chromosome, gene, allele/variant, dominant, recessive, homozygous, heterozygous, genotype, and phenotype.",
          },
          {
            code: "5.1b",
            title: "Genome Definition",
            desc: "Describe the genome as the entire genetic material of an organism.",
          },
          {
            code: "5.1c",
            title: "Genome-Environment Interaction",
            desc: "Describe that the genome and its interaction with the environment influence development of phenotype (discontinuous vs continuous variation).",
          },
          {
            code: "5.1d",
            title: "Mutations and Phenotypic Impact",
            desc: "Recall that all variants arise from mutations, and that most have no effect, some influence, and very few determine phenotype.",
          },
          {
            code: "5.1e",
            title: "Coding and Non-Coding Variants",
            desc: "Describe how genetic variants may influence phenotype in coding DNA (altering enzyme active sites) and non-coding DNA (altering gene expression).",
          },
          {
            code: "5.1f",
            title: "Reproduction Advantages & Disadvantages",
            desc: "Explain some of the advantages and disadvantages of asexual and sexual reproduction in a range of organisms.",
          },
          {
            code: "5.1g",
            title: "Haploid and Diploid Terms",
            desc: "Explain the terms haploid (single set of chromosomes) and diploid (double set).",
          },
          {
            code: "5.1h",
            title: "Meiotic Cell Division",
            desc: "Explain the role of meiotic cell division in halving the chromosome number to form gametes, maintaining diploid cells when gametes combine, acting as a source of genetic variation.",
          },
          {
            code: "5.1i",
            title: "Single Gene Inheritance",
            desc: "Explain single gene inheritance in the context of homozygous and heterozygous crosses involving dominant and recessive genes.",
          },
          {
            code: "5.1j",
            title: "Predicting Cross Outcomes",
            desc: "Predict the results of single gene crosses using Punnett squares, evaluating probability ratios.",
          },
          {
            code: "5.1k",
            title: "Human Sex Determination",
            desc: "Describe sex determination in humans using a genetic cross diagram (XX vs XY).",
          },
          {
            code: "5.1l",
            title: "Polygenic Phenotypic Features",
            desc: "Recall that most phenotypic features are the result of multiple genes rather than single gene inheritance.",
          },
          {
            code: "5.1m",
            title: "Development of Genetics (Mendel)",
            desc: "Describe the development of our understanding of genetics with reference to the historical work of Mendel.",
          },
          {
            code: "5.2a",
            title: "Genetic Variation in Populations",
            desc: "State that there is usually extensive genetic variation within a population of a species.",
          },
          {
            code: "5.2b",
            title: "Developments in Classification Systems",
            desc: "Describe the impact of developments in biology on classification systems (natural, artificial, and molecular phylogenetics based on DNA sequencing).",
          },
          {
            code: "5.2c",
            title: "Evolution via Natural Selection",
            desc: "Explain how evolution occurs through the natural selection of variants that have given rise to phenotypes best suited to their environment.",
          },
          {
            code: "5.2d",
            title: "Speciation and Population Shift",
            desc: "Describe evolution as a change in inherited characteristics of a population over time, which may result in speciation.",
          },
          {
            code: "5.2e",
            title: "Evidence for Evolution",
            desc: "Describe the evidence for evolution, including fossils and antibiotic resistance in bacteria.",
          },
          {
            code: "5.2f",
            title: "Darwin and Wallace Theories",
            desc: "Describe the work of Darwin and Wallace in the development of the theory of evolution, and explain the impact on modern biology (such as seedbanks).",
          },
        ],
      },
      {
        title: "B6: Global Challenges",
        desc: "Field investigations and ecological sampling, human impact on biodiversity, food security factors, agricultural and biotechnological solutions, genetic engineering steps, relationship between health and disease, spread of communicable pathogens, white blood cell immune defenses, monoclonal antibody production and uses, vaccine development, aseptic techniques, cardiovascular diseases, cancer, and genomics.",
        points: [
          {
            code: "6.1a",
            title: "Field Investigation and Sampling",
            desc: "Explain how to carry out a field investigation into the distribution and abundance of organisms in a habitat (random/transects, capture-recapture, quadrats, pooters).",
          },
          {
            code: "6.1b",
            title: "Human Impact on Biodiversity",
            desc: "Describe both positive and negative human interactions within ecosystems and explain their impact on biodiversity.",
          },
          {
            code: "6.1c",
            title: "Maintaining Local and Global Biodiversity",
            desc: "Explain some of the benefits and challenges of maintaining local and global biodiversity (conservation schemes, ecotourism).",
          },
          {
            code: "6.1d",
            title: "Environmental Changes Distribution",
            desc: "Evaluate the evidence for the impact of environmental changes on the distribution of organisms (water, atmospheric gases).",
          },
          {
            code: "6.2a",
            title: "Biological Food Security Factors",
            desc: "Describe some of the biological factors affecting levels of food security (population, changing diets, pests/pathogens, climate change).",
          },
          {
            code: "6.2b",
            title: "Agricultural Solutions",
            desc: "Describe and explain possible agricultural solutions (hydroponics, biological control, gene technology, fertilisers, pesticides).",
          },
          {
            code: "6.2c",
            title: "Selective Breeding Impact",
            desc: "Explain the impact of the selective breeding of food plants and domesticated animals.",
          },
          {
            code: "6.2d",
            title: "Genetic Engineering Definition",
            desc: "Describe genetic engineering as a process which involves modifying the genome of an organism to introduce desirable characteristics.",
          },
          {
            code: "6.2e",
            title: "Steps in Genetic Engineering",
            desc: "Describe the main steps in the process of genetic engineering (restriction enzymes, sticky ends, ligase, host bacteria, antibiotic selection markers, plasmids).",
          },
          {
            code: "6.2f",
            title: "Benefits and Risks of Gene Technology",
            desc: "Explain some of the possible benefits and risks of using gene technology in modern agriculture.",
          },
          {
            code: "6.2g",
            title: "Biotechnological Solutions",
            desc: "Describe and explain some possible biotechnological solutions to the demands of the growing human population (genetic modification).",
          },
          {
            code: "6.3a",
            title: "Health and Disease Relationship",
            desc: "Describe the relationship between health and disease.",
          },
          {
            code: "6.3b",
            title: "Communicable vs Non-Communicable Diseases",
            desc: "Describe different types of diseases: communicable and non-communicable diseases.",
          },
          {
            code: "6.3c",
            title: "Interactions Between Different Diseases",
            desc: "Describe the interactions between different types of disease (such as HIV and tuberculosis; HPV and cervical cancer).",
          },
          {
            code: "6.3d",
            title: "Spread of Communicable Pathogens",
            desc: "Explain how communicable diseases (caused by viruses, bacteria, protists, and fungi) are spread in animals and plants.",
          },
          {
            code: "6.3e",
            title: "Preventing Disease Transmission",
            desc: "Explain how the spread of communicable diseases may be reduced or prevented in animals and plants (antigen detection, DNA testing).",
          },
          {
            code: "6.3f",
            title: "Common Infections examples",
            desc: "Describe a minimum of one common human infection, one plant disease, and STIs including HIV/AIDS, TMV, barley powdery mildew, and crown gall.",
          },
          {
            code: "6.3g",
            title: "Physical Plant Defences",
            desc: "Describe physical plant defence responses to disease (leaf cuticle, cell wall).",
          },
          {
            code: "6.3h",
            title: "Chemical Plant Defences",
            desc: "Describe chemical plant defence responses (such as antimicrobial substances).",
          },
          {
            code: "6.3i",
            title: "Plant Disease Detection methods",
            desc: "Describe different ways plant diseases can be detected and identified in the lab and field (DNA/antigen detection, microscopy).",
          },
          {
            code: "6.3j",
            title: "White Blood Cell Adaptations",
            desc: "Explain how white blood cells and platelets are adapted to their defence functions in the blood.",
          },
          {
            code: "6.3k",
            title: "Non-Specific Defence Systems",
            desc: "Describe the non-specific defence systems of the human body against pathogens.",
          },
          {
            code: "6.3l",
            title: "The Immune System",
            desc: "Explain the role of the immune system of the human body in defence against disease.",
          },
          {
            code: "6.3m",
            title: "Monoclonal Antibody Production",
            desc: "Describe how monoclonal antibodies are produced.",
          },
          {
            code: "6.3n",
            title: "Monoclonal Antibody Applications",
            desc: "Describe some of the ways in which monoclonal antibodies can be used (pregnancy testing, prostate cancer detection, targeting cancer cells).",
          },
          {
            code: "6.3o",
            title: "Vaccines and Medicines",
            desc: "Explain the use of vaccines and medicines (antibiotics, antivirals, and antiseptics) in the prevention and treatment of disease.",
          },
          {
            code: "6.3p",
            title: "Aseptic Techniques for Culturing",
            desc: "Explain the aseptic techniques used in culturing organisms (use of alcohol, flaming, autoclaving, Bunsen burner).",
          },
          {
            code: "6.3q",
            title: "Discovery and Clinical Testing of Medicines",
            desc: "Describe the processes of discovery and development of potential new medicines (preclinical and clinical testing phases).",
          },
          {
            code: "6.3r",
            title: "Multifactorial Non-Communicable Diseases",
            desc: "Recall that many non-communicable human diseases are caused by the interaction of a number of factors (cardiovascular, cancer, bronchitis, cirrhosis).",
          },
          {
            code: "6.3s",
            title: "Cardiovascular Disease Treatments",
            desc: "Evaluate some different treatments for cardiovascular disease (lifestyle, medical, and surgical options).",
          },
          {
            code: "6.3t",
            title: "Lifestyle Factors on Disease",
            desc: "Analyse the effect of lifestyle factors (exercise, diet, alcohol, and smoking) on the incidence of non-communicable diseases.",
          },
          {
            code: "6.3u",
            title: "Cancer Definition",
            desc: "Describe cancer as the result of changes in cells that lead to uncontrolled growth and division.",
          },
          {
            code: "6.3v",
            title: "Stem Cells in Medicine",
            desc: "Discuss potential benefits and risks associated with the use of stem cells in medicine (tissue transplantation and rejection).",
          },
          {
            code: "6.3w",
            title: "Gene Technology in Medicine",
            desc: "Explain some of the possible benefits and risks of using gene technology in medicine.",
          },
          {
            code: "6.3x",
            title: "Understanding the Human Genome",
            desc: "Discuss the potential importance for medicine of our increasing understanding of the human genome (predicting disease, gene-targeted drugs).",
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
