import type * as ReactNamespace from "react";

/** h is the injected runtime's createElement, never an imported React. */
type H = typeof ReactNamespace.createElement;

/**
 * Contact affordance: a QR-code outline (frame, three finder squares, four
 * data modules). Line art in currentColor so it inherits the host theme.
 */
export function contactIcon(h: H, size: number): ReactNamespace.ReactElement {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("rect", { x: 3, y: 3, width: 18, height: 18, rx: 4, key: "frame" }),
    h("rect", { x: 7, y: 7, width: 3.6, height: 3.6, rx: 1, key: "tl" }),
    h("rect", { x: 13.4, y: 7, width: 3.6, height: 3.6, rx: 1, key: "tr" }),
    h("rect", { x: 7, y: 13.4, width: 3.6, height: 3.6, rx: 1, key: "bl" }),
    h("path", {
      d: "M13.4 14h1.4M13.4 17.2h1.4M16.8 14h1.4M16.8 17.2h1.4",
      key: "data",
    }),
  );
}

/** 2x2 grid glyph used by the card title (14px) and each row (12px). */
export function gridIcon(h: H, size: number): ReactNamespace.ReactElement {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("rect", { x: 3, y: 3, width: 7, height: 7, rx: 1, key: "tl" }),
    h("rect", { x: 14, y: 3, width: 7, height: 7, rx: 1, key: "tr" }),
    h("rect", { x: 3, y: 14, width: 7, height: 7, rx: 1, key: "bl" }),
    h("rect", { x: 14, y: 14, width: 7, height: 7, rx: 1, key: "br" }),
  );
}

/**
 * Five-point star outline: the Star affordance. Same line grammar as
 * contactIcon (24px grid, currentColor, 1.8 stroke, round joins), so the three
 * header actions read as one family.
 */
export function starIcon(h: H, size: number): ReactNamespace.ReactElement {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("path", {
      d: "M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8Z",
      key: "star",
    }),
  );
}

/** Circled exclamation: the Issue affordance (GitHub "issue opened" meaning). */
export function issueIcon(h: H, size: number): ReactNamespace.ReactElement {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("circle", { cx: 12, cy: 12, r: 9, key: "ring" }),
    h("path", { d: "M12 7.8v4.8", key: "stem" }),
    h("path", { d: "M12 16.2h.01", key: "dot" }),
  );
}

/** Square + diagonal arrow: the "opens in a new tab" affordance. */
export function externalLinkIcon(h: H): ReactNamespace.ReactElement {
  return h(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("path", {
      d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
      key: "box",
    }),
    h("polyline", { points: "15 3 21 3 21 9", key: "arrow" }),
    h("line", { x1: 10, y1: 14, x2: 21, y2: 3, key: "line" }),
  );
}
