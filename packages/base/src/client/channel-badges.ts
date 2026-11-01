import type { TextKey } from "./texts";

/**
 * Official channel marks for the contact modal's group cards.
 *
 * One channel = one row in `CHANNEL_BADGES`: the official brand colour plus the
 * official mark's own viewBox and paths. Adding a channel is a data change here,
 * never a renderer change — the card title renders whatever row the group's
 * `platform` points at, and a platform without a row renders no badge.
 *
 * Channel names are message ids ({@link TextKey}), so hosts can override them
 * through the same `texts` option as every other string.
 *
 * The marks identify the platform only (the brand policies allow that); each
 * mark stays the trademark of its owner:
 *   - feishu: Lark/Feishu mark (ByteDance IconPark `lark`), brand blue #3370FF
 *   - qq: Tencent QQ penguin (Simple Icons `tencentqq`), brand blue #12B7F5
 *   - wechat: WeChat bubbles (Simple Icons `wechat`), brand green #07C160
 */
export interface ChannelBadgeSpec {
  /** Platform id the group's `platform` field points at. */
  platform: string;
  /** Message id of the channel name read by assistive tech before the title. */
  labelKey: TextKey;
  /** Official brand colour of the badge tile; the mark is painted white on it. */
  color: string;
  /** Coordinate system of the mark's own paths. */
  viewBox: string;
  /** Mark paths, filled with `currentColor` (the badge sets white). */
  paths: readonly string[];
  /** Marks with counters/holes need evenodd; single-winding marks stay nonzero. */
  fillRule: "evenodd" | "nonzero";
}

const CHANNEL_BADGES: Readonly<Record<string, ChannelBadgeSpec>> = {
  feishu: {
    platform: "feishu",
    labelKey: "channelFeishu",
    color: "#3370FF",
    viewBox: "0 0 48 48",
    fillRule: "evenodd",
    paths: [
      "M41.0716 5.99409L3.31071 16.5187L12.3856 25.8126L20.7998 25.9594L30.4827 16.5187C30.2266 15.9943 30.0985 15.5552 30.0985 15.2013C30.0985 14.4074 30.4104 13.7786 30.8947 13.333C31.7241 12.57 32.7222 12.4558 33.8889 12.9905L41.0716 5.99409Z",
      "M42.1021 6.72842L31.5775 44.4893L22.2836 35.4144L22.1367 27.0002L31.5115 17.4816C32.0195 17.8454 32.5743 18.0105 33.1759 17.9769C34.0784 17.9264 34.6614 17.3813 34.9349 17.0602C35.2083 16.7392 35.5293 16.2051 35.5025 15.4113C35.4847 14.8821 35.3109 14.3941 34.9812 13.9472L42.1021 6.72842Z",
    ],
  },
  qq: {
    platform: "qq",
    labelKey: "channelQq",
    color: "#12B7F5",
    viewBox: "0 0 24 24",
    fillRule: "nonzero",
    paths: [
      "M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673c.54.065 2.103-2.472 2.103-2.472c0 1.469.756 3.387 2.394 4.771c-.612.188-1.363.479-1.845.835c-.434.32-.379.646-.301.778c.343.578 5.883.369 7.482.189c1.6.18 7.14.389 7.483-.189c.078-.132.132-.458-.301-.778c-.483-.356-1.233-.646-1.846-.836c1.637-1.384 2.393-3.302 2.393-4.771c0 0 1.563 2.537 2.103 2.472c.251-.03.581-1.39-.438-4.673",
    ],
  },
  wechat: {
    platform: "wechat",
    labelKey: "channelWechat",
    color: "#07C160",
    viewBox: "0 0 24 24",
    fillRule: "nonzero",
    paths: [
      "M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213c0 .163.13.295.29.295a.33.33 0 0 0 .167-.054l1.903-1.114a.86.86 0 0 1 .717-.098a10.2 10.2 0 0 0 2.837.403c.276 0 .543-.027.811-.05c-.857-2.578.157-4.972 1.932-6.446c1.703-1.415 3.882-1.98 5.853-1.838c-.576-3.583-4.196-6.348-8.596-6.348M5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178a1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18m5.34 2.867c-1.797-.052-3.746.512-5.28 1.786c-1.72 1.428-2.687 3.72-1.78 6.22c.942 2.453 3.666 4.229 6.884 4.229c.826 0 1.622-.12 2.361-.336a.72.72 0 0 1 .598.082l1.584.926a.3.3 0 0 0 .14.047c.134 0 .24-.111.24-.247c0-.06-.023-.12-.038-.177l-.327-1.233a.6.6 0 0 1-.023-.156a.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983a.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983a.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982",
    ],
  },
};

/** Look up a channel mark; a platform without a row renders no badge. */
export function channelBadge(platform: string): ChannelBadgeSpec | undefined {
  return Object.prototype.hasOwnProperty.call(CHANNEL_BADGES, platform)
    ? CHANNEL_BADGES[platform]
    : undefined;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Build the decorative badge from a table row: brand-coloured tile (colour via
 * the `--dsh-base-badge-color` custom property, sized by CSS) + white mark.
 * The caller already looked the row up, so this never fails.
 */
export function createChannelBadge(doc: Document, badge: ChannelBadgeSpec): HTMLSpanElement {
  const tile = doc.createElement("span");
  tile.className = "dsh-base-modal__card-badge";
  tile.dataset.platform = badge.platform;
  tile.setAttribute("aria-hidden", "true");
  tile.style.setProperty("--dsh-base-badge-color", badge.color);

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", badge.viewBox);
  svg.setAttribute("focusable", "false");
  svg.setAttribute("role", "presentation");
  for (const d of badge.paths) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "currentColor");
    if (badge.fillRule === "evenodd") path.setAttribute("fill-rule", "evenodd");
    svg.append(path);
  }
  tile.append(svg);
  return tile;
}
