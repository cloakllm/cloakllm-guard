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
Catches personal data before you send it to an AI chat. Checks locally - nothing is sent, stored, or reported anywhere.
```

*(118 characters.)*

## Category

Productivity — Workflow & Planning

## Detailed description

```
CloakLLM Guard checks what you are about to send to ChatGPT, Claude, Gemini or
Microsoft Copilot, and stops you if it contains personal data.

Paste a customer record into a chat box and press send, and instead of the
message going out you get a question: "this looks like it contains a credit
card number and an email address - send anyway?" You can always say yes. It is
a seatbelt, not a lock.

THREE THINGS IT NEVER DOES

- Send anything anywhere. There are no network requests at all. No server, no
  analytics, no account.
- Store what you typed. It records that a warning happened and which kinds of
  data were found - never the values, never the surrounding text.
- Report to anyone. It warns you. Your employer does not get a copy.

Detection runs entirely in your browser, using the detection engine from
CloakLLM, an open-source compliance toolkit used to keep personal data out of
AI audit logs.

WHAT IT CATCHES

Credit card numbers, IBANs, national ID numbers, API keys, AWS access keys,
access tokens, email addresses and phone numbers. Every category can be turned
off individually - if something is noisy in your work, silence it. A warning
you learn to ignore is worse than no warning.

WHAT IT CANNOT SEE

Browser tabs only. It cannot see the ChatGPT or Claude desktop apps, Copilot or
Cursor inside your editor, anything sent directly from code, or anything on
another device. That is a real limit, and we would rather you knew it now than
found out later. If a tool tells you it covers everything, it is not reading
your IDE either.

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

## Assets still needed

- **Screenshots** (1280x800 or 640x400, at least one, up to five). At minimum:
  the warning dialog mid-send, and the popup showing a populated log.
- **Small promo tile** (440x280) if we want to be featurable.
- Icons are generated: `npm run icons` writes 16/32/48/128.

## Unresolved before anyone submits

1. ~~Repo name and public URL~~ — **done 2026-09-15:**
   https://github.com/cloakllm/cloakllm-guard (public).
2. **The Claude, Gemini and Copilot selectors are inferred, not verified.**
   Shipping to users on sites where the adapter may not bind is worse than not
   listing those sites: the extension would sit in the toolbar looking like
   protection while seeing nothing. Verify each while signed in first.
3. **Neither UI page has been rendered in a real browser.**
4. **Publisher account and developer verification** — a one-off $5 registration
   plus an identity check that can take days.
5. **Which listing it goes under** — a new publisher has no track record, and a
   privacy-claiming extension requesting content access on four AI services
   will draw a slow review. Budget for it.
