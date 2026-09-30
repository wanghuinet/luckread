# CC-1.0 — Publish Preflight / Creator Quality Gate — 2026-09-30

Status: IMPLEMENTATION SLICE / PENDING CI EVIDENCE

## Decision

Add a stateless publish-preflight capability to the existing W03 Content authority.

- W03 owns the rule engine and final preflight verdict.
- W01 remains the public/session boundary and Creator Center UI.
- No new Worker.
- No new D1 table or write.
- Preflight is advisory for YELLOW and blocking for RED.
- Review submission must re-run the same W03 checks server-side.
- The existing Content state machine remains authoritative: preflight does not publish content and cannot bypass moderation.

## Creator policy

LuckRead may permit AI-assisted creation, but an article cannot be submitted as an entirely AI-generated article. The preferred workflow is:

1. AI may help research, outline, structure, summarize or assist with editing.
2. The creator must add substantial original value: first-hand experience, verified facts, data, cases, observations, analysis or clear independent conclusions.
3. The creator must personally review and verify material claims.
4. AI use is a creation-method signal, not an authorship-forensics claim.

This is intentionally stricter than Google's published guidance. Google says AI/automation is not inherently spam; its concern is whether content is helpful, original, people-first, and whether scaled generation is being used primarily to manipulate Search. LuckRead must not describe its own creator policy as a Google ban.

## Rule families

- Security: HTML/script/hidden-style injection.
- SEO: descriptive title, title length advisory, title/body relevance, keyword stuffing.
- Quality: paragraph structure, repetitive text, boilerplate, thin-content prompts, first-hand value signals.
- Trust: source/data/experience/limitations prompts.
- Anti-abuse: phone numbers, social IDs, QR/scan cues, external URLs, lead-generation combinations.
- Media: current v1 uses reference-name heuristics; pixel OCR/QR is explicitly not claimed.

## Wire

Public: POST /api/creator/contents/{contentId}/preflight

Internal: POST /internal/content/contents/{contentId}/preflight

The preflight request is bounded and contains the current editor snapshot. The result is not persisted. The creator submission then sends the same snapshot to W03 again; W03 recomputes the verdict before allowing DRAFT -> PENDING_REVIEW.

## Evidence rule

This decision document does not declare GREEN. Implementation becomes admitted only after the normal repository gates and CI evidence succeed.

## v1 extension — global contact and bypass detection

The first-layer preflight registry uses three local, runtime-safe primitives:
- `libphonenumber-js/max` for international and context-assisted national phone parsing.
- `tldts` for URL/hostname parsing, including IP-host and IDN/Punycode shape checks.
- `@moderation-api/unicode-spoofing` for UTS #39 confusable detection, mixed-script analysis and invisible-character analysis.

The runtime keeps a conservative fallback for national-format phone candidates: a country/region hint must be present before parsing. It does not claim live carrier ownership, HLR status, SIM status, or account ownership. Number portability means a prefix cannot establish the subscriber's current operator; those checks belong to a later external verification layer.

Messaging detection is a registry, not a single keyword filter. v1 covers WhatsApp, Telegram, Facebook Messenger, WeChat, LINE, QQ, Signal, Viber, KakaoTalk, Discord, Skype, Zalo, WeCom, DingTalk and Snapchat link/ID patterns.

Unicode normalization is used only for detection; original editor content is not silently rewritten. Normalized text is used to catch HTML-entity, width, invisible-character and homoglyph bypasses. Legitimate multilingual content remains advisory unless it combines with contact/lead-generation evidence.

The previously considered `@ensdomains/unicode-confusables` package is not adopted as a runtime dependency. Repository security evidence records a compromised release under that package name in 2025; the runtime therefore uses the zero-runtime-dependency UTS #39 implementation above instead of introducing that supply-chain risk.

### Risk-fusion rule

A phone, messaging account, QR cue or external URL by itself is not an automatic block. Blocking is driven by a promotional/contact combination, or by multiple concrete contact channels when no clear public/reference context is present. This preserves room for news reporting, public institution contacts, source citations and technical documentation while still catching common off-platform lead-generation patterns.
