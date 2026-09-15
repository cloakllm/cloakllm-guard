// Per-site adapters.
//
// Isolated here on purpose: PLAN_shadow_ai_monitor.md sec.4a names the
// maintenance treadmill -- vendors reshuffle their frontends without notice --
// as a permanent cost of this tier. Containing it to one file means a breakage
// is a one-file fix, not an archaeology expedition.
//
// SELECTOR PROVENANCE. Every AI chat site except ChatGPT gates its composer
// behind a login, so the selectors below could not be read off a live DOM and
// are INFERRED from each site's known editor technology. Treat them as
// unverified until someone signs in and checks:
//
//   chatgpt   VERIFIED on the live site, 2026-09-11
//   claude    inferred (ProseMirror)  -- needs a live check
//   gemini    inferred (Quill .ql-editor) -- needs a live check
//   copilot   inferred -- needs a live check
//
// That is precisely why `resolveComposer` reports HOW it resolved. Guessing
// well is not the goal; noticing when the guess stopped working is, because
// the worst failure this extension has is silent non-protection.

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
