// Cheap synchronous string hash (FNV-1a, 32-bit).
//
// Deliberately NOT crypto. Two reasons: crypto.subtle is async, and the Enter
// handler has to decide whether to block a send *synchronously*, before the
// site's own handler runs. And this is not a security boundary -- it keys a
// local cache and an "already acknowledged" set. Collisions cost at worst one
// redundant warning or one suppressed duplicate.
//
// It is also a privacy property: the hash is what gets kept, never the text.

/**
 * @param {string} str
 * @returns {string} 8-char hex
 */
export function hashText(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619, in 32-bit safe arithmetic
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
