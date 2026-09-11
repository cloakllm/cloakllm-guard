# CloakLLM Guard

A browser extension that catches personal data on its way into an AI chat.

It sits on the AI chat sites you already use. When you paste or press send, it
checks the text **on your machine** and — from M2 onward — warns you before it
goes out. You can always send anyway. It is a seatbelt, not a lock.

**Status: M1 (detect-and-log). Not usable yet — there is no warning UI, it only
logs findings to the extension console.** Plan and milestones:
`../PLAN_extension_v01.md`.

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
5. Paste `4111 1111 1111 1111 and marie@example.com` into the composer

Expected in the service-worker console:

```
[CloakLLM Guard] 2 finding(s) on chatgpt.com via paste: CREDIT_CARD x1, EMAIL x1 (0.02 ms)
```

Note what is **not** in that line: the card number. That is the invariant, and
`test/m1.test.js` asserts it — planted values must appear nowhere in any summary,
including in digits-only form.

## Layout

```
manifest.json            MV3, no permissions beyond the matched hosts
build.mjs                vendor + content bundling, with CSP/builtin guard rails
src/vendor-entry.js      the ONLY doorway into the SDK; exposes 3 functions
src/vendor/              generated -- do not edit
src/worker/index.js      service worker; owns detection, logs summaries only
src/content/events.js    paste / Enter / submit capture (bundled to dist/)
src/shared/extract.js    pure text extraction, unit-tested without a DOM
src/sites/index.js       per-site adapters -- breakage is a one-file fix
```

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
