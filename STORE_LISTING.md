# Chrome Web Store listing — CloakLLM Guard

Copy for the developer dashboard. **Nothing here has been submitted.** Review
`PRIVACY.md` and the unresolved items at the bottom before anyone uploads.

---

## Name

```
CloakLLM Guard
```

## Short description (132 characters max)

```
Catches personal data before you send it to an AI chat. The check runs locally; the extension never sends or stores what you type.
```

*(130 characters.)* **This is also `manifest.json`'s `description`, which the store shows under the title and which cannot be edited in the dashboard -- the two must match (test-enforced).** The earlier manifest text said the extension warns "before you paste"; it warns before you SEND.

## Category

**Privacy & Security** if the dashboard offers it (it describes the extension better); otherwise Productivity — Workflow & Planning.

**Language:** English.

## Detailed description

```
CloakLLM Guard checks what you are about to send to ChatGPT, Claude, Gemini or
Microsoft Copilot, and stops you if it contains personal data.

Paste a customer record into a chat box and press send, and instead of the
message going out, Guard stops and asks: "Hold on - this looks like personal
data. What you are about to send appears to contain a credit card number and
an email address." You choose "Let me edit it" or "Send anyway", and you can
always send. It is a seatbelt, not a lock.

THREE THINGS IT NEVER DOES

- Send anything anywhere. There are no network requests at all. No server, no
  analytics, no account.
- Store what you typed. It records that a warning happened and which kinds of
  data were found - never the values, never the surrounding text.
- Report to anyone. It warns you. Your employer does not get a copy.

Detection runs entirely in your browser, using the detection engine from
CloakLLM, an open-source compliance toolkit built to keep personal data out of
AI audit logs.

WHAT IT CATCHES

Credit card numbers, IBANs, US Social Security numbers, API keys, AWS access keys,
access tokens, email addresses and phone numbers. Every category can be turned
off individually - if something is noisy in your work, silence it. A warning
you learn to ignore is worse than no warning.

WHAT IT CANNOT SEE

Browser tabs only. It cannot see the ChatGPT or Claude desktop apps, Copilot or
Cursor inside your editor, anything sent directly from code, or anything on
another device. That is a real limit, and we would rather you knew it now than
found out later.

It also does not recognise names, postal addresses or dates of birth. It
catches the structured kinds of data listed above; a person's name on its own
will not trigger a warning.

YOUR OWN RECORD

Every warning is logged locally - categories and counts only - so you can see
whether this is actually helping: how many near-misses, how many you acted on,
which kinds keep coming up. Export it or delete it whenever you like. It is
your record, not ours; we never see it.

Open source, MIT licensed: https://github.com/cloakllm/cloakllm-guard
```

## Permission justifications

The dashboard asks for these individually.

**`storage`**
```
Stores the user's category preferences and a local record of warnings shown
(categories and counts only, never message content). Nothing in this storage
leaves the device.
```

**Host access to the listed AI chat sites**
```
The extension's single purpose is to check a message before it is sent to an AI
chat service. It needs to read the composer contents on those specific sites at
the moment of sending in order to do that. No other sites are requested, and
the text is discarded immediately after it is checked.
```

**Single purpose statement**
```
Warn the user before they send personal data to an AI chat service.
```

**Remote code**
```
No. All code is contained in the package. The detection engine is bundled at
build time; the build fails if any remote-code construct appears in it.
```

**Data usage disclosures**

| Question | Answer |
|---|---|
| Collects personally identifiable information | **No** |
| Collects health information | No |
| Collects financial and payment information | **No** — detected categories are counted, values are never stored or transmitted |
| Collects authentication information | **No** — same |
| Collects personal communications | **No** — message text is read in memory to check it, then discarded |
| Collects location | No |
| Collects web history | No |
| Collects user activity | **No** — warning counts are stored locally and never transmitted |
| Collects website content | **No** — read transiently to perform the check, never retained |
| Sells data to third parties | No |
| Uses data for unrelated purposes | No |
| Uses data to determine creditworthiness | No |

The reviewer will focus on "collects personal communications" and "website
content". The honest answer to both is that the text is read in memory to
perform the check and then discarded — nothing is retained or transmitted.
`PRIVACY.md` says so plainly and the test suite asserts it.

## Privacy policy URL

Must be publicly reachable before submission. `PRIVACY.md` is the content;
`https://cloakllm.dev/guard/privacy` is the suggested home.

## Homepage and support URLs

- **Official URL:** `cloakllm.dev` (verified in Search Console)
- **Homepage URL:** `https://cloakllm.dev/guard`
- **Support URL:** `https://cloakllm.dev/guard/support`

Both live since 2026-09-23. The homepage says "Chrome Web Store listing in
review" instead of linking to a store page that does not exist yet -- set
`STORE_URL` in `cloakllm-web/src/app/guard/page.tsx` once the listing is live,
and add `/guard` to the site nav at the same time.

The support page quotes the extension's own messages word for word (from
`src/content/warn-ui.js`, `src/ui/popup.html`, `src/sites/index.js`). If that
wording changes, change the page too. Its first instruction is never to
include the message or any personal data in a report.

Security reports currently go to `team@cloakllm.dev`: GitHub's private
vulnerability reporting is OFF on the org's repos, so the channel named in
`CloakLLM/SECURITY.md` does not work for an outside reporter until it is
enabled.

## Assets

**Done 2026-09-23.** Upload these from `store/`:

| File | Size | Shows |
|---|---|---|
| `screenshots/01-warning.png` | 1280x800 | the warning dialog mid-send |
| `screenshots/02-popup.png` | 1280x800 | the popup with a populated log |
| `screenshots/03-settings.png` | 1280x800 | the settings page at its real defaults |
| `screenshots/04-privacy.png` | 1280x800 | permissions, read from the real manifest |
| `promo-tile-440x280.png` | 440x280 | small promo tile |

Regenerate with `npm run store` (starts nothing itself -- run
`node tools/ui-harness.mjs` first). The script reads each PNG's own header
back and fails unless it is exactly the size the store accepts.

Icons are generated separately: `npm run icons` writes 16/32/48/128.

### What the screenshots show, and why each part is honest

- **The chat interface is generic.** No product name, logo or layout taken
  from any real AI service. A store screenshot that looks like someone
  else's product is misleading and a listing-policy problem.
- **The warning dialog is the real one** (`src/content/warn-ui.js`), and the
  categories it names are computed live by the vendored detection engine
  from the text in the composer. Nothing in the dialog is typed by hand.
- **The popup and settings pages are the real pages**, rendered through the
  UI harness. Settings show the extension's actual `DEFAULTS` (every
  category on except IP address), imported from `src/shared/settings.js`.
- **The popup's numbers are sample data** (37 near-misses, 84% heeded). This
  is the one illustrative element, and the standard one for a store listing.
- **All personal data shown is fictitious:** a Visa test number, an
  `example.com` address and a `555` phone number.

### Screenshot claims

Every sentence in a screenshot is a public claim. Each was checked against
the code before it was written, and the checkable ones are asserted by
`test/package.test.js` so a change that falsifies one fails the build.

| Claim | Basis |
|---|---|
| Card numbers, IBANs, emails, API keys are flagged on send | all enabled in `DEFAULTS`; the dialog in 01 is the engine's own output |
| Checked on your machine | detection runs in the extension's service worker |
| Nothing you write is stored or sent anywhere | the findings log holds categories and counts only -- the verifier cross-check asserts planted values never appear in it |
| "Send anyway" is always one click away | the fail-open-on-action design; the dialog's own buttons are regression-tested |
| Export a hash-chained log cloakllm-verifier can check | `test/verifier_crosscheck.py` runs the real emitted chain through the real verifier |
| Works on ChatGPT, Claude, Gemini and Microsoft Copilot | all four adapters verified on the live sites, 2026-09-20 |
| **One permission: `storage`. No host permissions.** | **test-bound** -- read from `manifest.json` at render time, and asserted in `test/package.test.js` |
| **The extension contains no network code** | **test-bound** -- `test/package.test.js` greps everything that ships for network primitives. Deliberately *not* "no network access": an MV3 extension without host permissions can still fetch CORS-enabled endpoints, so the permission list alone would not prove it |
| No account, no analytics, no telemetry | follows from the line above; there is nowhere to send anything |

If any of these stops being true, the screenshots must be regenerated
**before** the next listing update, not after.

## Trader status (EU Digital Services Act)

**Declared: non-trader** (2026-09-23). Published by an individual, before
any company is registered, as a free MIT-licensed open-source extension.
That is a defensible reading of "acting outside trade, business, craft or
profession", but a grey area rather than a clear-cut one.

Consequence: the listing shows EU users a notice that the publisher has not
identified as a trader and that EU consumer-protection rights do not apply.

**Switch to trader when EITHER happens** (Developer Dashboard -> Settings ->
Trader declaration):
1. CloakLLM is registered as a company -- then verify as an ORGANIZATION
   with the registration certificate (no D-U-N-S number needed), so the
   public name, address and phone are the company's, not a person's.
2. The extension becomes part of a paid offering (e.g. the managed Guard
   edition).

Note for whoever does it: a Google payments profile's type (individual vs
business) is understood to be permanent once created, so create a business
profile at that point rather than reusing a personal one.

## Unresolved before anyone submits

1. ~~Repo name and public URL~~ — **done 2026-09-15:**
   https://github.com/cloakllm/cloakllm-guard (public).
2. ~~The Claude, Gemini and Copilot selectors are inferred, not verified~~ --
   **done 2026-09-20:** all four adapters verified on the live sites while
   signed in. One gap carried forward, not blocking: Gemini's send control has
   no `data-testid`, so for a non-English user click-path protection rests on
   the CSS class `.send-button` alone. See `src/sites/index.js`.
3. ~~Neither UI page has been rendered in a real browser~~ -- **done
   2026-09-23**, and rendering them found a real defect: a broken extension's
   popup said "Guard is watching your AI chats". Fixed, and both pages are
   now covered by `test/ui.test.js`.
4. **Publisher account and developer verification** — a one-off $5 registration
   plus an identity check that can take days.
5. **Which listing it goes under** — a new publisher has no track record, and a
   privacy-claiming extension requesting content access on four AI services
   will draw a slow review. Budget for it.
