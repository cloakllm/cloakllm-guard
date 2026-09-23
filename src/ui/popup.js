// Popup: what the log actually says, in one glance.
//
// This is the pilot surface. "37 near-misses this month, 31 heeded, mostly
// IBANs" is the sentence the whole findings log exists to produce -- and it
// says it without a single prompt having been collected.
import { labelFor } from '../shared/labels.js';
import { HELP } from '../shared/support.js';

const $ = (id) => document.getElementById(id);

const ask = (message) => new Promise((resolve) => {
  chrome.runtime.sendMessage(message, (r) => {
    if (chrome.runtime.lastError) { resolve(null); return; }
    resolve(r);
  });
});

function say(text) {
  $('status').textContent = text;
  if (text) setTimeout(() => { $('status').textContent = ''; }, 2600);
}

const dayOf = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch { return null; }
};

function render(s) {
  // "Could not ask" and "asked, nothing to report" are different facts, and
  // until 2026-09-23 they rendered identically: a worker that never answered
  // produced the "Nothing caught yet. Guard is watching your AI chats" card.
  // So a broken extension reassured the person it was protecting them. That
  // is the same fail-open the content script was fixed for -- open on the
  // ACTION is fine, open on the INFORMATION is not -- and it is worse here,
  // because this surface exists precisely to answer "is it working?".
  if (!s) {
    // From the shared constant, so the popup cannot point somewhere
    // different from the dialog and the console messages.
    $('unreachableHelp').href = HELP.unreachable;
    $('unreachable').hidden = false;
    $('empty').hidden = true;
    $('summary').hidden = true;
    $('export').disabled = true;
    $('clear').disabled = true;
    $('period').textContent = '';
    return;
  }

  $('unreachable').hidden = true;

  if (s.shown === 0) {
    $('empty').hidden = false;
    $('summary').hidden = true;
    $('export').disabled = true;
    $('clear').disabled = true;
    return;
  }

  $('empty').hidden = true;
  $('summary').hidden = false;
  $('export').disabled = false;
  $('clear').disabled = false;

  $('shown').textContent = s.shown;
  $('shownLabel').textContent = s.shown === 1 ? 'near-miss caught' : 'near-misses caught';
  $('heeded').textContent = `${s.heeded_pct}%`;
  $('heededText').textContent =
    `heeded \u2014 ${s.heeded} of ${s.shown} ${s.shown === 1 ? 'warning was' : 'warnings were'} acted on`;

  const cats = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]);
  $('cats').replaceChildren(...cats.map(([cat, n]) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    // labelFor gives prose; capitalise the first letter for a list.
    const label = labelFor(cat, n).replace(/^an? /, '').replace(/^(\d+) /, '');
    name.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    const count = document.createElement('span');
    count.className = 'n';
    count.textContent = n;
    li.append(name, count);
    return li;
  }));

  const from = s.first && dayOf(s.first);
  const to = s.last && dayOf(s.last);
  $('period').textContent = from && to
    ? (from === to ? `All on ${from}` : `${from} to ${to}`)
    : '';
}

// --- actions --------------------------------------------------------------

$('export').addEventListener('click', async () => {
  const out = await ask({ type: 'cloakllm:export' });
  if (!out || !out.entries) { say('Nothing to export'); return; }

  // The filename prefix is load-bearing: cloakllm-verifier reads only
  // audit_*.jsonl and silently ignores anything else.
  const url = URL.createObjectURL(new Blob([out.content], { type: 'application/x-ndjson' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = out.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  say(`Exported ${out.entries} entries`);
});

$('clear').addEventListener('click', async () => {
  // No confirmation dialog: this is the person's own record of their own
  // near-misses, not evidence about them, and making it hard to delete would
  // quietly turn a coach into a cop.
  await ask({ type: 'cloakllm:clear' });
  render(await ask({ type: 'cloakllm:stats' }));
  say('Cleared');
});

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

render(await ask({ type: 'cloakllm:stats' }));
