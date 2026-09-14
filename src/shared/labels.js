// Human-readable category labels.
//
// The warning a person reads names the KIND of thing found -- never the thing
// itself. "CREDIT_CARD" is a machine label; someone mid-sentence needs "a
// credit card number". This module is the only place category names become
// prose, which also means the rendering path never has access to a value.

const LABELS = {
  EMAIL: ['an email address', 'email addresses'],
  SSN: ['a social security number', 'social security numbers'],
  CREDIT_CARD: ['a credit card number', 'credit card numbers'],
  IBAN: ['a bank account number (IBAN)', 'bank account numbers (IBAN)'],
  PHONE: ['a phone number', 'phone numbers'],
  IP_ADDRESS: ['an IP address', 'IP addresses'],
  API_KEY: ['an API key', 'API keys'],
  AWS_KEY: ['an AWS access key', 'AWS access keys'],
  JWT: ['an access token (JWT)', 'access tokens (JWT)'],
};

/**
 * @param {string} category
 * @param {number} count
 * @returns {string}
 */
export function labelFor(category, count = 1) {
  const pair = LABELS[category];
  if (!pair) return count === 1 ? `a ${category.toLowerCase()}` : `${category.toLowerCase()} values`;
  return count === 1 ? pair[0] : `${count} ${pair[1]}`;
}

/**
 * Build the one-line summary sentence.
 *
 * Takes ONLY categories and counts. It is not possible to pass a matched
 * value through this function, which is the point.
 *
 * @param {string[]} categories
 * @param {Record<string, {count: number}>} byCategory
 * @returns {string}
 */
export function describe(categories, byCategory) {
  const parts = categories.map((c) => labelFor(c, byCategory[c] ? byCategory[c].count : 1));
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}
