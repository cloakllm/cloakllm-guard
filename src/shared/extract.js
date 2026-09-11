// Pure text-extraction helpers, deliberately free of DOM globals so they can be
// unit-tested in Node. The content script supplies the objects; nothing here
// touches window, document or chrome.

/** Upper bound on scanned text. Guards against someone pasting a 10 MB file. */
export const MAX_SCAN_CHARS = 200000;

/**
 * Pull plain text out of a clipboard payload.
 * @param {{ getData(type: string): string }} clipboardData
 * @returns {string}
 */
export function textFromPaste(clipboardData) {
  if (!clipboardData || typeof clipboardData.getData !== 'function') return '';
  // text/plain is what the site will actually receive for a normal paste.
  // text/html can carry more, but scanning it would mean scanning markup;
  // the plain projection is what a person sees and sends.
  return clipboardData.getData('text/plain') || '';
}

/**
 * Read the current contents of a composer element.
 *
 * Handles both shapes these sites use: a real <textarea> (`.value`) and a
 * contenteditable div (`.innerText`). innerText, not textContent -- the latter
 * concatenates across block elements and would fuse a line ending straight into
 * the next line, creating digit runs that were never adjacent on screen.
 *
 * @param {{ value?: string, innerText?: string, textContent?: string }} el
 * @returns {string}
 */
export function textFromComposer(el) {
  if (!el) return '';
  if (typeof el.value === 'string') return el.value;
  if (typeof el.innerText === 'string') return el.innerText;
  if (typeof el.textContent === 'string') return el.textContent;
  return '';
}

/**
 * Clamp text to a scannable size.
 *
 * Truncation is a detection risk, not just a perf knob: cutting mid-number
 * could hide the tail of a card. We cut on a whitespace boundary at or before
 * the limit so a split never lands inside a token.
 *
 * @param {string} text
 * @param {number} [limit]
 * @returns {{ text: string, truncated: boolean }}
 */
export function clampForScan(text, limit = MAX_SCAN_CHARS) {
  if (typeof text !== 'string') return { text: '', truncated: false };
  if (text.length <= limit) return { text, truncated: false };
  const slice = text.slice(0, limit);
  const cut = slice.search(/\s\S*$/);
  return { text: cut > 0 ? slice.slice(0, cut) : slice, truncated: true };
}

/**
 * Decide whether a keydown means "send".
 *
 * Enter sends on these sites; Shift+Enter inserts a newline. IME composition
 * must be ignored -- for CJK input, Enter commits the candidate rather than
 * submitting, and treating that as a send would fire on every word.
 *
 * @param {{ key: string, shiftKey?: boolean, isComposing?: boolean }} ev
 * @returns {boolean}
 */
export function isSendKey(ev) {
  if (!ev || ev.key !== 'Enter') return false;
  if (ev.isComposing) return false;
  return !ev.shiftKey;
}
