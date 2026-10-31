import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createBaseUI, resolveText } from "../src/client/index";
import type { ActionClusterItem } from "../src/client/types";

/**
 * Demo-only QR placeholder: the real baseline images land with ticket 03 and
 * the remote CDN codes with ticket 05. This one proves the card layout, the
 * fallback-free path and the pixelated rendering style.
 */
const DEMO_QR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges">' +
  '<rect width="29" height="29" fill="#fff"/>' +
  '<path fill="#1f2329" d="M0 0h7v7H0zM1 1h5v5H1zM22 0h7v7h-7zM23 1h5v5h-5zM0 22h7v7H0zM1 23h5v5H1z"/>' +
  '<path fill="#fff" d="M2 2h3v3H2zM24 2h3v3h-3zM2 24h3v3H2z"/>' +
  '<path fill="#1f2329" d="M9 0h2v2H9zM13 1h2v2h-2zM17 0h2v2h-2zM10 3h3v2h-3zM15 4h2v2h-2zM9 6h2v2H9zM13 7h4v2h-4zM18 6h2v2h-2zM0 9h2v2H0zM3 9h3v2H3zM8 9h2v2H8zM11 9h2v3h-2zM15 9h2v2h-2zM19 9h2v2h-2zM23 9h3v2h-3zM27 9h2v2h-2zM1 12h2v2H1zM5 12h3v2H5zM9 12h2v2H9zM13 12h3v2h-3zM17 12h4v2h-4zM22 12h2v3h-2zM26 12h2v2h-2zM0 15h3v2H0zM4 15h2v2H4zM8 15h3v2H8zM12 15h2v2h-2zM16 15h2v2h-2zM19 15h2v2h-2zM23 15h2v2h-2zM27 15h2v2h-2zM2 18h2v2H2zM6 18h2v2H6zM10 18h2v2h-2zM14 18h3v2h-3zM18 18h3v2h-3zM24 18h3v2h-3zM0 20h2v2H0zM4 20h4v2H4zM9 20h2v2H9zM13 20h2v2h-2zM17 20h2v2h-2zM21 20h2v2h-2zM25 20h3v2h-3zM9 22h2v2H9zM12 24h2v2h-2zM16 22h3v2h-3zM21 23h2v2h-2zM25 22h2v2h-2zM13 26h2v2h-2zM17 25h2v2h-2zM20 26h2v2h-2zM24 26h2v2h-2z"/>' +
  "</svg>";

const DEMO_QR = "data:image/svg+xml;utf8," + encodeURIComponent(DEMO_QR_SVG);

/** Demo host repo: the real deck, so the links point somewhere sensible. */
const REPO = "https://github.com/FeatherHunter/dsh-mattpocock-skills-deck";

const demoOptions = { lang: "zh" as const, selfId: "deck", resolveQr: () => DEMO_QR, repoUrl: REPO };
const base = createBaseUI(React, demoOptions);
const baseEn = createBaseUI(React, { ...demoOptions, lang: "en" as const });

type Ui = typeof base;
type Lang = "zh" | "en";

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  padding: 32,
  maxWidth: 900,
  margin: "0 auto",
  color: "#1f2329",
};

const captionStyle: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.65,
  margin: "0 0 8px",
};

/** A settings-panel header mock: title on the left, actions on the right. */
function HeaderMock({ ui, dark }: { ui: Ui; dark?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 10,
        border: "1px solid " + (dark ? "#3a3f4b" : "#e5e8ee"),
        background: dark ? "#17181c" : "#fff",
        color: dark ? "#e8eaed" : "#1f2329",
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>插件设置</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>页头右组 · ActionCluster（B 静默簇）</div>
      </div>
      <ui.ActionCluster />
    </div>
  );
}

/** Default cluster entries, optionally forced into one visual state for the demo. */
function clusterItems(ui: Ui, lang: Lang, state?: string, disabled = false): ActionClusterItem[] {
  return [
    {
      id: "contact",
      icon: ui.clusterIcons.contact(16),
      label: resolveText("contact", lang),
      tip: resolveText("contactTip", lang),
      onClick: () => ui.openContactModal(),
      disabled,
      className: state,
    },
    {
      id: "star",
      icon: ui.clusterIcons.star(16),
      label: resolveText("starLabel", lang),
      tip: resolveText("starTip", lang),
      href: REPO,
      disabled,
      className: state,
    },
    {
      id: "issue",
      icon: ui.clusterIcons.issue(16),
      label: resolveText("issueLabel", lang),
      tip: resolveText("issueTip", lang),
      href: REPO + "/issues",
      disabled,
      className: state,
    },
  ];
}

const STATES: Array<{ label: string; state?: string; disabled?: boolean }> = [
  { label: "默认" },
  { label: "悬浮：动效 + 柔光", state: "is-hover" },
  { label: "按下：收紧", state: "is-active" },
  { label: "focus：键盘环", state: "is-focus" },
  { label: "disabled：去饱和", disabled: true },
];

/** Five visual states, forced through the documented is-* hooks, light + dark. */
function StateShowcase({ ui, lang }: { ui: Ui; lang: Lang }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {[false, true].map((dark) => (
        <div
          key={dark ? "dark" : "light"}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            gap: 10,
            padding: 12,
            borderRadius: 10,
            border: "1px solid " + (dark ? "#3a3f4b" : "#e5e8ee"),
            background: dark ? "#17181c" : "#fff",
            color: dark ? "#e8eaed" : "#1f2329",
          }}
        >
          {STATES.map((entry) => (
            <div key={entry.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, opacity: 0.62, marginBottom: 10 }}>{entry.label}</div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <ui.ActionCluster items={clusterItems(ui, lang, entry.state, entry.disabled)} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Static proof of the three hover copies: HoverTip pinned open with
 * visible, so a screenshot can review the wording and the pill styling.
 */
function TipShowcase({ ui, lang }: { ui: Ui; lang: Lang }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 56, paddingTop: 56 }}>
      <div>
        <ui.HoverTip content={resolveText("contactTip", lang)} visible>
          <ui.ContactButton size={18} tip="" />
        </ui.HoverTip>
      </div>
      <div>
        <ui.HoverTip content={resolveText("starTip", lang)} visible>
          <ui.StarButton size={18} tip="" />
        </ui.HoverTip>
      </div>
      <div>
        <ui.HoverTip content={resolveText("issueTip", lang)} visible>
          <ui.IssueButton size={18} tip="" />
        </ui.HoverTip>
      </div>
    </div>
  );
}

function App() {
  // ?lang=en renders the English copy straight away (screenshots / review).
  const [english, setEnglish] = useState(
    () => new URLSearchParams(window.location.search).get("lang") === "en",
  );
  const ui = english ? baseEn : base;
  const lang: Lang = english ? "en" : "zh";
  const overflowItems: ActionClusterItem[] = [
    ...clusterItems(ui, lang),
    {
      id: "docs",
      icon: ui.clusterIcons.issue(16),
      label: english ? "Feedback survey" : "反馈问卷",
      tip: english ? "30-second survey" : "30 秒问卷，帮我们改进",
      href: "https://github.com/FeatherHunter/featherhunter-plugin-manage",
    },
  ];
  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>dsh-featherhunter-plugin-base</h1>
      <p style={{ fontSize: 14, opacity: 0.7, marginTop: 0 }}>
        演示：ActionCluster（票 03）——一个容器、N 枚独立彩色按钮；联系弹窗（票 04）、作者插件卡（票
        06）。页头右组默认 16px 图标、按钮间距 4、无外框无分隔线，容器本身不响应 hover；悬浮出共用
        HoverTip 文案并带同色柔光与动效，按下收紧，Tab 出 focus 环，disabled 去饱和。
      </p>

      <section style={{ marginTop: 24 }}>
        <p style={captionStyle}>页头右组：B 静默簇（浅色 / 深色跟随 currentColor）</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <HeaderMock ui={ui} />
          <HeaderMock ui={ui} dark />
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <p style={captionStyle}>五种状态（浅色 / 深色；用 is-* 钩子定格，真机由 hover / 按下 / Tab / disabled 触发）</p>
        <StateShowcase ui={ui} lang={lang} />
      </section>

      <section style={{ marginTop: 24 }}>
        <p style={captionStyle}>尺寸三档（14 / 16 / 18，默认 16；按钮 = 图标 + 12）</p>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <ui.ActionCluster size={14} />
          <ui.ActionCluster size={16} />
          <ui.ActionCluster size={18} />
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <p style={captionStyle}>第 4 项溢出：maxVisible=3 时收进「更多操作 ⋯」菜单</p>
        <ui.ActionCluster items={overflowItems} maxVisible={3} />
      </section>

      <section style={{ marginTop: 24 }}>
        <p style={captionStyle}>旧控件兼容一版：ActionGroup（1px 托盘）与 ActionButtons（线稿图标）</p>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <ui.ActionGroup size={16} />
          <ui.ActionButtons size={16} />
        </div>
      </section>

      <section style={{ marginTop: 8 }}>
        <p style={captionStyle}>悬浮文案（此处用 visible 常驻展示，真机是鼠标悬停 / 键盘聚焦出）</p>
        <TipShowcase ui={ui} lang={lang} />
      </section>

      <section style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "24px 0" }}>
        <button
          type="button"
          onClick={() => ui.openContactModal()}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #d0d5dd", cursor: "pointer" }}
        >
          打开弹窗（零参，用内置基线）
        </button>
        <button
          type="button"
          onClick={() => ui.openContactModal({ columns: 2, fallbackUrl: "https://example.com/contact" })}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #d0d5dd", cursor: "pointer" }}
        >
          打开弹窗（2 列 / 自定义兜底链接）
        </button>
        <button
          type="button"
          onClick={() => setEnglish((value) => !value)}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #d0d5dd", cursor: "pointer" }}
        >
          切换语言：{english ? "English" : "中文"}
        </button>
      </section>

      <ui.ContactRow hint="设置面板里的一行" />

      <section style={{ marginTop: 24 }}>
        <p style={captionStyle}>作者插件卡：默认排除自己（{english ? "4 rows" : "4 项"}）</p>
        <ui.AuthorPlugins />
      </section>

      <section style={{ marginTop: 24 }}>
        <p style={captionStyle}>
          作者插件卡：showSelf（{english ? "5 rows" : "含自己在内 5 项"}）
        </p>
        <ui.AuthorPlugins showSelf maxRows={5} />
      </section>

      <p style={{ fontSize: 12, opacity: 0.55, marginTop: 24 }}>
        注：内置基线的二维码数据在票 03 填充、远程清单在票 05 接入；本 demo 用占位二维码展示卡片排版，
        插件卡数据来自 manifest.plugins 的定稿 5 条。
      </p>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("demo: missing #root");
createRoot(rootElement).render(<App />);
