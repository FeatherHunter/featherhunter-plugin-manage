import React from "react";
import { createRoot } from "react-dom/client";
import { createBaseUI } from "../src/client/index";

const base = createBaseUI(React, { lang: "zh", selfId: "deck", maxRows: 4 });

function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32, maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22 }}>dsh-featherhunter-plugin-base</h1>
      <p style={{ fontSize: 14, opacity: 0.7 }}>
        占位演示（票 01）：三入口可加载，控件与弹窗在票 04/06 完成。
      </p>
      <section style={{ display: "flex", gap: 12, alignItems: "center", margin: "24px 0" }}>
        <base.ContactButton />
      </section>
      <base.ContactRow hint="4 列上限 / 窄屏降列 / Esc 关闭" />
      <div style={{ marginTop: 24 }}>
        <base.AuthorPlugins />
      </div>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("demo: missing #root");
createRoot(rootElement).render(<App />);
