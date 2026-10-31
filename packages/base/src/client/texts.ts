import type { Lang } from "../core/types";

/** Message ids shared by the widgets and the contact modal. */
export type TextKey =
  | "contact"
  | "contactHint"
  | "kicker"
  | "modalTitle"
  | "welcome"
  | "scanHint"
  | "mobileHint"
  | "close"
  | "copyHint"
  | "copied"
  | "expired"
  | "fallback"
  | "plugins"
  | "contactTip"
  | "starTip"
  | "issueTip"
  | "starLabel"
  | "issueLabel"
  | "actionsLabel";

export type TextOverrides = Partial<Record<string, string>>;

/**
 * Built-in copy. The wording mirrors the README contact block so the settings
 * panel and the README read the same; callers can override any message id.
 */
export const MESSAGES: Record<Lang, Record<TextKey, string>> = {
  zh: {
    contact: "联系我们",
    contactHint: "加入交流群",
    kicker: "CONNECT",
    modalTitle: "反馈与联系",
    welcome:
      "👏欢迎提交PR、ISSUE。星星之火可以燎原🔥有任何建议、意见、想法、吐槽、idea都可以进群交流。",
    scanHint: "扫描二维码加入我们",
    mobileHint: "请在手机上扫码，或复制群号搜索",
    close: "关闭",
    copyHint: "点击复制",
    copied: "已复制",
    expired: "该二维码已过期，请点击下方链接获取最新群码",
    fallback: "点此获取最新群二维码",
    plugins: "作者的其他插件",
    contactTip: "扫码加入交流群，反馈、建议、idea 都欢迎",
    starTip: "您的🌟是我夜空中最亮的星🌹",
    issueTip: "任何功能需求、故障、建议、意见都可以提 ISSUE",
    starLabel: "Star 这个项目",
    issueLabel: "提交 Issue",
    actionsLabel: "快捷操作",
  },
  en: {
    contact: "Contact us",
    contactHint: "Join the community",
    kicker: "CONNECT",
    modalTitle: "Feedback and Contact",
    welcome:
      "👏Welcome PRs and issues. A single spark can start a prairie fire 🔥. Any suggestion, opinion, idea or rant — come join the group and talk.",
    scanHint: "Scan the QR code to join us",
    mobileHint: "Scan with your phone, or copy the group ID to search",
    close: "Close",
    copyHint: "Click to copy",
    copied: "Copied",
    expired: "This QR code has expired. Use the link below for the latest one.",
    fallback: "Get the latest QR code",
    plugins: "More plugins by the author",
    contactTip: "Scan to join the community — feedback, ideas and rants are all welcome",
    starTip: "Your ⭐ is the brightest star in my night sky 🌹",
    issueTip: "Report bugs or request features in Issues",
    starLabel: "Star this project",
    issueLabel: "Open an issue",
    actionsLabel: "Quick actions",
  },
};

/** Resolve one message id: caller overrides win, then the detected language. */
export function resolveText(
  key: TextKey,
  lang: Lang,
  overrides?: TextOverrides,
): string {
  const custom = overrides?.[key];
  if (typeof custom === "string" && custom.length > 0) return custom;
  return MESSAGES[lang][key];
}
