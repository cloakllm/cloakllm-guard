// Settings page.
import { CATEGORY_ORDER } from '../shared/settings.js';
import { labelFor } from '../shared/labels.js';
import { ADAPTERS } from '../sites/index.js';

const $ = (id) => document.getElementById(id);

const ask = (message) => new Promise((resolve) => {
  chrome.runtime.sendMessage(message, (r) => {
    resolve(chrome.runtime.lastError ? null : r);
  });
});

const NOTES = {
  IP_ADDRESS: 'often appears in ordinary developer chatter',
  PHONE: 'can match other long numbers',
  EMAIL: 'includes your colleagues, not just customers',
};

function say(text) {
  $('saved').textContent = text;
  if (text) setTimeout(() => { $('saved').textContent = ''; }, 2000);
}

function renderCategories(settings) {
  $('cats').replaceChildren(...CATEGORY_ORDER.map((cat) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.htmlFor = `cat-${cat}`;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `cat-${cat}`;
    input.checked = !!settings.categories[cat];
    input.addEventListener('change', async () => {
      const next = await ask({
        type: 'cloakllm:setSettings',
        patch: { categories: { ...settings.categories, [cat]: input.checked } },
      });
      if (next) { settings = next; say('Saved'); }
    });

    const name = document.createElement('span');
    name.className = 'cat-name';
    // labelFor gives "a credit card number"; trim the article for a list.
    const text = labelFor(cat, 1).replace(/^an? /, '');
    name.textContent = text.charAt(0).toUpperCase() + text.slice(1);

    label.append(input, name);
    if (NOTES[cat]) {
      const note = document.createElement('span');
      note.className = 'cat-note';
      note.textContent = NOTES[cat];
      label.append(note);
    }
    li.append(label);
    return li;
  }));
}

function renderSites() {
  // Read the adapters' own host lists. This used to probe `a.matches(h)`
  // against a hard-coded array of six hosts kept right here -- a second
  // source of truth that could drift from the adapters silently, listing a
  // site the extension no longer watches or omitting one it does.
  //
  // `hosts` became an enumerable array on every adapter in v0.12.6 exactly
  // so nothing needs its own copy; this page was still carrying one.
  const hosts = [...new Set(ADAPTERS.flatMap((a) => a.hosts))];
  $('sites').replaceChildren(...hosts.map((h) => {
    const li = document.createElement('li');
    li.textContent = h;
    return li;
  }));
}

const settings = await ask({ type: 'cloakllm:getSettings' });
if (settings) {
  renderCategories(settings);
  $('logEnabled').checked = !!settings.logEnabled;
  $('logEnabled').addEventListener('change', async () => {
    const next = await ask({
      type: 'cloakllm:setSettings', patch: { logEnabled: $('logEnabled').checked },
    });
    // Do not claim "Saved" for a write that was never acknowledged.
    say(next ? 'Saved' : 'Could not save -- the background service did not respond');
  });
} else {
  // The worker never answered. Previously this branch did not exist: the
  // category list simply rendered empty under its heading, and the logging
  // checkbox sat there UNCHECKED -- stating that the findings log was off
  // when the truth was that nothing was known. A settings page that
  // misreports a setting is worse than one that admits it cannot load.
  $('cats').replaceChildren(Object.assign(document.createElement('li'), {
    className: 'cat-note',
    textContent: 'Could not load your settings -- the background service did not respond. '
      + 'Nothing here has been changed. Try disabling and re-enabling the extension.',
  }));
  const box = $('logEnabled');
  box.checked = false;
  box.indeterminate = true;   // unknown, not "off"
  box.disabled = true;
}
renderSites();
