import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createBaseUI } from "../src/client/index";

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

const demoOptions = { lang: "zh" as const, selfId: "deck", resolveQr: () => DEMO_QR };
const base = createBaseUI(React, demoOptions);
const baseEn = createBaseUI(React, { ...demoOptions, lang: "en" as const });

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  padding: 32,
  maxWidth: 760,
  margin: "0 auto",
  color: "#1f2329",
};

function App() {
  const [english, setEnglish] = useState(false);
  const ui = english ? baseEn : base;
  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>dsh-featherhunter-plugin-base</h1>
      <p style={{ fontSize: 14, opacity: 0.7, marginTop: 0 }}>
        演示：联系弹窗（票 04）与作者插件卡（票 06）。弹窗支持零参打开、4 列上限、窄屏降列、Esc / 遮罩 /
        关闭按钮关闭、焦点回归、群号点击复制、过期降级链接；插件卡默认排除自己（deck）后显示 4 项，
        行内是图标 + 包名 + 一句话描述 + 外链图标，整行点击在新标签打开仓库。
      </p>

      <section style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "24px 0" }}>
        <ui.ContactButton />
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
        <p style={{ fontSize: 13, opacity: 0.65, margin: "0 0 8px" }}>
          作者插件卡：默认排除自己（{english ? "4 rows" : "4 项"}）
        </p>
        <ui.AuthorPlugins />
      </section>

      <section style={{ marginTop: 24 }}>
        <p style={{ fontSize: 13, opacity: 0.65, margin: "0 0 8px" }}>
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
