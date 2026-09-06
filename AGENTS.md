# 🛡️ Agent Guardrails & General Safety Mandates

You must ALWAYS follow these instructions without any exception:

1. **No Project-Wide Rewrites:** Never rewrite or reconstruct the entire project or significant portions of it unless the user explicitly requests it.
2. **Technology Preservation:** Never change core technologies, frameworks, libraries, database engines, or major patterns without explicit approval.
3. **No Unnecessary File Renames:** Keep files named exactly as they are. Never rename files or move components unless it is structurally required to resolve a bug or error.
4. **Functionality Retention:** Never remove existing features, components, pages, visual representations, or sub-routines unless instructed.
5. **Branding and Copy Consistency:** Keep branding, logos, color themes, names, marketing copy, and overall product voice exactly as designed unless explicitly requested to alter them.
6. **Design System — every new surface is built from the kit.** Anything you add to this site must look like it was always there. Before writing markup, read the design-system section of `README.md` and reuse what exists: `.premium-card`, `.chip`, `.eyebrow`, `.icon-tile`, `.btn-premium`/`.btn-solid`, `.numeral`, and the composed components in `src/components/Shared.tsx` (`SectionHeading`, `EmptyState`, `Spinner`, `Meter`, `Ring`, `StatTile`). Specifically:
   - **Never hand-roll** a card, pill, progress bar, empty state, loading state or uppercase micro-label. Every one of those already exists, and a new one is how the site drifts back into several voices.
   - **Colour comes from `--tint`**, never from Tailwind's palette. `bg-emerald-500`, `text-sky-700` and friends opt the element out of the system and stay the wrong colour inside a tinted card. Set a `tint-*` class (or `SUBJECT_TINT[subject]`) on an ancestor and let the kit paint itself.
   - **Headings are display type by the element**, so `h1`–`h6` need no class — but display type is bold (700) or heavier. Never set a heading to `font-semibold`.
   - A new feature is not finished until it has been looked at in the browser next to the surfaces around it.
7. **Smallest Possible Edits:** Always implement the smallest, most precise changes possible to successfully complete the requested task. Prefer surgical edits over broad-spectrum rewrites.
8. **Explicit Modification Reasoning:** Always provide a brief, clear explanation of why a file is being modified before editing it.
9. **Consult and Present Options:** If a feature or request can be implemented in multiple ways, outline the options clearly to the user first and let them select the preferred route.
10. **Clarify Uncertainty:** If you are uncertain about any part of the requirements, stop and ask the user for clarification instead of guessing or assuming.
