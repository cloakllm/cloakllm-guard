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
  const hosts = [];
  for (const a of ADAPTERS) {
    for (const h of ['chatgpt.com', 'chat.openai.com', 'claude.ai',
      'gemini.google.com', 'copilot.microsoft.com', 'm365.cloud.microsoft']) {
      if (a.matches(h) && !hosts.includes(h)) hosts.push(h);
    }
  }
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
    await ask({ type: 'cloakllm:setSettings', patch: { logEnabled: $('logEnabled').checked } });
    say('Saved');
  });
}
renderSites();
