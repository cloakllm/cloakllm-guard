// Per-site adapters.
//
// Isolated here on purpose: PLAN_shadow_ai_monitor.md sec.4a names the
// maintenance treadmill (vendors reshuffle their frontends without notice) as a
// permanent cost of this tier. Containing it to one file means a breakage is a
// one-file fix, not an archaeology expedition.
//
// v0.1 ships one site. M3 adds the rest.

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
 * Resolve the composer element for a site.
 *
 * Falls back to generic selectors rather than giving up: a missed composer
 * means silent non-protection, which is the worst failure this extension has.
 * Returning something generic and over-scanning is the safer direction.
 *
 * @param {{ querySelector(sel: string): any }} root
 * @param {SiteAdapter | null} adapter
 */
export function findComposer(root, adapter) {
  const selectors = [...(adapter ? adapter.composerSelectors : []), ...FALLBACK_SELECTORS];
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
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
