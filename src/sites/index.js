// Per-site adapters.
//
// Isolated here on purpose: PLAN_shadow_ai_monitor.md sec.4a names the
// maintenance treadmill -- vendors reshuffle their frontends without notice --
// as a permanent cost of this tier. Containing it to one file means a breakage
// is a one-file fix, not an archaeology expedition.
//
// SELECTOR PROVENANCE. Every AI chat site except ChatGPT gates its composer
// behind a login, so these selectors began as INFERENCES from each site's
// known editor technology rather than readings off a live DOM. All four have
// now been checked by someone signed in, but the checks differ in depth and
// the difference matters -- see the locale note below:
//
//   chatgpt   VERIFIED on the live site, 2026-09-11, re-checked 2026-09-20
//   claude    VERIFIED on the live site, 2026-09-20 -- all three composer
//             selectors hit; the send control is
//             button[data-testid="chat-input-send"], aria-label
//             "Send message", type="button", and NOT inside a <form>
//   gemini    VERIFIED on the live site, 2026-09-20 (pass/fail only -- the
//             element attributes were not captured, so the locale note below
//             stands unresolved for this adapter)
//   copilot   VERIFIED on the live site, 2026-09-20 (pass/fail only)
//
// LOCALE RISK, gemini specifically. "Passed" was measured on an English UI,
// and that is not the same as "works". The claude.ai run taught this the
// hard way: reading its OUTPUT -- not its pass/fail -- revealed that every
// send selector we had was an English aria-label, so anyone running the site
// in another language matched nothing and was silently unprotected. The fix
// was to put data-testid first everywhere, because a test id is written by a
// developer and never translated while an aria-label is written for the user
// and always is.
//
// Gemini has no data-testid to put first. Its send control resolves through
// `button.send-button` (a CSS class -- structural, the kind this file
// otherwise avoids) and then `button[aria-label="Send message"]` (English).
// The generic SEND_HINTS behind those are data-testid, type="submit", and
// English aria-label/title -- none of which a localised Angular send button
// is likely to carry. So for a non-English Gemini user, click-path
// protection rests entirely on that one class name.
//
// Copilot is fine by comparison: data-testid first, and a locale-proof
// `form button[type="submit"]` at the back.
//
// To close it, someone with Gemini open needs the send button's real
// attributes -- specifically whether it carries a data-testid or any other
// stable non-translated hook.
//
// That is precisely why `resolveComposer` reports HOW it resolved. Guessing
// well is not the goal; noticing when the guess stopped working is, because
// the worst failure this extension has is silent non-protection.
//
// SEND CONTROLS are resolved the same way, and the same reasoning applies
// twice over: an external review (2026-09-18) found the claude.ai send
// BUTTON was never intercepted at all while Enter was. The cause was not a
// stale selector but a missing `click` listener -- ChatGPT's composer is a
// real <form>, so its button fired `submit` and appeared to work, which
// hid the gap everywhere that isn't a form. See resolveSendTarget below:
// the adapter's selectors are tried first, then SEND_HINTS, which are
// semantic rather than structural so they survive a redesign.

/**
 * @typedef {Object} SiteAdapter
 * @property {string} id
 * @property {(host: string) => boolean} matches
 * @property {string[]} composerSelectors  tried in order, first hit wins
 * @property {string[]} sendButtonSelectors used to resume a send after the
 *   person confirms; clicking the real button is far more reliable than
 *   re-dispatching a synthetic Enter, which arrives with isTrusted false
 */

/** @type {SiteAdapter[]} */
export const ADAPTERS = [
  {
    id: 'chatgpt',
    matches: (host) => host === 'chatgpt.com' || host === 'chat.openai.com',
    composerSelectors: [
      '#prompt-textarea',
      'main form [contenteditable="true"]',
      'form textarea',
    ],
    sendButtonSelectors: [
      'button[data-testid="send-button"]',
      'form button[type="submit"]',
    ],
  },
  {
    id: 'claude',
    matches: (host) => host === 'claude.ai' || host.endsWith('.claude.ai'),
    composerSelectors: [
      'div[contenteditable="true"].ProseMirror',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"]',
    ],
    sendButtonSelectors: [
      // data-testid first, and deliberately. An aria-label is LOCALISED:
      // someone using Claude in French has aria-label="Envoyer le message"
      // and every English label selector below misses them entirely --
      // silent non-protection for anyone not using the product in English.
      // A test id is not translated. Read off the live DOM 2026-09-20.
      'button[data-testid="chat-input-send"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send Message"]',
      'fieldset button[type="submit"]',
    ],
  },
  {
    id: 'gemini',
    matches: (host) => host === 'gemini.google.com',
    composerSelectors: [
      'rich-textarea div.ql-editor[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'rich-textarea [contenteditable="true"]',
    ],
    sendButtonSelectors: [
      'button.send-button',
      'button[aria-label="Send message"]',
    ],
  },
  {
    id: 'copilot',
    matches: (host) => host === 'copilot.microsoft.com'
      || host === 'm365.cloud.microsoft'
      || host === 'www.bing.com',
    composerSelectors: [
      'textarea#userInput',
      'textarea[data-testid="composer-input"]',
      'form textarea',
    ],
    sendButtonSelectors: [
      'button[data-testid="submit-button"]',
      'button[aria-label="Submit"]',
      'form button[type="submit"]',
    ],
  },
];

/** Generic last resort, used when a site's own selectors all miss. */
export const FALLBACK_SELECTORS = [
  '[contenteditable="true"]',
  'textarea',
];

/**
 * Generic ways a send control identifies itself, tried after the adapter's
 * own selectors.
 *
 * Deliberately semantic rather than structural. claude.ai's class names are
 * build-hashed and churn with every deploy; an accessible label does not,
 * because screen readers depend on it. Matching what assistive technology
 * matches is the most stable contract a page offers.
 */
// Ordered by how well each survives translation. A test id is written by
// the developer and never localised; an aria-label is written for the
// user and always is. Someone running Claude in French has
// aria-label="Envoyer le message", so the English hints below would miss
// them completely -- which is silent non-protection, the worst failure
// this extension has, aimed squarely at non-English speakers.
export const SEND_HINTS = [
  '[data-testid*="send" i]',
  '[data-testid*="submit" i]',
  'button[type="submit"]',
  '[aria-label*="send" i]',
  '[title*="send" i]',
];

/**
 * Is this click on something that sends the message?
 *
 * Walks up from the clicked node first: a click almost never lands on the
 * button itself but on an icon or span inside it.
 *
 * @param {any} target the event target
 * @param {SiteAdapter | null} adapter
 * @returns {{ el: any, via: 'site'|'hint'|null }}
 */
export function resolveSendTarget(target, adapter) {
  if (!target || typeof target.closest !== 'function') return { el: null, via: null };
  for (const sel of (adapter && adapter.sendButtonSelectors ? adapter.sendButtonSelectors : [])) {
    const el = target.closest(sel);
    if (el) return { el, via: 'site' };
  }
  for (const sel of SEND_HINTS) {
    const el = target.closest(sel);
    if (el) return { el, via: 'hint' };
  }
  return { el: null, via: null };
}

/** Element-only form of resolveSendTarget. */
export function isSendTarget(target, adapter) {
  return resolveSendTarget(target, adapter).el !== null;
}

/**
 * @param {string} host
 * @returns {SiteAdapter | null}
 */
export function adapterFor(host) {
  return ADAPTERS.find((a) => a.matches(host)) || null;
}

/**
 * Resolve the composer AND report how.
 *
 * `via` is the health signal:
 *   'site'     the adapter's own selector matched -- working as intended
 *   'fallback' the adapter missed and a generic selector caught it. Still
 *              protected, but the adapter has drifted and needs updating
 *   null       nothing matched. NOT protected on this page
 *
 * @param {{ querySelector(sel: string): any }} root
 * @param {SiteAdapter | null} adapter
 * @returns {{ el: any, via: 'site'|'fallback'|null, selector: string|null }}
 */
export function resolveComposer(root, adapter) {
  for (const sel of (adapter ? adapter.composerSelectors : [])) {
    const el = root.querySelector(sel);
    if (el) return { el, via: 'site', selector: sel };
  }
  for (const sel of FALLBACK_SELECTORS) {
    const el = root.querySelector(sel);
    if (el) return { el, via: 'fallback', selector: sel };
  }
  return { el: null, via: null, selector: null };
}

/**
 * Element-only form.
 *
 * Falls back to generic selectors rather than giving up: a missed composer
 * means silent non-protection, so over-scanning is the safer direction.
 */
export function findComposer(root, adapter) {
  return resolveComposer(root, adapter).el;
}

/**
 * Resolve the send button, used to resume a send the person confirmed.
 *
 * @param {{ querySelector(sel: string): any }} root
 * @param {SiteAdapter | null} adapter
 */
export function findSendButton(root, adapter) {
  const selectors = [
    ...(adapter && adapter.sendButtonSelectors ? adapter.sendButtonSelectors : []),
    'form button[type="submit"]',
  ];
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el && !el.disabled) return el;
  }
  return null;
}

/**
 * One-line health verdict for a page, for the startup log.
 *
 * Adapter drift is invisible by nature: the site keeps working, the extension
 * keeps running, and it simply stops seeing what people type. Saying so out
 * loud is the only cheap defence.
 */
export function healthLine(host, adapter, resolution) {
  if (!adapter) {
    return resolution.via
      ? `watching ${host} (no adapter, generic selectors)`
      : `WARNING: on ${host} no composer found -- not protecting this page`;
  }
  if (resolution.via === 'site') return `watching ${host} (adapter: ${adapter.id})`;
  if (resolution.via === 'fallback') {
    return `WARNING: ${adapter.id} adapter selectors all missed on ${host}; `
      + `fell back to "${resolution.selector}". The site layout probably changed `
      + `-- protection is degraded, please report this.`;
  }
  return `WARNING: ${adapter.id} adapter found no composer on ${host} `
    + `-- NOT protecting this page. Please report this.`;
}
