// The interstitial.
//
// Rendered inside a closed shadow root: these sites ship aggressive global CSS
// and would otherwise reshape the dialog, and a closed root also keeps page
// scripts from reading it back.
//
// The function signature is the privacy boundary. It accepts categories and
// counts only -- there is no parameter through which a matched value could
// reach the DOM, so "we warn you without keeping what you wrote" is a property
// of the code rather than a promise about it.
import { describe } from '../shared/labels.js';

const HOST_ID = 'cloakllm-guard-root';

/** @type {{ close: (choice: string) => void } | null} */
let active = null;

/** Whether a warning is currently on screen. */
export function isOpen() {
  return active !== null;
}

/**
 * Did this event come from our own dialog?
 *
 * The send gate blocks every click and Enter in the document while a warning
 * is up, so that a second send cannot slip past underneath it. Without this
 * check it also blocked the warning's OWN buttons: the person could neither
 * confirm nor edit, and since the text stayed in the box and every further
 * attempt re-raised the dialog, a flagged message could not be sent at all.
 * That turns the coach into a cop, which is the one thing this must not be.
 *
 * Answerable from outside the shadow tree only because the root is CLOSED:
 * an event raised inside it has already been retargeted to the host element
 * by the time any document-level listener sees it.
 */
export function isOwnEvent(ev) {
  const t = ev && ev.target;
  if (!t) return false;
  if (t.id === HOST_ID) return true;
  return typeof t.closest === 'function' && !!t.closest(`#${HOST_ID}`);
}

/**
 * Show the pre-send warning.
 *
 * @param {{ categories: string[], byCategory: Record<string, {count:number}> }} summary
 * @returns {Promise<'send'|'cancel'>}
 */
export function showWarning(summary) {
  return showDialog({
    title: 'Hold on &mdash; this looks like personal data',
    body: 'What you are about to send appears to contain <span class="found"></span>.',
    found: describe(summary.categories, summary.byCategory),
    note: 'Checked on your machine. Nothing was sent, stored, or reported.',
  });
}

/**
 * Show the "could not check this" dialog.
 *
 * Added 2026-09-20 after a live run on claude.ai released a message
 * containing a card number with nothing but a console warning to show for
 * it. The old path did `console.warn(...)` and sent -- invisible to anyone
 * who is not looking at DevTools, while the extension carried on reporting
 * itself as watching the page.
 *
 * Fail-open on the ACTION is still right: a broken worker must not brick
 * someone's chat, and "Send anyway" is always one click away. Fail-open on
 * the INFORMATION is not. If we could not check, the person is the only one
 * who can decide, and they cannot decide something nobody told them about.
 *
 * @param {'reloaded'|'unavailable'} reason
 * @returns {Promise<'send'|'cancel'>}
 */
export function showUnavailable(reason) {
  const body = reason === 'reloaded'
    ? 'CloakLLM Guard was updated or restarted, so it could not check this '
      + 'message. <span class="found">Reload this page</span> to start '
      + 'checking again.'
    : 'CloakLLM Guard could not check this message, so it does not know '
      + 'whether it contains personal data.';
  return showDialog({
    title: 'Could not check this message',
    body,
    found: '',
    note: 'Nothing was sent, stored, or reported. You can still send it.',
  });
}

function showDialog({ title, body, found, note }) {
  if (active) return Promise.resolve('cancel');

  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = HOST_ID;
    // Sit above the site's own overlays without joining its stacking games.
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });

    root.innerHTML = `
      <style>
        :host { all: initial; }
        .backdrop {
          position: fixed; inset: 0;
          background: rgba(9, 9, 11, .6);
          backdrop-filter: blur(2px);
          display: flex; align-items: center; justify-content: center;
          font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        }
        .card {
          width: min(440px, calc(100vw - 32px));
          background: #18181b; color: #e4e4e7;
          border: 1px solid #3f3f46; border-radius: 12px;
          box-shadow: 0 24px 48px rgba(0,0,0,.45);
          padding: 20px 22px 18px;
        }
        .tag {
          display: inline-block; font-size: 11px; letter-spacing: .08em;
          text-transform: uppercase; color: #a78bfa; margin-bottom: 10px;
        }
        h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; color: #fafafa; }
        p { margin: 0 0 14px; color: #a1a1aa; }
        .found { color: #fafafa; font-weight: 500; }
        .row { display: flex; gap: 8px; justify-content: flex-end; }
        button {
          font: inherit; padding: 8px 14px; border-radius: 8px; cursor: pointer;
          border: 1px solid transparent;
        }
        /* The SAFE action carries the visual weight. Styling "send anyway" as
           the primary button would advertise the risky path and teach people
           to click through the warning without reading it -- the opposite of
           what a coach-not-cop tool is for. Both are still one click away. */
        .cancel { background: #7c3aed; color: #fff; }
        .cancel:hover { background: #6d28d9; }
        .send { background: transparent; color: #a1a1aa; border-color: #3f3f46; }
        .send:hover { background: #27272a; color: #e4e4e7; }
        button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
        .note { margin: 14px 0 0; font-size: 12px; color: #71717a; }
      </style>
      <div class="backdrop" part="backdrop">
        <div class="card" role="alertdialog" aria-modal="true" aria-labelledby="t">
          <div class="tag">CloakLLM Guard</div>
          <h2 id="t">${title}</h2>
          <p class="body">${body}</p>
          <div class="row">
            <button class="send" type="button">Send anyway</button>
            <button class="cancel" type="button">Let me edit it</button>
          </div>
          <p class="note">${note}</p>
        </div>
      </div>`;

    // textContent, never innerHTML: `found` is the only value derived from
    // what the person wrote (category NAMES and counts, never the matched
    // text), and it is the one place markup injection could matter.
    const slot = root.querySelector('.found');
    if (slot) slot.textContent = found;

    const finish = (choice) => {
      if (!active) return;
      active = null;
      document.removeEventListener('keydown', onKey, true);
      host.remove();
      resolve(choice);
    };

    const onKey = (ev) => {
      if (ev.key !== 'Escape') return;
      // Escape means "I want to keep editing", the safe default.
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish('cancel');
    };

    root.querySelector('.cancel').addEventListener('click', () => finish('cancel'));
    root.querySelector('.send').addEventListener('click', () => finish('send'));
    root.querySelector('.backdrop').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) finish('cancel');
    });
    document.addEventListener('keydown', onKey, true);

    active = { close: finish };
    document.documentElement.appendChild(host);

    // Focus the SAFE action, not the destructive one: a stray Enter while the
    // dialog opens must not become a confirmed send.
    root.querySelector('.cancel').focus();
  });
}
