/// <reference types="vite/client" />
import type { Note, SpecPointNote } from "@/lib/notes/noteFormat";

/**
 * Revision notes for the student showcase.
 *
 * The showcase never reads the real database (see studentDemo.ts), so its notes
 * are fixtures built into the bundle: copies of published, science-checked
 * notes, cut down to the board the demo student sits for each subject and
 * pointed at the demo curriculum's spec points. The science is untouched; only
 * the spec codes and point ids are the showcase's own.
 *
 * Each file in ./notes loads on its own, so a visitor downloads the one note
 * they open and none of the others.
 */

/** The notes behind each demo spec point, primary note first. */
export const DEMO_SPEC_POINT_NOTES: Record<string, SpecPointNote[]> = {
  "demo-sp-cell-structure": [
    { id: "bio-001", title: "Eukaryotic and prokaryotic cells", primary: true },
  ],
  "demo-sp-cell-division": [
    { id: "bio-008", title: "Chromosomes, mitosis and the cell cycle", primary: true },
  ],
  "demo-sp-transport": [
    { id: "bio-012", title: "Osmosis", primary: true },
    { id: "bio-011", title: "Diffusion", primary: false },
    { id: "bio-014", title: "Active transport", primary: false },
  ],
  "demo-sp-osmosis-practical": [
    { id: "bio-013", title: "Required practical: osmosis in plant tissue", primary: true },
  ],
  "demo-sp-digestion": [{ id: "bio-023", title: "Digestive enzymes", primary: true }],
  "demo-sp-pathogens": [
    { id: "bio-040", title: "Pathogens and how disease spreads", primary: true },
  ],
  "demo-sp-photosynthesis": [
    { id: "bio-056", title: "Limiting factors of photosynthesis", primary: true },
    { id: "bio-055", title: "Photosynthesis", primary: false },
  ],
  "demo-sp-respiration": [{ id: "bio-060", title: "Aerobic respiration", primary: true }],
  "demo-sp-atoms": [
    { id: "chem-005", title: "Atomic number, mass number and isotopes", primary: true },
  ],
  "demo-sp-ionic": [
    { id: "chem-017", title: "Ionic bonding", primary: true },
    { id: "chem-019", title: "Properties of ionic compounds", primary: false },
  ],
  "demo-sp-covalent": [
    { id: "chem-020", title: "Covalent bonding and dot-and-cross diagrams", primary: true },
  ],
  "demo-sp-rates": [
    { id: "chem-070", title: "Collision theory and activation energy", primary: true },
    { id: "chem-069", title: "Factors affecting the rate of reaction", primary: false },
  ],
  "demo-sp-energy-stores": [{ id: "phys-002", title: "Energy stores and systems", primary: true }],
  "demo-sp-circuits": [
    { id: "phys-013", title: "I–V characteristics, thermistors and LDRs", primary: true },
  ],
  "demo-sp-series": [{ id: "phys-015", title: "Series and parallel circuits", primary: true }],
};

/** The showcase's notes behind the given spec points, ordered as the live read orders them. */
export function demoSpecPointNotes(specPointIds: string[]): Map<string, SpecPointNote[]> {
  const byPoint = new Map<string, SpecPointNote[]>();
  for (const id of specPointIds) {
    const list = DEMO_SPEC_POINT_NOTES[id];
    if (!list) continue;
    byPoint.set(
      id,
      [...list].sort((a, b) => Number(b.primary) - Number(a.primary) || a.id.localeCompare(b.id)),
    );
  }
  return byPoint;
}

/** One fixture note, or null for an id the showcase has no note for. */
export function loadDemoNote(conceptId: string): Promise<Note | null> {
  // Globbed here rather than at the top of the file: Vite rewrites the call
  // wherever it sits, and Bun, which runs the tests that import this module,
  // has no `import.meta.glob` to call. (The reference on line 1 is what types
  // the call for those tests, whose tsconfig loads Bun's types, not Vite's.)
  const files = import.meta.glob<Note>("./notes/*.json", { import: "default" });
  return files[`./notes/${conceptId}.json`]?.() ?? Promise.resolve(null);
}
