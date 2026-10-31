import type * as ReactNamespace from "react";
import type { HoverTipProps } from "./types";

/** Class of the floating tooltip element (styled in styles.ts). */
export const TIP_CLASS = "dsh-base-tip";

/** Distance between the trigger and the tooltip. */
const GAP = 8;
/** Keep the tooltip this far away from the viewport edges. */
const EDGE = 8;

/** Cross-instance singleton: only one hovered tooltip is on screen at a time. */
let activeDispose: (() => void) | null = null;
let tipSerial = 0;

export interface TipMountOptions {
  /** Max tooltip width in px (default 320). */
  maxWidth?: number;
  /** Preferred side; flips automatically when the viewport has no room. */
  placement?: "top" | "bottom";
  /**
   * Claim the document-wide single-tip slot (default true). Controlled tips
   * (screenshots, demos) opt out and may coexist.
   */
  exclusive?: boolean;
}

export interface TipHandle {
  /** Id of the mounted tooltip element (for aria-describedby). */
  readonly id: string;
  dispose(): void;
}

/**
 * Mount one tooltip for an anchor.
 *
 * Shared engine behind the public HoverTip control and the header action
 * cluster: one copy line above the trigger, flipped below near the top edge,
 * clamped inside the viewport, dark pill that escapes overflow:hidden panels by
 * living in document.body. It never receives pointer events, so it cannot steal
 * the hover from the trigger.
 */
export function mountTip(
  anchor: HTMLElement,
  content: string,
  options: TipMountOptions = {},
): TipHandle {
  if (typeof document === "undefined") {
    return { id: "", dispose: () => {} };
  }
  const exclusive = options.exclusive ?? true;
  if (exclusive) activeDispose?.();

  const el = document.createElement("div");
  el.className = TIP_CLASS;
  el.id = "dsh-base-tip-" + (tipSerial += 1);
  el.setAttribute("role", "tooltip");
  el.textContent = content;
  el.style.maxWidth = String(options.maxWidth ?? 320) + "px";

  const place = (): void => {
    if (!el.isConnected || !anchor.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    let side = options.placement ?? "top";
    if (side === "top" && rect.top - height - GAP < EDGE) side = "bottom";
    if (side === "bottom" && rect.bottom + height + GAP > viewH - EDGE) {
      side = rect.top - height - GAP >= EDGE ? "top" : "bottom";
    }
    const centered = rect.left + rect.width / 2 - width / 2;
    const maxLeft = Math.max(EDGE, viewW - width - EDGE);
    const left = Math.min(Math.max(centered, EDGE), maxLeft);
    const wanted = side === "top" ? rect.top - height - GAP : rect.bottom + GAP;
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(Math.max(EDGE, Math.min(wanted, viewH - height - EDGE))) + "px";
    el.dataset.side = side;
  };

  document.body.appendChild(el);
  place();
  let frame = 0;
  if (typeof window.requestAnimationFrame === "function") {
    frame = window.requestAnimationFrame(() => {
      el.dataset.show = "true";
    });
  } else {
    el.dataset.show = "true";
  }

  const onViewportChange = (): void => place();
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);

  const dispose = (): void => {
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
    if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frame);
    el.remove();
    if (activeDispose === dispose) activeDispose = null;
  };
  if (exclusive) activeDispose = dispose;
  return { id: el.id, dispose };
}

/**
 * Port of the deck HoverTip as a public base control.
 *
 * The tooltip lives in document.body so it escapes panels with overflow:hidden;
 * it never receives pointer events, so it cannot steal the hover from the
 * trigger. Hovered tips are global (one at a time); a controlled tip (the
 * visible prop) is explicit and may coexist with others.
 */
export function createHoverTip(
  React: typeof ReactNamespace,
): ReactNamespace.ComponentType<HoverTipProps> {
  const h = React.createElement;

  function HoverTip(props: HoverTipProps): ReactNamespace.ReactElement {
    const anchorRef = React.useRef<HTMLElement | null>(null);
    const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [hovered, setHovered] = React.useState(false);
    const [dismissed, setDismissed] = React.useState(false);

    const controlled = props.visible !== undefined;
    const active = (controlled ? Boolean(props.visible) : hovered) && !dismissed;
    const hideDelay = props.hideDelay ?? 160;

    const clearHide = React.useCallback(() => {
      if (hideTimer.current === null) return;
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }, []);

    const show = React.useCallback(() => {
      clearHide();
      setDismissed(false);
      setHovered(true);
    }, [clearHide]);

    const hideSoon = React.useCallback(() => {
      clearHide();
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        setHovered(false);
      }, hideDelay);
    }, [clearHide, hideDelay]);

    React.useEffect(() => clearHide, [clearHide]);

    // A controlled flip or a copy change clears a local Escape dismissal.
    React.useEffect(() => {
      setDismissed(false);
    }, [props.visible, props.content]);

    React.useEffect(() => {
      if (!active || !props.content) return undefined;
      if (typeof document === "undefined") return undefined;
      const anchor = anchorRef.current;
      if (!anchor) return undefined;

      const tip = mountTip(anchor, props.content, {
        maxWidth: props.maxWidth,
        placement: props.placement,
        exclusive: !controlled,
      });

      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Escape") return;
        setHovered(false);
        setDismissed(true);
        tip.dispose();
      };
      document.addEventListener("keydown", onKeyDown, true);

      return () => {
        document.removeEventListener("keydown", onKeyDown, true);
        tip.dispose();
      };
    }, [active, controlled, props.content, props.maxWidth, props.placement]);

    return h(
      "span",
      {
        ref: (node: HTMLSpanElement | null) => {
          anchorRef.current = node;
        },
        className: "dsh-base-tip-anchor" + (props.className ? " " + props.className : ""),
        onMouseEnter: show,
        onMouseLeave: hideSoon,
        onFocus: show,
        onBlur: hideSoon,
      },
      props.children ?? null,
    );
  }

  return HoverTip;
}
