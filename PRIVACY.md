# Privacy policy — CloakLLM Guard

Last updated: 15 September 2026

## The short version

CloakLLM Guard makes **no network requests of any kind**. It has no server, no
analytics, no telemetry, and no account. Nothing you type is transmitted
anywhere, and nothing you type is stored — not even locally.

## What the extension reads

To warn you before personal data reaches an AI chat service, the extension
reads the text you are about to send on the sites listed in its manifest
(ChatGPT, Claude, Gemini and Microsoft Copilot). It reads that text at the
moment you paste, type, or press send.

That text is passed to the extension's own background process, checked against
detection patterns **on your device**, and then discarded. It is never written
to disk, never placed in storage, and never sent over the network.

## What the extension stores

Two things, both in your browser's local extension storage, both on your device
only:

**Your settings** — which categories you want to be warned about, and whether
the findings log is enabled.

**The findings log** — one record per warning shown. Each record contains:

- the time
- the site (for example `chatgpt.com`)
- what triggered the check (paste, Enter, or form submit)
- the *categories* found and how many of each — for example
  `{"CREDIT_CARD": 1, "EMAIL": 2}`
- whether you heeded the warning or sent anyway

**It does not contain what you wrote.** Not the matched values, not the
surrounding text, not the character positions. This is enforced in the code and
asserted by the test suite, which plants known values and checks that neither
they nor their digits appear anywhere in a stored record.

You can view the log from the toolbar popup, export it, or delete all of it
with one click. Clearing is immediate and complete.

## What the extension sends

Nothing.

There is no endpoint to send to. The extension requests no host permissions
beyond the sites it watches, and it makes no `fetch` or `XMLHttpRequest` calls
of its own. You can verify this: the source is public, and the build fails if a
network or Node API appears in the bundled detection code.

## Permissions, and why each is needed

**`storage`** — to keep your settings and the findings log on your device.
Nothing in this storage is synced or transmitted.

**Site access** (`chatgpt.com`, `chat.openai.com`, `claude.ai`,
`gemini.google.com`, `copilot.microsoft.com`, `m365.cloud.microsoft`) — to read
the message you are about to send on those sites, so it can be checked before
it leaves. The extension has no access to any other site.

## What it cannot see

Browser tabs only. The extension cannot see the ChatGPT or Claude desktop
applications, Copilot or Cursor inside a code editor, anything sent directly
from code or the command line, or anything on a different device. If you need
coverage there, this extension will not give it to you, and it will not pretend
otherwise.

## Children

The extension is not directed at children and collects no data from anyone.

## Changes

If a future version ever transmits anything, that will be stated at the top of
this document, described in the release notes, and reflected in the permissions
Chrome asks you to approve. It will not happen quietly.

## Contact

team@cloakllm.dev — https://cloakllm.dev
