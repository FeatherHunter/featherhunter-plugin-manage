/** Style element id shared by every widget of this package (spec §1: fixed id). */
export const BASE_STYLE_ID = "dsh-base-ui-style";

/**
 * Row skin shared by the settings-panel author-plugin rows and {@link
 * ContactRow}: same padding, radius and hover lift so a row-shaped control
 * looks identical wherever it is placed (spec §4).
 */
function rowSkin(className: string): string[] {
  return [
    "." + className + "{display:flex;align-items:center;gap:8px;min-width:0;padding:7px 4px;border-radius:6px;color:inherit;text-decoration:none;transition:background .15s ease}",
    "." + className + ":hover{background:rgba(127,127,127,.1)}",
    "." + className + ":focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}",
  ];
}

/**
 * One stylesheet for the whole package, injected once per document.
 *
 * Theme colours read the host CSS variables first and fall back to the values
 * shipped with the package, so the widgets match whatever theme the host uses
 * while never rendering unstyled (spec §1, §4, §5).
 *
 * The modal mirrors a README-in-a-dialog: 800px panel, centered heading,
 * centered card grid (four columns at most) and 10-13px type. Narrow screens
 * collapse the grid through media queries because the inline column count only
 * expresses the data-driven part of the layout.
 */
export const BASE_CSS = [
  // --- settings-panel widgets -------------------------------------------------
  // Icon button: 16px line icon by default, transparent background, 6px radius.
  ".dsh-base-contact-button{display:inline-flex;align-items:center;justify-content:center;padding:6px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;line-height:0;cursor:pointer;transition:background .15s ease}",
  ".dsh-base-contact-button:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}",
  ".dsh-base-contact-button:focus-visible{outline:2px solid var(--dsw-alias-link,#4d6bfe);outline-offset:2px}",
  ".dsh-base-contact-button__icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}",
  ".dsh-base-contact-button__icon svg{display:block}",
  // Whole-row version: one <button> with the same row skin as the plugin card.
  ...rowSkin("dsh-base-contact-row"),
  ".dsh-base-contact-row{border:0;background:transparent;font:inherit;text-align:left;cursor:pointer;width:100%;text-decoration:none}",
  ".dsh-base-contact-row__icon{display:inline-flex;flex:0 0 auto;align-items:center;color:var(--dsw-alias-label-secondary,#86909c)}",
  ".dsh-base-contact-row__icon svg{display:block}",
  ".dsh-base-contact-row__label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:1.5}",
  ".dsh-base-contact-row__hint{font-size:12px;color:var(--dsw-alias-label-tertiary,#a9aeb8)}",
  ".dsh-base-contact-row__ext{display:inline-flex;flex:0 0 auto;align-items:center;color:var(--dsw-alias-label-tertiary,#a9aeb8)}",
  ".dsh-base-contact-row__ext svg{display:block}",
  // --- header actions: contact / star / issue --------------------------------
  // Icon-only actions share one skin and the deck line-icon grammar (16px).
  ".dsh-base-icon-action{display:inline-flex;align-items:center;justify-content:center;padding:6px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;line-height:0;text-decoration:none;cursor:pointer;transition:background .15s ease,color .15s ease}",
  ".dsh-base-icon-action:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}",
  ".dsh-base-icon-action:focus-visible{outline:2px solid var(--dsw-alias-link,#4d6bfe);outline-offset:2px}",
  ".dsh-base-icon-action__icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}",
  ".dsh-base-icon-action__icon svg{display:block}",
  // Three separate buttons: 2px apart, no background of their own.
  ".dsh-base-actions{display:inline-flex;flex:0 0 auto;align-items:center;gap:2px}",
  // One container, N independent buttons: the tray only groups the buttons, it
  // never splits them into segments (no dividers, buttons keep their own radius).
  ".dsh-base-actions--group{gap:0;padding:1px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.04))}",
  // --- header action cluster (v2): one container, N independent buttons -------
  // Quiet (default): no frame, no divider, no selected state. Only a button
  // reacts to the pointer; the container itself never answers hover.
  ".dsh-base-cluster{position:relative;display:inline-flex;flex:0 0 auto;align-items:center;gap:var(--dsh-base-cluster-gap,4px);color:inherit}",
  ".dsh-base-cluster--tray{gap:0;padding:1px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.04))}",
  ".dsh-base-cluster__btn{--dsh-base-glow:rgba(127,127,127,.42);position:relative;isolation:isolate;display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;line-height:0;text-decoration:none;cursor:pointer;transition:transform .1s ease}",
  ".dsh-base-cluster__btn::before{content:'';position:absolute;inset:-10px;z-index:0;border-radius:50%;background:radial-gradient(circle at 50% 50%,var(--dsh-base-glow) 0%,transparent 62%);opacity:0;transform:scale(.5);transition:opacity .16s ease,transform .2s ease;pointer-events:none}",
  ".dsh-base-cluster__btn:hover::before,.dsh-base-cluster__btn.is-hover::before,.dsh-base-cluster__btn.is-open::before{opacity:.85;transform:scale(1)}",
  ".dsh-base-cluster__btn:active,.dsh-base-cluster__btn.is-active{transform:translateY(1px) scale(.88)}",
  ".dsh-base-cluster__btn:active::before,.dsh-base-cluster__btn.is-active::before{opacity:.95;transform:scale(1.02)}",
  ".dsh-base-cluster__btn:focus-visible,.dsh-base-cluster__btn.is-focus{outline:2px solid var(--dsw-alias-link,#4d6bfe);outline-offset:2px}",
  ".dsh-base-cluster__btn:disabled{opacity:.38;filter:grayscale(1) saturate(.25);cursor:default}",
  ".dsh-base-cluster__btn:disabled::before{display:none}",
  ".dsh-base-cluster__icon{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;line-height:0}",
  ".dsh-base-cluster__icon svg{display:block;overflow:visible}",
  ".dsh-base-cluster__btn--contact{--dsh-base-glow:rgba(79,139,255,.55)}",
  ".dsh-base-cluster__btn--star{--dsh-base-glow:rgba(255,193,46,.6)}",
  ".dsh-base-cluster__btn--issue{--dsh-base-glow:rgba(255,107,138,.55)}",
  // Hover motion: the icon moves on its own, the button keeps no grey fill.
  // Only the hovered button animates; reduced motion turns every rule off.
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--contact .dsh-base-ico-bob,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--contact .dsh-base-ico-bob{animation:dsh-base-cluster-floaty 2.4s ease-in-out infinite}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--contact .dsh-base-ico-dot,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--contact .dsh-base-ico-dot{animation:dsh-base-cluster-dotpulse 1.2s ease-in-out infinite}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--contact .dsh-base-ico-dot--2,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--contact .dsh-base-ico-dot--2{animation-delay:.18s}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--contact .dsh-base-ico-dot--3,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--contact .dsh-base-ico-dot--3{animation-delay:.36s}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--star .dsh-base-ico-bigstar,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--star .dsh-base-ico-bigstar{animation:dsh-base-cluster-twinkle 1.7s ease-in-out infinite}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--star .dsh-base-ico-halo,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--star .dsh-base-ico-halo{animation:dsh-base-cluster-halo 1.7s ease-in-out infinite}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--star .dsh-base-ico-spark,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--star .dsh-base-ico-spark{animation:dsh-base-cluster-blink 1.3s ease-in-out infinite}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--star .dsh-base-ico-spark--2,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--star .dsh-base-ico-spark--2{animation-delay:.22s}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--star .dsh-base-ico-spark--3,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--star .dsh-base-ico-spark--3{animation-delay:.44s}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--star .dsh-base-ico-spark--4,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--star .dsh-base-ico-spark--4{animation-delay:.66s}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--issue .dsh-base-ico-bubble,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--issue .dsh-base-ico-bubble{animation:dsh-base-cluster-wiggle 1.1s ease-in-out infinite}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--issue .dsh-base-ico-bang,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--issue .dsh-base-ico-bang{animation:dsh-base-cluster-bounce 1.1s ease-in-out infinite}",
  ".dsh-base-cluster__btn:hover .dsh-base-cluster__svg--issue .dsh-base-ico-spark,.dsh-base-cluster__btn.is-hover .dsh-base-cluster__svg--issue .dsh-base-ico-spark{animation:dsh-base-cluster-blink 1.2s ease-in-out .3s infinite}",
  "@keyframes dsh-base-cluster-floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.8px)}}",
  "@keyframes dsh-base-cluster-dotpulse{0%,100%{opacity:.35;transform:scale(.75)}50%{opacity:1;transform:scale(1.18)}}",
  "@keyframes dsh-base-cluster-twinkle{0%,100%{transform:scale(1) rotate(0);filter:brightness(1)}45%{transform:scale(1.1) rotate(7deg);filter:brightness(1.2)}}",
  "@keyframes dsh-base-cluster-halo{0%,100%{opacity:.3;transform:scale(.9)}50%{opacity:.85;transform:scale(1.1)}}",
  "@keyframes dsh-base-cluster-blink{0%,100%{opacity:.18;transform:scale(.55)}50%{opacity:1;transform:scale(1.15)}}",
  "@keyframes dsh-base-cluster-wiggle{0%,100%{transform:rotate(0)}25%{transform:rotate(-5deg)}70%{transform:rotate(5deg)}}",
  "@keyframes dsh-base-cluster-bounce{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-1.6px) scale(1.05)}}",
  // Overflow menu: entries past maxVisible collapse into this popover.
  ".dsh-base-cluster__menu{position:absolute;top:calc(100% + 6px);right:0;z-index:2147482000;display:flex;flex-direction:column;gap:2px;min-width:170px;padding:6px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:0 12px 32px rgba(0,0,0,.18)}",
  ".dsh-base-cluster__menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12.5px;line-height:1.5;text-align:left;text-decoration:none;cursor:pointer}",
  ".dsh-base-cluster__menu-item:hover{background:rgba(127,127,127,.12)}",
  ".dsh-base-cluster__menu-item:focus-visible{outline:2px solid var(--dsw-alias-link,#4d6bfe);outline-offset:-2px}",
  ".dsh-base-cluster__menu-item:disabled{opacity:.38;cursor:default}",
  ".dsh-base-cluster__menu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  "@media (prefers-reduced-motion:reduce){.dsh-base-cluster__btn,.dsh-base-cluster__btn::before,.dsh-base-cluster__btn svg *{animation:none!important;transition:none!important}}",
  // --- hover tooltip (deck-style): dark one-liner above the trigger ----------
  ".dsh-base-tip-anchor{display:inline-flex;align-items:center}",
  ".dsh-base-tip{position:fixed;z-index:2147483000;max-width:320px;padding:6px 10px;border-radius:8px;background:rgba(23,23,26,.94);color:#fff;font-size:12px;font-weight:400;line-height:1.55;letter-spacing:0;text-align:left;white-space:normal;overflow-wrap:anywhere;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.28);opacity:0;transform:translateY(2px);transition:opacity .12s ease,transform .12s ease}",
  ".dsh-base-tip[data-side='bottom']{transform:translateY(-2px)}",
  ".dsh-base-tip[data-show='true']{opacity:1;transform:none}",
  // --- dialog shell -----------------------------------------------------------
  ".dsh-base-modal{position:fixed;inset:0;margin:auto;width:min(800px,92vw);max-width:min(800px,92vw);max-height:88vh;padding:0;border:0;border-radius:18px;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1f2329);box-shadow:0 24px 64px rgba(0,0,0,.24);overflow:hidden}",
  ".dsh-base-modal[open]{display:block}",
  ".dsh-base-modal::backdrop{background:rgba(0,0,0,.45)}",
  ".dsh-base-modal__panel{display:flex;flex-direction:column;max-height:88vh}",
  ".dsh-base-modal__header{position:relative;padding:22px 56px 8px;text-align:center}",
  ".dsh-base-modal__heading{display:flex;flex-direction:column;align-items:center;gap:2px}",
  ".dsh-base-modal__kicker{display:block;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#86909c)}",
  ".dsh-base-modal__title{margin:0;font-size:18px;font-weight:600;line-height:1.4;letter-spacing:.01em;color:var(--dsw-alias-label-primary,#1f2329)}",
  ".dsh-base-modal__close{position:absolute;top:14px;right:14px;width:32px;height:32px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-tertiary,#86909c);font:inherit;font-size:20px;line-height:1;cursor:pointer;transition:background .15s ease,color .15s ease}",
  ".dsh-base-modal__close:hover{background:var(--dsw-alias-fill-tsp-secondary,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1f2329)}",
  ".dsh-base-modal__close:focus-visible{outline:2px solid var(--dsw-alias-link,#4d6bfe);outline-offset:2px}",
  ".dsh-base-modal__welcome{margin:4px auto 16px;padding:0 24px;font-size:13px;line-height:1.75;color:var(--dsw-alias-label-secondary,#4e5969);text-align:center;max-width:640px}",
  // --- scrollable body + card grid -------------------------------------------
  ".dsh-base-modal__body{flex:1 1 auto;min-height:0;padding:0 24px 18px;overflow:auto;overscroll-behavior:contain}",
  ".dsh-base-modal__grid{display:grid;grid-template-columns:repeat(var(--dsh-base-columns,4),minmax(0,1fr));gap:14px;align-items:start}",
  ".dsh-base-modal__card{display:flex;flex-direction:column;align-items:stretch;gap:6px;min-width:0;padding:14px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:14px;background:var(--dsw-alias-bg-layer-2,#fff);text-align:center}",
  ".dsh-base-modal__card--expired{background:var(--dsw-alias-state-warn-tertiary,#fffaf3);border-color:var(--dsw-alias-state-warn-secondary,rgba(180,83,9,.28))}",
  ".dsh-base-modal__card-title{margin:0;font-size:13px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,#1f2329)}",
  ".dsh-base-modal__card-subtitle{display:inline-block;align-self:center;margin:0;padding:2px 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#86909c);font:inherit;font-size:11px;line-height:1.5;cursor:pointer;transition:background .15s ease,color .15s ease}",
  ".dsh-base-modal__card-subtitle:hover{background:rgba(127,127,127,.1);color:var(--dsw-alias-label-secondary,#4e5969)}",
  ".dsh-base-modal__card-subtitle[data-copied='true']{color:var(--dsw-alias-link,#4d6bfe)}",
  ".dsh-base-modal__card-subtitle:focus-visible{outline:2px solid var(--dsw-alias-link,#4d6bfe);outline-offset:2px}",
  // The QR surface stays white in every theme: scanners need the printed contrast.
  // border-box keeps the 6px white quiet zone inside the card column: with content-box
  // the image's padding escapes to the right and the QR sits visibly off-centre.
  ".dsh-base-modal__qr{box-sizing:border-box;max-width:100%;width:100%;height:auto;min-height:150px;padding:6px;border-radius:8px;background:#fff;object-fit:contain;image-rendering:pixelated}",
  ".dsh-base-modal__card-note{margin-top:2px;font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#86909c)}",
  ".dsh-base-modal__card-expired{margin-top:2px;font-size:10.5px;line-height:1.5;color:var(--dsw-alias-state-warn-label,#b45309)}",
  ".dsh-base-modal__card-link{align-self:center;margin-top:4px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(77,107,254,.35));border-radius:8px;color:var(--dsw-alias-link,#4d6bfe);font-size:11.5px;line-height:1.4;text-decoration:none;word-break:break-all}",
  ".dsh-base-modal__card-link:hover{background:var(--dsw-alias-fill-tsp-secondary,rgba(77,107,254,.08))}",
  ".dsh-base-modal__card-link:focus-visible{outline:2px solid var(--dsw-alias-link,#4d6bfe);outline-offset:2px}",
  // --- footer hint ------------------------------------------------------------
  ".dsh-base-modal__footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 10px;padding:0 24px 18px;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#86909c);text-align:center}",
  ".dsh-base-modal__mobile-hint{display:none}",
  // --- author plugin card (settings panel) ------------------------------------
  // Card: 1px border, 10px radius, layer-2 background, rows are whole anchors.
  ".dsh-base-plugins{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06))}",
  ".dsh-base-plugins__title{display:flex;align-items:center;gap:6px;margin:0;font-size:13px;font-weight:600;line-height:1.4;color:inherit}",
  ".dsh-base-plugins__title-icon{display:inline-flex;flex:0 0 auto;align-items:center;color:var(--dsw-alias-label-secondary,#86909c)}",
  ".dsh-base-plugins__title-icon svg{display:block}",
  ".dsh-base-plugins__list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}",
  ".dsh-base-plugins__item{min-width:0}",
  // Same row skin function as .dsh-base-contact-row (spec §4).
  ...rowSkin("dsh-base-plugins__row"),
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
  "@media (prefers-reduced-motion:reduce){.dsh-base-modal__close,.dsh-base-modal__card-subtitle,.dsh-base-contact-button,.dsh-base-contact-row,.dsh-base-plugins__row,.dsh-base-icon-action,.dsh-base-tip{transition:none}}",
].join("\n");

/** Inject the stylesheet once per document. */
export function ensureBaseStyles(doc: Document): void {
  if (doc.getElementById(BASE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = BASE_STYLE_ID;
  style.textContent = BASE_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}
