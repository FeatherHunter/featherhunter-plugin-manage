/** Style element id shared by every widget of this package. */
export const BASE_STYLE_ID = "dsh-base-style";

export const BASE_CSS = `
.dsh-base-contact-button{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid rgba(127,127,127,.28);border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1.4;cursor:pointer;transition:background .15s ease,border-color .15s ease}
.dsh-base-contact-button:hover{background:rgba(127,127,127,.12);border-color:rgba(127,127,127,.45)}
.dsh-base-contact-button:focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}
.dsh-base-contact-button__icon{font-size:14px;line-height:1}
.dsh-base-contact-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(127,127,127,.16)}
.dsh-base-contact-row:last-child{border-bottom:0}
.dsh-base-contact-row__label{font-size:13px;opacity:.85}
.dsh-base-contact-row__hint{font-size:12px;opacity:.55}
.dsh-base-modal{width:min(1040px,92vw);max-width:min(1040px,92vw);max-height:88vh;padding:0;border:0;border-radius:16px;background:#fff;color:#1f2329;box-shadow:0 24px 64px rgba(0,0,0,.24);overflow:hidden}
.dsh-base-modal::backdrop{background:rgba(0,0,0,.45)}
.dsh-base-modal__panel{display:flex;flex-direction:column;max-height:88vh}
.dsh-base-modal__header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px 12px}
.dsh-base-modal__title{margin:0;font-size:18px;font-weight:600;line-height:1.4}
.dsh-base-modal__close{border:0;background:transparent;font-size:20px;line-height:1;padding:4px 8px;border-radius:8px;cursor:pointer;color:inherit}
.dsh-base-modal__close:hover{background:rgba(0,0,0,.06)}
.dsh-base-modal__body{padding:8px 24px 20px;overflow:auto}
.dsh-base-modal__grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.dsh-base-modal__card{border:1px solid rgba(127,127,127,.2);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:6px;min-width:0}
.dsh-base-modal__card-title{margin:0;font-size:14px;font-weight:600}
.dsh-base-modal__card-subtitle{font-size:12px;opacity:.65}
.dsh-base-modal__card-note{font-size:12px;opacity:.7;line-height:1.5}
.dsh-base-modal__card-expired{font-size:12px;color:#b45309}
.dsh-base-modal__footer{padding:0 24px 20px;font-size:12px;opacity:.7}
.dsh-base-modal__footer a{color:#4d6bfe;text-decoration:none}
.dsh-base-modal__footer a:hover{text-decoration:underline}
.dsh-base-plugins{display:flex;flex-direction:column;gap:10px}
.dsh-base-plugins__title{margin:0;font-size:13px;font-weight:600;opacity:.8}
.dsh-base-plugins__list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.dsh-base-plugins__item{display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:1.5}
.dsh-base-plugins__name{font-weight:600;color:inherit;text-decoration:none}
.dsh-base-plugins__name:hover{text-decoration:underline}
.dsh-base-plugins__desc{font-size:12px;opacity:.7}
@media (max-width:719px){.dsh-base-modal__grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:479px){.dsh-base-modal__grid{grid-template-columns:minmax(0,1fr)}}
`;

/** Inject the stylesheet once per document. */
export function ensureBaseStyles(doc: Document): void {
  if (doc.getElementById(BASE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = BASE_STYLE_ID;
  style.textContent = BASE_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}
