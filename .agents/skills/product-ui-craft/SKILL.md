---
name: product-ui-craft
description: Design or refine product interfaces such as dashboards, admin tools, tables, forms, boards, and multi-step workflows. Use for UI implementation, visual redesigns, design-system direction, or screenshot-based interface critique; use design-taste-frontend instead for marketing pages and portfolios.
---

# Product UI Craft

Build product interfaces whose hierarchy, density, and feedback serve the work. Apply this independently of any design tool: canvas, code, screenshot, or prototype.

## Read the product

Before changing the interface, inspect the existing product, its content, brand assets, components, and technical constraints. Identify:

- the user's primary job and the decision the screen supports;
- information that is urgent, frequently scanned, or directly actionable;
- repeated structures that need stable alignment;
- established visual rules worth preserving;
- accessibility, device, and interaction constraints.

For a redesign, preserve recognizable product language unless the user asks for a new brand direction.

## Commit to a brief

Before implementation, tell the user the direction in this compact form:

- **Mood candidates**: three to five physical or cultural registers that plausibly fit.
- **Mood chosen**: select a candidate other than the most obvious default, and explain the choice in one sentence.
- **Palette**: five or six colors with roles; derive each from an object or condition in the chosen mood.
- **Type**: available families, weights, and a practical size scale.
- **Direction**: one sentence describing hierarchy, density, layout, and interaction character.

Treat the brief as a commitment. Change it only when the product evidence or user feedback calls for a different direction.

## Compose the interface

Start with hierarchy, then surfaces, then decoration.

- Put the primary job and current state in the strongest visual lane.
- Use asymmetry and scale contrast to create emphasis while keeping repeated data aligned.
- Let information live directly on a surface when elevation adds no meaning. Reserve cards for independently actionable or movable groups.
- Give repeated rows fixed lanes for leading icons, content, metadata, and trailing actions. Empty slots retain their width.
- Vary spacing deliberately: tight inside a group, generous between distinct decisions.
- Keep one corner-radius logic and one dominant accent across the screen.
- Use intense color for decisions and state changes. Pull semantic colors from the same visual scene when possible.
- Use realistic domain content. Copy should reveal hierarchy, edge cases, and likely text lengths.

For dense interfaces, typography carries the hierarchy: strong section titles, readable body text, high-contrast small labels, and tabular figures for data. Confirm the chosen fonts and weights exist in the target environment before relying on them.

## Design the full cycle

Represent the states that make the interface trustworthy:

- loading that preserves the final layout's geometry;
- empty content with a clear way forward;
- inline or contextual errors near the affected work;
- disabled, focus, hover, pressed, selected, and drag states where relevant;
- overflow, long labels, narrow screens, and reduced-motion behavior.

Use status color as a secondary cue; pair it with text, shape, or iconography. Keep controls and small text comfortably readable at a glance.

## Work in reviewable increments

Build or edit one meaningful visual group at a time. After each section, render or capture the actual result and review it as a senior product designer. State a one-line verdict covering:

- **Spacing**: rhythm is intentional; related items group naturally.
- **Typography**: hierarchy is obvious and text remains legible.
- **Contrast**: content and controls remain distinct from their surfaces.
- **Alignment**: shared lanes line up across every repeated row.
- **Fit**: no clipping, accidental overflow, or unreachable action.
- **Repetition**: the layout has useful variation instead of uniform boxes.

Fix observed issues with targeted edits before adding the next section. Use screenshots for visual judgment and inspect source styles or computed values when exact implementation values matter.

## Completion gate

Finish only when the rendered interface satisfies every applicable item:

- The primary task and next action are apparent within a few seconds.
- Every repeated row aligns across at least three realistic examples.
- Small text, controls, and statuses are readable without relying on color alone.
- Loading, empty, error, and interaction states are accounted for.
- Content fits the target viewport or scrolls intentionally.
- Decorative elements reinforce the chosen mood and do not compete with the work.
- The final implementation still matches the declared brief.

Report the design rationale, material changes, verification performed, and any states that could not be exercised.
