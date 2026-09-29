# CC-MAPPING-0-AUTH-013-W04-PHYSICAL-BINDING-DECISION-2026-09-29

## Status

`ADMITTED_FOR_CONTROLLED_CREATION`

## Authority

- Repository authority: GitHub `main`
- Canonical Worker Master: `docs/04-WORKER-MASTER-v1.0.md`
- Canonical Worker: **W04**
- Canonical responsibility: **Feed / Recommendation / Search**
- Canonical Tasks: **T08, T09, T10**
- Frozen topology: **12 Workers / 4 D1**
- W04 boundary: **derived/projection only; no new authoritative D1**

## Physical identity decision

The W04 physical Worker resource is admitted as:

- Worker name: `luckread-w04`
- Source path: `workers/W04-feed-search`
- Entrypoint: `workers/W04-feed-search/src/index.ts`
- D1 binding: **none**
- Service Binding: **none**
- Public route: **none**

This is a controlled resource-creation decision. It does not promote W04 runtime business behavior to GREEN.

## Explicit authorization input

Project-owner authorization on 2026-09-29 permits direct creation of the W04 Worker resource in Cloudflare.

## Provisioning scope

The first deployment is intentionally a minimal bootstrap shell exposing only:

`GET /health`

The deployment must not:

- add a D1 database or D1 binding;
- modify Payload Core;
- create a Service Binding;
- create a queue consumer;
- implement projection/deindex semantics;
- redesign any public API.

## Post-creation gate

After the Cloudflare Worker resource/version is successfully created and verified, W04 remains pending the separate implementation admission for:

`identity.account_state_changed`
→ W04 consumer
→ Feed/Recommendation/Search projection/deindex
→ contracted cache/version behavior
→ controlled convergence evidence.

## Evidence boundary

Worker creation/version identity is physical provisioning evidence only. It does not by itself establish feature correctness, Mapping 0 GREEN, or Evidence Registry promotion.
