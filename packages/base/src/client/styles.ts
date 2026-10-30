/** Style element id shared by every widget of this package. */
export const BASE_STYLE_ID = "dsh-base-style";

/**
 * One stylesheet for the whole package, injected once per document.
 *
 * The modal mirrors a README-in-a-dialog: 800px panel, centered heading,
 * centered card grid (four columns at most) and 10-13px type. Narrow screens
 * collapse the grid through media queries because the inline column count only
 * expresses the data-driven part of the layout.
 */
export const BASE_CSS = [
  // --- settings panel widgets -------------------------------------------------
  ".dsh-base-contact-button{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid rgba(127,127,127,.28);border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1.4;cursor:pointer;transition:background .15s ease,border-color .15s ease}",
  ".dsh-base-contact-button:hover{background:rgba(127,127,127,.12);border-color:rgba(127,127,127,.45)}",
  ".dsh-base-contact-button:focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}",
  ".dsh-base-contact-button__icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}",
  ".dsh-base-contact-button__icon svg{display:block}",
  ".dsh-base-contact-button__label{white-space:nowrap}",
  ".dsh-base-contact-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(127,127,127,.16)}",
  ".dsh-base-contact-row:last-child{border-bottom:0}",
  ".dsh-base-contact-row__label{font-size:13px;opacity:.85}",
  ".dsh-base-contact-row__hint{font-size:12px;opacity:.55}",
  // --- dialog shell -----------------------------------------------------------
  ".dsh-base-modal{position:fixed;inset:0;margin:auto;width:min(800px,92vw);max-width:min(800px,92vw);max-height:88vh;padding:0;border:0;border-radius:18px;background:#fff;color:#1f2329;box-shadow:0 24px 64px rgba(0,0,0,.24);overflow:hidden}",
  ".dsh-base-modal[open]{display:block}",
  ".dsh-base-modal::backdrop{background:rgba(0,0,0,.45)}",
  ".dsh-base-modal__panel{display:flex;flex-direction:column;max-height:88vh}",
  ".dsh-base-modal__header{position:relative;padding:22px 56px 8px;text-align:center}",
  ".dsh-base-modal__heading{display:flex;flex-direction:column;align-items:center;gap:2px}",
  ".dsh-base-modal__kicker{display:block;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#86909c}",
  ".dsh-base-modal__title{margin:0;font-size:18px;font-weight:600;line-height:1.4;letter-spacing:.01em}",
  ".dsh-base-modal__close{position:absolute;top:14px;right:14px;width:32px;height:32px;padding:0;border:0;border-radius:10px;background:transparent;color:#86909c;font:inherit;font-size:20px;line-height:1;cursor:pointer;transition:background .15s ease,color .15s ease}",
  ".dsh-base-modal__close:hover{background:rgba(0,0,0,.06);color:#1f2329}",
  ".dsh-base-modal__close:focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}",
  ".dsh-base-modal__welcome{margin:4px auto 16px;padding:0 24px;font-size:13px;line-height:1.75;color:#4e5969;text-align:center;max-width:640px}",
  // --- scrollable body + card grid -------------------------------------------
  ".dsh-base-modal__body{flex:1 1 auto;min-height:0;padding:0 24px 18px;overflow:auto;overscroll-behavior:contain}",
  ".dsh-base-modal__grid{display:grid;grid-template-columns:repeat(var(--dsh-base-columns,4),minmax(0,1fr));gap:14px;align-items:start}",
  ".dsh-base-modal__card{display:flex;flex-direction:column;align-items:stretch;gap:6px;min-width:0;padding:14px 12px;border:1px solid rgba(127,127,127,.2);border-radius:14px;background:#fff;text-align:center}",
  ".dsh-base-modal__card--expired{background:#fffaf3;border-color:rgba(180,83,9,.28)}",
  ".dsh-base-modal__card-title{margin:0;font-size:13px;font-weight:600;line-height:1.4}",
  ".dsh-base-modal__card-subtitle{display:inline-block;align-self:center;margin:0;padding:2px 6px;border:0;border-radius:6px;background:transparent;color:#86909c;font:inherit;font-size:11px;line-height:1.5;cursor:pointer;transition:background .15s ease,color .15s ease}",
  ".dsh-base-modal__card-subtitle:hover{background:rgba(127,127,127,.1);color:#4e5969}",
  ".dsh-base-modal__card-subtitle[data-copied='true']{color:#4d6bfe}",
  ".dsh-base-modal__card-subtitle:focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}",
  ".dsh-base-modal__qr{width:100%;height:auto;min-height:150px;padding:6px;border-radius:8px;background:#fff;object-fit:contain;image-rendering:pixelated}",
  ".dsh-base-modal__card-note{margin-top:2px;font-size:10.5px;line-height:1.5;color:#86909c}",
  ".dsh-base-modal__card-expired{margin-top:2px;font-size:10.5px;line-height:1.5;color:#b45309}",
  ".dsh-base-modal__card-link{align-self:center;margin-top:4px;padding:6px 10px;border:1px solid rgba(77,107,254,.35);border-radius:8px;color:#4d6bfe;font-size:11.5px;line-height:1.4;text-decoration:none;word-break:break-all}",
  ".dsh-base-modal__card-link:hover{background:rgba(77,107,254,.08)}",
  ".dsh-base-modal__card-link:focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}",
  // --- footer hint ------------------------------------------------------------
  ".dsh-base-modal__footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 10px;padding:0 24px 18px;font-size:11.5px;line-height:1.6;color:#86909c;text-align:center}",
  ".dsh-base-modal__mobile-hint{display:none}",
  // --- author plugin card (settings panel) ------------------------------------
  // Card: 1px border, 10px radius, layer-2 background, rows are whole anchors.
  ".dsh-base-plugins{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06))}",
  ".dsh-base-plugins__title{display:flex;align-items:center;gap:6px;margin:0;font-size:13px;font-weight:600;line-height:1.4;color:inherit}",
  ".dsh-base-plugins__title-icon{display:inline-flex;flex:0 0 auto;align-items:center;color:var(--dsw-alias-label-secondary,#86909c)}",
  ".dsh-base-plugins__title-icon svg{display:block}",
  ".dsh-base-plugins__list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}",
  ".dsh-base-plugins__item{min-width:0}",
  ".dsh-base-plugins__row{display:flex;align-items:center;gap:8px;min-width:0;padding:7px 4px;border-radius:6px;color:inherit;text-decoration:none;transition:background .15s ease}",
  ".dsh-base-plugins__row:hover{background:rgba(127,127,127,.1)}",
  ".dsh-base-plugins__row:focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}",
  ".dsh-base-plugins__icon{display:inline-flex;flex:0 0 auto;align-items:center;color:var(--dsw-alias-label-secondary,#86909c)}",
  ".dsh-base-plugins__icon svg{display:block}",
  ".dsh-base-plugins__name{flex:0 0 auto;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);font-size:12px;font-weight:650;line-height:1.5;white-space:nowrap;color:inherit}",
  ".dsh-base-plugins__desc{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#86909c)}",
  ".dsh-base-plugins__ext{display:inline-flex;flex:0 0 auto;align-items:center;color:var(--dsw-alias-label-tertiary,#a9aeb8)}",
  ".dsh-base-plugins__ext svg{display:block}",
  // --- responsive grid: 4 columns -> 2 under 720px -> 1 under 480px -----------
  "@media (max-width:719px){.dsh-base-modal__grid{grid-template-columns:repeat(2,minmax(0,1fr))}}",
  "@media (max-width:479px){.dsh-base-modal__grid{grid-template-columns:minmax(0,1fr)}}",
  "@media (max-width:719px){.dsh-base-modal__mobile-hint{display:inline}}",
  "@media (prefers-reduced-motion:reduce){.dsh-base-modal__close,.dsh-base-modal__card-subtitle,.dsh-base-contact-button,.dsh-base-plugins__row{transition:none}}",
].join("\n");

/** Inject the stylesheet once per document. */
export function ensureBaseStyles(doc: Document): void {
  if (doc.getElementById(BASE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = BASE_STYLE_ID;
  style.textContent = BASE_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}
