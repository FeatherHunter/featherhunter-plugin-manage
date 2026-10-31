// @vitest-environment jsdom
import { act } from "react";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE_CSS, BASE_STYLE_ID, createBaseUI } from "../../src/client/index";
import { resetClientDom } from "./helpers";

/**
 * The 2026-10-30 finalised order (contact/plugins.json). Data order is the
 * source of truth: the widget never reorders by name or by what the host
 * happens to install.
 */
const FINAL_ORDER = [
  "dsh-mattpocock-skills-deck",
  "dsh-prompt",
  "dsh-opencode-palette",
  "dsh-im-companion",
  "ilife",
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetClientDom();
  document.documentElement.lang = "zh-CN";
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  restoreNavigatorLanguages();
});

function rowNames(): string[] {
  return Array.from(container.querySelectorAll(".dsh-base-plugins__name")).map(
    (node) => node.textContent ?? "",
  );
}

function titleText(): string {
  return container.querySelector(".dsh-base-plugins__title-text")?.textContent ?? "";
}

function descOf(name: string): string {
  const rows = Array.from(container.querySelectorAll(".dsh-base-plugins__item"));
  const row = rows.find(
    (item) => item.querySelector(".dsh-base-plugins__name")?.textContent === name,
  );
  return row?.querySelector(".dsh-base-plugins__desc")?.textContent ?? "";
}

/** jsdom keeps navigator.languages on the prototype; shadow it per test. */
function stubNavigatorLanguages(languages: readonly string[]): void {
  Object.defineProperty(navigator, "languages", { configurable: true, value: languages });
}

function restoreNavigatorLanguages(): void {
  delete (navigator as unknown as { languages?: unknown }).languages;
}

function render(ui: ReturnType<typeof createBaseUI>, props: Record<string, unknown> = {}): void {
  act(() => root.render(React.createElement(ui.AuthorPlugins, props)));
}

describe("author plugin card selection", () => {
  it("shows the five finalised plugins in order when no host plugin is set", () => {
    render(createBaseUI(React, { lang: "zh" }));

    expect(rowNames()).toEqual(FINAL_ORDER);
  });

  it("drops the host plugin when selfId is configured", () => {
    render(createBaseUI(React, { lang: "zh", selfId: "deck" }));

    expect(rowNames()).toEqual([
      "dsh-prompt",
      "dsh-opencode-palette",
      "dsh-im-companion",
      "ilife",
    ]);
  });

  it("lets a widget instance override selfId", () => {
    render(createBaseUI(React, { lang: "zh" }), { selfId: "palette" });

    expect(rowNames()).toEqual([
      "dsh-mattpocock-skills-deck",
      "dsh-prompt",
      "dsh-im-companion",
      "ilife",
    ]);
  });

  it("can include the host plugin explicitly with showSelf", () => {
    render(createBaseUI(React, { lang: "zh", selfId: "deck", showSelf: true }));

    expect(rowNames()).toEqual(FINAL_ORDER);
  });

  it("caps the rows with maxRows", () => {
    render(createBaseUI(React, { lang: "zh" }), { maxRows: 2 });

    expect(rowNames()).toEqual(["dsh-mattpocock-skills-deck", "dsh-prompt"]);
  });
});
describe("author plugin card rows", () => {
  it("opens the repository in a new tab with opener protection", () => {
    render(createBaseUI(React, { lang: "zh" }));

    const first = container.querySelector<HTMLAnchorElement>(".dsh-base-plugins__row");
    expect(first?.getAttribute("href")).toBe(
      "https://github.com/FeatherHunter/dsh-mattpocock-skills-deck",
    );
    expect(first?.getAttribute("target")).toBe("_blank");
    expect(first?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("derives the GitHub URL when the manifest carries no explicit url", () => {
    const plugin = {
      id: "custom",
      order: 10,
      verifiedAt: "2026-10-30",
      name: "dsh-custom",
      repo: "FeatherHunter/dsh-custom",
      desc: { zh: "自定义插件。", en: "A custom plugin." },
    };
    render(createBaseUI(React, { lang: "zh" }), { plugins: [plugin] });

    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/FeatherHunter/dsh-custom",
    );
  });

  it("renders icon + name + one-line description + external-link icon per row", () => {
    render(createBaseUI(React, { lang: "zh", selfId: "deck" }));

    const rows = container.querySelectorAll(".dsh-base-plugins__item");
    expect(rows).toHaveLength(4);
    for (const row of Array.from(rows)) {
      expect(row.querySelector(".dsh-base-plugins__icon svg")).not.toBeNull();
      expect(row.querySelector(".dsh-base-plugins__name")?.textContent).toBeTruthy();
      expect(row.querySelector(".dsh-base-plugins__desc")?.textContent).toBeTruthy();
      expect(row.querySelector(".dsh-base-plugins__ext svg")).not.toBeNull();
    }
    const prompt = Array.from(rows).find(
      (row) => row.querySelector(".dsh-base-plugins__name")?.textContent === "dsh-prompt",
    );
    expect(prompt?.querySelector(".dsh-base-plugins__desc")?.textContent).toBe(
      "经常反复重复的模板化提示词，存成自定义模板，选中后直接注入，不再需要耗费精力。",
    );
    expect(prompt?.querySelector(".dsh-base-plugins__icon svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("renders the card title with the grid icon", () => {
    render(createBaseUI(React, { lang: "zh" }));

    const icon = container.querySelector(".dsh-base-plugins__title .dsh-base-plugins__title-icon svg");
    expect(icon?.getAttribute("width")).toBe("14");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".dsh-base-plugins__title")?.textContent).toContain(
      "作者的其他插件",
    );
  });
});
describe("author plugin card empty state", () => {
  it("renders no container when the plugin list is empty", () => {
    render(createBaseUI(React, { lang: "zh" }), { plugins: [] });

    expect(container.innerHTML).toBe("");
  });

  it("renders no container when only the host plugin is left", () => {
    const deck = {
      id: "deck",
      order: 10,
      verifiedAt: "2026-10-30",
      name: "dsh-mattpocock-skills-deck",
      repo: "FeatherHunter/dsh-mattpocock-skills-deck",
      desc: { zh: "作者自己的插件。", en: "The author's own plugin." },
    };
    render(createBaseUI(React, { lang: "zh", selfId: "deck" }), { plugins: [deck] });

    expect(container.innerHTML).toBe("");
  });

  it("renders no container when maxRows is zero", () => {
    render(createBaseUI(React, { lang: "zh" }), { maxRows: 0 });

    expect(container.innerHTML).toBe("");
  });
});

describe("author plugin card language", () => {
  it("renders the English title and descriptions for lang en", () => {
    render(createBaseUI(React, { lang: "en" }));

    expect(titleText()).toBe("More plugins by the author");
    expect(descOf("dsh-prompt")).toBe(
      "The boilerplate prompts you keep retyping, saved as custom templates and injected on selection — no more wasted effort.",
    );
  });

  it("lets one widget override the language of the UI instance", () => {
    render(createBaseUI(React, { lang: "zh" }), { lang: "en" });

    expect(titleText()).toBe("More plugins by the author");
  });

  it("follows the page html lang when no language is explicit", () => {
    document.documentElement.lang = "en-US";
    render(createBaseUI(React, {}));

    expect(titleText()).toBe("More plugins by the author");
  });

  it("falls back to navigator.languages when the page has no html lang", () => {
    document.documentElement.lang = "";
    stubNavigatorLanguages(["en-US", "en"]);
    render(createBaseUI(React, {}));

    expect(titleText()).toBe("More plugins by the author");
  });

  it("defaults to Chinese when nothing hints at a language", () => {
    document.documentElement.lang = "";
    stubNavigatorLanguages([]);
    render(createBaseUI(React, {}));

    expect(titleText()).toBe("作者的其他插件");
  });

  it("shows WIP markers exactly as the data provides them", () => {
    render(createBaseUI(React, { lang: "zh", selfId: "deck" }));
    expect(descOf("ilife")).toContain("⚠️建设中⚠️");

    render(createBaseUI(React, { lang: "en" }), {
      plugins: [
        {
          id: "wip",
          order: 10,
          verifiedAt: "2026-10-30",
          name: "dsh-wip",
          repo: "FeatherHunter/dsh-wip",
          desc: { zh: "建设中，敬请期待。" },
        },
      ],
    });
    expect(descOf("dsh-wip")).toBe("建设中，敬请期待。");
    expect(rowNames()).toEqual(["dsh-wip"]);
  });
});
describe("author plugin card overrides", () => {
  it("honours a caller title and merges an extra class", () => {
    render(createBaseUI(React, { lang: "zh" }), {
      title: "更多作品",
      className: "my-card",
    });

    expect(titleText()).toBe("更多作品");
    const card = container.querySelector(".dsh-base-plugins");
    expect(card?.classList.contains("my-card")).toBe(true);
    expect(card?.classList.contains("dsh-base-plugins")).toBe(true);
  });

  it("locks the card structure and the row order", () => {
    render(createBaseUI(React, { lang: "zh" }));

    expect(container.innerHTML).toMatchSnapshot();
  });
});
describe("author plugin card styling", () => {
  it("injects the shared stylesheet once when the card renders", () => {
    render(createBaseUI(React, { lang: "zh" }));

    expect(document.getElementById(BASE_STYLE_ID)).not.toBeNull();
    render(createBaseUI(React, { lang: "zh" }));
    expect(document.querySelectorAll("#" + BASE_STYLE_ID)).toHaveLength(1);
  });

  it("ships the card skin rules from the spec", () => {
    for (const rule of [
      ".dsh-base-plugins{",
      "border-radius:10px",
      "--dsw-alias-bg-layer-2",
      ".dsh-base-plugins__title-icon",
      ".dsh-base-plugins__row{",
      "padding:7px 4px",
      ".dsh-base-plugins__row:hover{",
      ".dsh-base-plugins__row:focus-visible{",
      ".dsh-base-plugins__name{",
      "--ds-font-family-code",
      ".dsh-base-plugins__desc{",
      "text-overflow:ellipsis",
      ".dsh-base-plugins__ext{",
    ]) {
      expect(BASE_CSS, rule).toContain(rule);
    }
  });
});
