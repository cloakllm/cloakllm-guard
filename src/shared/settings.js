// User settings.
//
// Everything here is device-local and never transmitted. The category gates
// are the ones that matter: PLAN_extension_v01.md sec.3 argues that in a
// warn-UI a false positive costs a person's attention, and three bad warnings
// get the extension uninstalled -- so being able to silence a category that
// is noisy in YOUR work is not a nicety, it is what keeps the tool installed.

export const CATEGORY_ORDER = [
  'CREDIT_CARD', 'IBAN', 'SSN', 'API_KEY', 'AWS_KEY', 'JWT', 'EMAIL', 'PHONE', 'IP_ADDRESS',
];

export const DEFAULTS = {
  // High-confidence structured categories on; the noisy one off.
  categories: {
    CREDIT_CARD: true,
    IBAN: true,
    SSN: true,
    API_KEY: true,
    AWS_KEY: true,
    JWT: true,
    EMAIL: true,
    PHONE: true,
    IP_ADDRESS: false,
  },
  // The findings log. On by default: without it there is no way to know
  // whether the tool works, and it records categories and counts only.
  logEnabled: true,
};

const KEY = 'guard_settings_v1';

let store = {
  async get(k) { return chrome.storage.local.get(k); },
  async set(o) { return chrome.storage.local.set(o); },
};
export function _setStore(s) { store = s; }

/** Load settings, filling any gap from DEFAULTS. */
export async function load() {
  const got = await store.get(KEY);
  const saved = got[KEY] || {};
  return {
    ...DEFAULTS,
    ...saved,
    // Merge per key rather than replacing the map, so a category added in a
    // later version gets its default instead of vanishing for existing users.
    categories: { ...DEFAULTS.categories, ...(saved.categories || {}) },
  };
}

export async function save(partial) {
  const next = { ...(await load()), ...partial };
  await store.set({ [KEY]: next });
  return next;
}

/**
 * Translate settings into the config RegexBackend expects.
 *
 * Several categories share one gate in the SDK (API_KEY, AWS_KEY and JWT all
 * read `detectApiKeys`), so a shared gate stays on while ANY of its categories
 * is enabled, and the unwanted ones are filtered out of the result instead.
 * Silencing one must never silently disable its siblings.
 */
export function toDetectorConfig(settings) {
  const c = settings.categories;
  return {
    detectCreditCards: !!c.CREDIT_CARD,
    detectIban: !!c.IBAN,
    detectSsns: !!c.SSN,
    detectApiKeys: !!(c.API_KEY || c.AWS_KEY || c.JWT),
    detectEmails: !!c.EMAIL,
    detectPhones: !!c.PHONE,
    detectIpAddresses: !!c.IP_ADDRESS,
  };
}

/** Categories the user actually wants reported, for post-filtering. */
export function enabledCategories(settings) {
  return new Set(CATEGORY_ORDER.filter((c) => settings.categories[c]));
}
