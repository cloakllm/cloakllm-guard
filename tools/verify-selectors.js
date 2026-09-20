/* Paste this into the DevTools console on a logged-in AI chat page.
 *
 * Why it exists: every site except ChatGPT gates its composer behind a
 * login, so the adapter selectors in src/sites/index.js are INFERRED. An
 * external review found the claude.ai send button was never intercepted,
 * and the follow-up check could not be automated -- Claude in Chrome
 * refuses to navigate to claude.ai, gemini.google.com or
 * copilot.microsoft.com, so an agent cannot read those DOMs.
 *
 * Thirty seconds of a human's time closes that. It reads the page and
 * reports nothing anywhere -- no network, no storage, output to the
 * console only.
 *
 * Run it with the composer EMPTY, then again with a few words typed, so
 * the send button is in its enabled state.
 */
(() => {
  const ADAPTERS = {
    'chatgpt.com': {
      composer: ['#prompt-textarea', 'main form [contenteditable="true"]', 'form textarea'],
      send: ['button[data-testid="send-button"]', 'form button[type="submit"]'],
    },
    'chat.openai.com': { alias: 'chatgpt.com' },
    'claude.ai': {
      composer: ['div[contenteditable="true"].ProseMirror',
        'fieldset div[contenteditable="true"]', 'div[contenteditable="true"]'],
      send: ['button[aria-label="Send message"]', 'button[aria-label="Send Message"]',
        'fieldset button[type="submit"]'],
    },
    'gemini.google.com': {
      composer: ['rich-textarea div.ql-editor[contenteditable="true"]',
        'div.ql-editor[contenteditable="true"]', 'rich-textarea [contenteditable="true"]'],
      send: ['button.send-button', 'button[aria-label="Send message"]'],
    },
    'copilot.microsoft.com': {
      composer: ['textarea#userInput', 'textarea[data-testid="composer-input"]', 'form textarea'],
      send: ['button[data-testid="submit-button"]', 'button[aria-label="Submit"]',
        'form button[type="submit"]'],
    },
  };
  const SEND_HINTS = ['[data-testid*="send" i]', '[data-testid*="submit" i]',
    'button[type="submit"]', '[aria-label*="send" i]', '[title*="send" i]'];

  let host = location.host;
  let cfg = ADAPTERS[host];
  if (cfg && cfg.alias) { host = cfg.alias; cfg = ADAPTERS[host]; }
  if (!cfg) { console.log('No adapter for ' + location.host); return; }

  const line = (ok, s) => console.log((ok ? '  OK   ' : '  MISS ') + s);

  console.log('CloakLLM Guard -- selector check on ' + location.host);

  console.log('\nCOMPOSER (adapter selectors, in order)');
  let composer = null;
  for (const sel of cfg.composer) {
    const el = document.querySelector(sel);
    if (el && !composer) composer = el;
    line(!!el, sel);
  }
  if (!composer) console.log('  >> NO COMPOSER FOUND -- this page would not be protected');

  console.log('\nSEND CONTROL (adapter selectors, in order)');
  let send = null;
  for (const sel of cfg.send) {
    const el = document.querySelector(sel);
    if (el && !send) send = el;
    line(!!el, sel + (el && el.disabled ? '   [present but disabled right now]' : ''));
  }

  console.log('\nSEND CONTROL via generic hints (the fallback that ships)');
  for (const sel of SEND_HINTS) {
    // Report present-but-disabled distinctly. The first live run showed
    // every hint as MISS purely because the send button was disabled at
    // that instant, which reads as 'we would not protect this page' when
    // the truth is the opposite. The shipped matcher does not filter on
    // disabled, so neither should the diagnostic.
    const all = [...document.querySelectorAll(sel)];
    const live = all.filter((e) => !e.disabled);
    line(all.length > 0, sel + '   (' + all.length + ' found, ' + live.length + ' enabled)');
    if (!send && all.length) send = live[live.length - 1] || all[all.length - 1];
  }

  if (send) {
    console.log('\nWhat the resolved send control actually looks like:');
    console.log('  tag        ' + send.tagName.toLowerCase());
    console.log('  type       ' + (send.getAttribute('type') || '-'));
    console.log('  aria-label ' + (send.getAttribute('aria-label') || '-'));
    console.log('  data-testid ' + (send.getAttribute('data-testid') || '-'));
    console.log('  in a form? ' + (send.closest('form') ? 'yes' : 'NO -- submit alone would miss it'));
  } else {
    console.log('\n  >> NO SEND CONTROL FOUND by any route. Please report this.');
  }

  console.log('\nPaste the output above into an issue. It contains no message text.');
})();
