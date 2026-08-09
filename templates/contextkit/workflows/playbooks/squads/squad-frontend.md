# 🎨 Playbook: design-team (Frontend)

This playbook governs the user experience, styling guidelines, and page architectures.

## 👥 Members
* `ux-designer`: Interaction design, state transitions, usability, error states.
* `ui-designer`: Design systems, layout alignments, responsive spacing.
* `accessibility`: WCAG 2.1 AA audits (aria labels, contrast, keyboard indexing).
* `landing-architect`: Scaffolds landing pages, folding targets, and rendering.
* `conversion-strategist`: Directs copywriting benefits and interactive hooks.
* `tracking-integrator`: Installs web pixels and consent-first cookies routing.

## 📝 Best Practices
1. **Framework Alignment:** Check `project-map` metadata for framework settings (Vite, Next.js, React, Vue, Tailwind CSS, or CSS Modules).
2. **WCAG Standards:** Ensure custom components utilize semantic tags (`<button>`, `<nav>`) and include proper ARIA support.
3. **No Hardcoded Values:** Always reference spacing, colors, and font-families from the central styling design tokens.
