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
