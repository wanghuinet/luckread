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

## v1 extension — global contact detection

The first-layer preflight registry now screens for phone-number candidates across major target markets in the Americas, Europe, East Asia and Southeast Asia, using country-code and national mobile-number patterns derived from public numbering-plan material. It also detects representative mainstream messaging identifiers or invite links for ten platforms: WhatsApp, Telegram, Facebook Messenger, WeChat, LINE, QQ, Signal, Viber, KakaoTalk and Discord.

This is intentionally a local screening layer. It does not claim live carrier ownership, HLR status, SIM status, or account ownership. Number portability means a prefix cannot establish the subscriber's current operator; those checks belong to a later external verification layer.

## v1 stack refactor — fast-path contact engine

The first-layer detector is refactored into a dedicated W03 contact engine while preserving the existing preflight wire and content lifecycle.

- Phone parsing/validation uses `libphonenumber-js/mobile`; the existing conservative national-format rules remain as a fallback for local-format numbers where no default country is known.
- Domain parsing uses `tldts`.
- Contact normalization performs NFKC, zero-width/bidi-control removal and targeted homoglyph normalization before pattern matching.
- The platform registry is expanded beyond the initial ten messenger platforms to include social, regional, enterprise and community channels without treating a platform name alone as a violation.
- Contact results are confidence-aware and deduplicated; UI findings expose counts/platforms and masked identifiers rather than full contact values.
- Email addresses and social profile links are first-class contact signals.
- This remains a synchronous deterministic fast path. OCR, QR pixel decoding, external AI moderation, number intelligence and OSINT remain later/conditional paths and are not introduced into the v1 synchronous request.

Status remains **PENDING CI EVIDENCE** until the repository gates prove this implementation slice.
