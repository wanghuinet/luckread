# CC-MAPPING-0-W01-TERMINAL-WORKER-BOUNDARY-2026-10-01

Status: READY FOR CI / MERGE — NOT A MAPPING GREEN DECISION

## Finding

W01 is the public HTTP/API ingress boundary, and the current implementation already forwards admitted Content and Moderation operations through private Worker Service Bindings.

The remaining governance gap was semantic: without an explicit terminal-Worker rule, later implementation could incorrectly place business ownership or Worker-to-Worker routing logic back into W01.

## Minimum correction

Add one transport contract and one CI verifier that establish:

- public ingress and business authority are separate concepts;
- admitted Content operations terminate at W03;
- admitted Moderation operations terminate at W06;
- W01 is not inserted between business Workers;
- new direct public Worker exposure requires its own admitted contract and deployment evidence.

## Evidence basis

Current bindings:

- W01 `W03_CONTENT` → `luckread-w03`
- W01 `W06_MODERATION` → `luckread-w06`
- W01 `W02_AUTH` → `luckread-w02`

Current public Content transport:
`contracts/transport/W01-W03-content-http-binding.v1.json`

Current public Moderation transport:
`contracts/transport/W01-W06-moderation-http-binding.v1.json`

## Non-changes

- No Worker added/removed.
- No D1 added/removed.
- No route namespace added.
- No business database ownership changed.
- No Payload Core change.
- No deployment or Cloudflare resource mutation.
- Mapping 0 remains independent and is not promoted to GREEN.
