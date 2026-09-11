// Entry point for the vendored detection bundle. Kept deliberately thin: it
// exposes exactly one function, so the extension can never reach further into
// the SDK by accident.
//
// RegexBackend only ever reads config.customPatterns, config.locale and
// config[configKey], so a plain object suffices -- we never construct a real
// ShieldConfig, which is what pulls in fs.lstatSync.
import { RegexBackend } from '../../cloakllm-js/src/backends/regex.js';

/**
 * v0.1 category gates.
 *
 * High-confidence, structurally-anchored categories only. See
 * PLAN_extension_v01.md sec.3: in a warn-UI the SDK's recall-over-precision
 * stance inverts, because a false positive interrupts a person and three of
 * those get the extension uninstalled -- and an uninstalled extension has 0%
 * recall. NER (names/orgs/places) is where false positives live and is not
 * bundled at all in v0.1.
 */
export const V01_CATEGORIES = {
  detectEmails: true,
  detectSsns: true,
  detectCreditCards: true,
  detectIban: true,
  detectApiKeys: true,      // covers API_KEY, AWS_KEY and JWT
  detectPhones: true,
  detectIpAddresses: false, // too noisy around dev chatter
};

/**
 * Build a detector.
 * @param {object} [overrides] per-category overrides plus optional `locale`
 */
export function createDetector(overrides = {}) {
  return new RegexBackend({
    customPatterns: [],
    locale: null,
    ...V01_CATEGORIES,
    ...overrides,
  });
}

/**
 * Run detection.
 *
 * Returns raw detections INCLUDING matched text -- callers must never persist
 * or transmit `.text`. Use summarise() for anything that leaves this module.
 */
export function detect(backend, text) {
  return backend.detect(text, []);
}

/**
 * Reduce detections to a PII-FREE summary: categories, counts and offsets only.
 *
 * This is the ONLY shape allowed to be logged, counted or stored. It carries no
 * matched values, which is what makes "we alert without retaining what you
 * wrote" a checkable claim rather than a promise.
 */
export function summarise(detections) {
  const byCategory = {};
  for (const d of detections) {
    const e = (byCategory[d.category] ||= { count: 0, spans: [] });
    e.count += 1;
    e.spans.push([d.start, d.end]);
  }
  return {
    total: detections.length,
    categories: Object.keys(byCategory).sort(),
    byCategory,
  };
}
