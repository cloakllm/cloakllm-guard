# CloakLLM Guard

A browser extension that catches personal data on its way into an AI chat.

It sits on the AI chat sites you already use. When you paste or press send, it
checks the text **on your machine** and — from M2 onward — warns you before it
goes out. You can always send anyway. It is a seatbelt, not a lock.

**Status: M2 (warning UI).** It now stops a send that carries personal data and
asks. Single site (ChatGPT), no settings screen yet. Plan and milestones:
`../PLAN_extension_v01.md`.

## When it speaks up

Only at **send**. Pasting is scanned but never interrupts you — pasting is not
sending, and you may well paste a record and then edit it down. Warning on both
would mean two interruptions for one mistake.

If the text is clean, the extension does not touch the event at all: no
interception, no risk of breaking a normal message. If it carries something,
the send stops and you choose. "Send anyway" is remembered for that exact text —
edit it and the guard comes back, so confirming one card never quietly covers a
different one pasted later.

## Three things it never does

- **Send anything anywhere.** No network calls of any kind. No telemetry.
- **Store what you typed.** Findings are categories, counts and offsets. The
  matched values never leave the scan function.
- **Report to anyone.** It warns you, not your employer.

Detection runs entirely in the browser using CloakLLM's own detection engine,
vendored as a 7 KB bundle with no Node runtime and no remote code.

## What it cannot see

Browser tabs only. It is blind to the ChatGPT and Claude **desktop apps**,
**Copilot and Cursor in the IDE**, `curl` and direct API calls, and anything on
a personal device — which is where developers leak most. This limitation goes in
the store listing, not a footnote: a tool that implies coverage it does not have
manufactures false assurance.

## Build

```
npm install
npm run build
npm test
```

To produce the uploadable zip:

```
npm run package
```

The file list is **derived**, not hand-written: the packager reads the manifest,
resolves every path it names, and walks the service worker's import graph. A
manifest entry pointing at a file the zip omits would install fine and do
nothing — Chrome does not complain, the extension just sits inert in the
toolbar — so anything missing fails the build instead.

Icons are generated (`npm run icons`) rather than committed as opaque binaries;
`tools/make-icons.mjs` draws them and encodes the PNGs with `node:zlib`.

`build.mjs` bundles the detection subset from the sibling `cloakllm-js`
checkout into `src/vendor/`, and the content script into `dist/`. It fails the
build if a Node builtin or any runtime code generation (`eval`, `new Function`,
`importScripts`) appears in the vendored bundle — both are disqualifying under
the MV3 CSP and both would be Chrome Web Store review problems.

## Try it

1. `npm run build`
2. `chrome://extensions` -> enable Developer mode -> **Load unpacked** -> pick
   this directory
3. Open `https://chatgpt.com`
4. Click **service worker** on the extension's card to open its console
5. Type `explain mutexes` and press Enter — it should send completely normally
6. Now type `refund the card 4111 1111 1111 1111 for marie@example.com` and
   press Enter — the send should stop and a dialog should appear reading
   *"this looks like it contains a credit card number and an email address"*
7. **Let me edit it** leaves the text in the box. **Send anyway** sends it, and
   pressing Enter again on that same text goes straight through.

Note what the dialog does **not** show: the card number. That is the invariant,
and it is asserted in three places — the scan summary, the sentence a person
reads, and the rendered dialog — each time including the digits-only form, so a
reformatted copy cannot hide.

## Layout

```
manifest.json            MV3, no permissions beyond the matched hosts
build.mjs                vendor + content bundling, with CSP/builtin guard rails
src/vendor-entry.js      the ONLY doorway into the SDK; exposes 3 functions
src/vendor/              generated -- do not edit
src/worker/index.js      service worker; owns detection, logs summaries only
src/content/events.js    paste / input / Enter / submit; owns the send gate
src/content/scan-cache.js  keeps a verdict warm so Enter can decide in sync
src/content/warn-ui.js   the interstitial, in a closed shadow root
src/shared/extract.js    pure text extraction, unit-tested without a DOM
src/shared/labels.js     the only place a category becomes prose
src/shared/hash.js       FNV-1a, for cache keys and acknowledgements
src/sites/index.js       per-site adapters -- breakage is a one-file fix
```

## Settings and the toolbar

Click the toolbar icon for what the log says: near-misses caught, how many you
heeded, and which categories keep coming up. Export writes a verifiable
`audit_*.jsonl`; Clear wipes everything, with no confirmation dialog — it is
your record of your own near-misses, and making it hard to delete would quietly
turn a coach into a cop.

Settings let you silence any category that is noisy in your work. That is not a
nicety: a warning you learn to ignore is worse than no warning. `IP_ADDRESS` is
off by default for exactly that reason.

## The findings log

Every warning is recorded — **the decision, never the text.** An entry carries
the host, the trigger, the categories and their counts, and whether you heeded
it. Nothing else. Offsets are deliberately dropped: the live check needs them,
a stored record does not, and they leak the shape of what you wrote.

Entries are SHA-256 hash-chained using CloakLLM's own canonicaliser, so an
export verifies with the standard `cloakllm-verifier` — no special tooling:

```bash
npm run test:verifier
```

That runs a chain built by this extension's JavaScript through the real Python
verifier, confirms an edited entry is caught, and confirms no planted value
survives into the exported bytes.

**What the log is for:** measuring whether the tool works — `heeded / shown` —
and producing a report like *"37 near-misses this month, mostly IBANs"* without
a single prompt ever being collected.

**What it is not:** evidence about you. A chain on your own machine detects
edits, but not deletion — you can clear it in one click, and that is the point.
Retention rotates through epochs rather than truncating, so each epoch still
verifies from genesis while recording the previous one's final hash.

## Why the cache exists

To stop a send, `preventDefault` must be called before the site's own handler
runs — synchronously. But scanning is a round trip to the service worker, and
you cannot await inside a keydown handler. So the extension scans as you type
(debounced) and consults the result at Enter.

What falls out is the right risk profile: text that is known-clean is never
intercepted; text that is known-dirty is blocked; and text the cache has not
seen yet — you typed faster than the debounce — is blocked *pending* a scan,
then released or warned. Blocking on "unknown" is deliberate. Assuming clean
would be the one shortcut that silently voids the guarantee.

The exception is our own failure: if the scan errors outright, the send is
released and a warning is logged. Failing closed there would mean a broken
worker stops someone using their chat at all.

## Why detection runs in the service worker

A regex pass over a large paste must never run on the page's main thread. From
the M0 spike: 0.02 ms for a 1 KB message, 1.2 ms for a 63 KB paste. Cheap, but
not something to put in front of a keystroke.

MV3 service workers are ephemeral, so the detector is rebuilt on each wake
(~8 ms, almost all of it `RegexBackend`'s ReDoS safety corpus re-checking
built-in patterns the SDK's own CI already covers). Skipping that check for
built-ins is a known optimisation, not yet applied.

## License

MIT.
