import type * as ReactNamespace from "react";

/** h is the injected runtime's createElement, never an imported React. */
type H = typeof ReactNamespace.createElement;

/**
 * Gradient ids are namespaced per rendered icon so two hosts (or two clusters in
 * one page) never steal each other's <defs>; colours are identical, so even a
 * duplicate id stays harmless.
 */
function gradientId(name: string, uid?: string): string {
  const suffix = uid && uid.length > 0 ? uid : "base";
  return "dsh-base-cluster-" + name + "-" + suffix;
}

const SVG_CLASS = "dsh-base-cluster__svg";

/**
 * Contact / community: two stacked speech bubbles (blue -> purple gradient).
 * The three white dots on the front bubble pulse while the button is hovered,
 * so the affordance reads as "talking to us" instead of a grey QR outline.
 */
export function contactClusterIcon(
  h: H,
  size = 16,
  uid?: string,
): ReactNamespace.ReactElement {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      className: SVG_CLASS + " dsh-base-cluster__svg--contact",
      "aria-hidden": "true",
      focusable: "false",
    },
    h(
      "defs",
      { key: "defs" },
      h(
        "linearGradient",
        { id: gradientId("ca", uid), x1: "0", y1: "0", x2: "1", y2: "1", key: "ca" },
        h("stop", { offset: "0", stopColor: "#7cc4ff", key: "s1" }),
        h("stop", { offset: ".55", stopColor: "#4f8bff", key: "s2" }),
        h("stop", { offset: "1", stopColor: "#3f5cff", key: "s3" }),
      ),
      h(
        "linearGradient",
        { id: gradientId("cb", uid), x1: "0", y1: "0", x2: "1", y2: "1", key: "cb" },
        h("stop", { offset: "0", stopColor: "#c79bff", key: "s1" }),
        h("stop", { offset: "1", stopColor: "#8b5cf6", key: "s2" }),
      ),
    ),
    h(
      "g",
      { className: "dsh-base-ico-bob", key: "bob" },
      h("path", {
        d: "M3 7.4A3.4 3.4 0 0 1 6.4 4h7.1A3.4 3.4 0 0 1 16.9 7.4v3.1a3.4 3.4 0 0 1-3.4 3.4H8.3l-3.9 3.05a.65.65 0 0 1-1.05-.51v-2.9A3.4 3.4 0 0 1 3 10.5z",
        fill: "url(#" + gradientId("ca", uid) + ")",
        key: "back",
      }),
      h("ellipse", {
        cx: 6.8,
        cy: 7.4,
        rx: 3.1,
        ry: 1.35,
        fill: "#fff",
        opacity: ".32",
        key: "shine",
      }),
      h("path", {
        d: "M10.5 11.2A3.5 3.5 0 0 1 14 7.7h5.2a3.5 3.5 0 0 1 3.5 3.5v3a3.5 3.5 0 0 1-3.5 3.5h-4.9l-3.15 2.5a.62.62 0 0 1-1-.49v-2.24a3.5 3.5 0 0 1-1.86-3.12z",
        fill: "url(#" + gradientId("cb", uid) + ")",
        key: "front",
      }),
      h("circle", {
        className: "dsh-base-ico-dot dsh-base-ico-dot--1",
        cx: 13.1,
        cy: 14.1,
        r: 1.2,
        fill: "#fff",
        key: "d1",
      }),
      h("circle", {
        className: "dsh-base-ico-dot dsh-base-ico-dot--2",
        cx: 16.2,
        cy: 14.1,
        r: 1.2,
        fill: "#fff",
        key: "d2",
      }),
      h("circle", {
        className: "dsh-base-ico-dot dsh-base-ico-dot--3",
        cx: 19.3,
        cy: 14.1,
        r: 1.2,
        fill: "#fff",
        key: "d3",
      }),
    ),
  );
}

/**
 * Star: a gold gradient five-pointed star with an inner highlight, a soft halo
 * and four sparkles around it. Hover twinkles the big star, breathes the halo
 * and blinks the sparkles out of phase.
 */
export function starClusterIcon(
  h: H,
  size = 16,
  uid?: string,
): ReactNamespace.ReactElement {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      className: SVG_CLASS + " dsh-base-cluster__svg--star",
      "aria-hidden": "true",
      focusable: "false",
    },
    h(
      "defs",
      { key: "defs" },
      h(
        "linearGradient",
        { id: gradientId("sa", uid), x1: "0", y1: "0", x2: ".85", y2: "1", key: "sa" },
        h("stop", { offset: "0", stopColor: "#ffe98a", key: "s1" }),
        h("stop", { offset: ".45", stopColor: "#ffc12e", key: "s2" }),
        h("stop", { offset: "1", stopColor: "#ff8a1e", key: "s3" }),
      ),
      h(
        "radialGradient",
        { id: gradientId("sg", uid), cx: ".5", cy: ".5", r: ".5", key: "sg" },
        h("stop", { offset: "0", stopColor: "#ffd75e", stopOpacity: ".55", key: "s1" }),
        h("stop", { offset: "1", stopColor: "#ffd75e", stopOpacity: "0", key: "s2" }),
      ),
    ),
    h("circle", {
      className: "dsh-base-ico-halo",
      cx: 12,
      cy: 12,
      r: 10.6,
      fill: "url(#" + gradientId("sg", uid) + ")",
      key: "halo",
    }),
    h(
      "g",
      { className: "dsh-base-ico-bigstar", key: "bigstar" },
      h("path", {
        d: "M12 2.7l2.72 5.49 6.06.89-4.39 4.27 1.04 6.04L12 16.55l-5.43 2.84 1.04-6.04L3.22 9.08l6.06-.89z",
        fill: "url(#" + gradientId("sa", uid) + ")",
        stroke: "#ffb020",
        strokeWidth: ".35",
        strokeLinejoin: "round",
        key: "star",
      }),
      h("path", {
        d: "M12 5.35l1.55 3.13 3.45.51-2.5 2.43.6 3.44L12 13.2l-3.1 1.66.6-3.44-2.5-2.43 3.45-.51z",
        fill: "#fff",
        opacity: ".33",
        key: "shine",
      }),
    ),
    h("g", { className: "dsh-base-ico-spark dsh-base-ico-spark--1", fill: "#fff", key: "sp1" }, h("path", { d: "M19.9 3.0l.52 1.3 1.3.52-1.3.52-.52 1.3-.52-1.3-1.3-.52 1.3-.52z", key: "p" })),
    h("g", { className: "dsh-base-ico-spark dsh-base-ico-spark--2", fill: "#ffe27a", key: "sp2" }, h("path", { d: "M4.2 16.4l.38.95.95.38-.95.38-.38.95-.38-.95-.95-.38.95-.38z", key: "p" })),
    h("g", { className: "dsh-base-ico-spark dsh-base-ico-spark--3", fill: "#fff", key: "sp3" }, h("path", { d: "M21.1 17.2l.3.76.76.3-.76.3-.3.76-.3-.76-.76-.3.76-.3z", key: "p" })),
    h("g", { className: "dsh-base-ico-spark dsh-base-ico-spark--4", fill: "#ffd75e", key: "sp4" }, h("path", { d: "M5.7 3.9l.3.76.76.3-.76.3-.3.76-.3-.76-.76-.3.76-.3z", key: "p" })),
  );
}

/**
 * Issue / feedback: a coral speech bubble with a white exclamation mark.
 * Hover wiggles the bubble, bounces the mark and blinks the corner sparkle.
 */
export function issueClusterIcon(
  h: H,
  size = 16,
  uid?: string,
): ReactNamespace.ReactElement {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      className: SVG_CLASS + " dsh-base-cluster__svg--issue",
      "aria-hidden": "true",
      focusable: "false",
    },
    h(
      "defs",
      { key: "defs" },
      h(
        "linearGradient",
        { id: gradientId("ia", uid), x1: "0", y1: "0", x2: "1", y2: "1", key: "ia" },
        h("stop", { offset: "0", stopColor: "#ffa3b5", key: "s1" }),
        h("stop", { offset: ".5", stopColor: "#ff6b8a", key: "s2" }),
        h("stop", { offset: "1", stopColor: "#f43f5e", key: "s3" }),
      ),
    ),
    h(
      "g",
      { className: "dsh-base-ico-bubble", key: "bubble" },
      h("path", {
        d: "M6.6 4.4h10.8A3.6 3.6 0 0 1 21 8v6.2a3.6 3.6 0 0 1-3.6 3.6h-6.1l-4.4 3.4a.72.72 0 0 1-1.15-.57v-2.83H6.6A3.6 3.6 0 0 1 3 14.2V8a3.6 3.6 0 0 1 3.6-3.6z",
        fill: "url(#" + gradientId("ia", uid) + ")",
        key: "bubble",
      }),
      h("ellipse", {
        cx: 7.3,
        cy: 6.2,
        rx: 3.3,
        ry: 1.3,
        fill: "#fff",
        opacity: ".3",
        key: "shine",
      }),
      h("rect", {
        className: "dsh-base-ico-bang",
        x: 11.05,
        y: 6.55,
        width: 1.9,
        height: 5.35,
        rx: ".95",
        fill: "#fff",
        key: "stem",
      }),
      h("circle", {
        className: "dsh-base-ico-bang",
        cx: 12,
        cy: 14.15,
        r: 1.02,
        fill: "#fff",
        key: "dot",
      }),
    ),
    h(
      "g",
      { className: "dsh-base-ico-spark", fill: "#fff", opacity: ".9", key: "spark" },
      h("path", {
        d: "M19.7 2.2l.46 1.15 1.15.46-1.15.46-.46 1.15-.46-1.15-1.15-.46 1.15-.46z",
        key: "p",
      }),
    ),
  );
}

/** Neutral three-dot glyph for the overflow trigger of the cluster. */
export function moreClusterIcon(h: H, size = 16): ReactNamespace.ReactElement {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      className: SVG_CLASS + " dsh-base-cluster__svg--more",
      "aria-hidden": "true",
      focusable: "false",
    },
    h(
      "g",
      { fill: "currentColor", key: "dots" },
      h("circle", { cx: 5.5, cy: 12, r: 1.8, key: "a" }),
      h("circle", { cx: 12, cy: 12, r: 1.8, key: "b" }),
      h("circle", { cx: 18.5, cy: 12, r: 1.8, key: "c" }),
    ),
  );
}
