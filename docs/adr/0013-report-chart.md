# 0013 Server-rendered report chart with d3-scale

Date: 2026-11-25
Status: Accepted

## Context

/reports should show hours by week, person or project, split by week state. The CSP blocks inline script and style attributes, and ADR 0001 allows one React island, so the chart cannot be client code.

## Decision

- Astro renders the chart as static SVG on the server; it ships no client JS.
- Runtime dependencies are `d3-scale` and `d3-array`, pinned exact. They bring d3-format, d3-time, d3-time-format, d3-interpolate, d3-color and internmap; all are ISC, ESM, side-effect free, with no install script.
- Bars are `<rect>` elements; the four states (draft, submitted, returned, approved) stack in fixed order by running sum, so d3-shape is not a dependency.
- Colour is `fill-chart-N` token classes, never a `fill` literal, a d3 colour scale or a `style` attribute.

## Consequences

- No CSP change, and no new hash to keep in sync with the chart.
- About 12 KB gzip joins the Worker bundle; Dependabot updates it with the npm group.
- Hover or other interactivity would need a new ADR.
