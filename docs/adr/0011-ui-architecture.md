# 0011 Visual system and week grid layout

Date: 2026-11-22
Status: Accepted

## Context

Staff enter time on phones as often as on desktops. A second design layer or a second grid doubles what must be kept accessible.

## Decision

- Colour and spacing are tokens in `global.css` only, contrast-gated by script.
- Components are copied shadcn sources, owned in the tree; use them, never hand-write a Button or Input.
- The week grid is one markup for phone and wide screens.
- The keyboard model is tested in jsdom.

## Consequences

- Literal colours fail the gate.
- No separate mobile grid to drift.
- Screen details live in code and tests.
