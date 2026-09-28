# CC-MAPPING-0-AUTH-013-PUBLIC-E2E-UNAUTHENTICATED-ISOLATION-2026-09-29

## Status

`APPROVED_FOR_EVIDENCE_TOOLING_CORRECTION`

## Evidence trigger

Run `36499324052` reached the real AUTH-013 public HTTP probe after successful
deployment provenance, Payload 3.90.2 admission, fixture preflight, remote
seed and database-generated user-ID resolution.

The first public assertion sent no `If-Match` header and no bearer token.
The deployed handler validates the mandatory optimistic-lock precondition
before invoking Payload authentication, so the request returned HTTP 428
`PRECONDITION_REQUIRED` instead of the evidence probe's intended HTTP 401
`UNAUTHENTICATED`.

This run is not admitted as AUTH-013 behavior evidence.

## Authorized correction

Change only the evidence probe so the unauthenticated assertion supplies a
syntactically valid HTTP `If-Match: 1` header while still omitting the bearer
token.

The probe then isolates authentication behavior from the separate mandatory
`If-Match` assertion that already follows and expects HTTP 428.

The shared `post()` helper is extended with optional request headers; no
business runtime code is duplicated or changed.

## Non-changes

- No AUTH-013 Contract/OpenAPI change.
- No W01 runtime implementation change.
- No W02 authority or implementation change.
- No D1 schema/migration change.
- No Payload version change.
- No Worker/Service Binding/Queue/D1 topology change.
- No Evidence Registry promotion.
- No rerun of the failed run `36499324052` unchanged.

## Backup

`backup/pre-auth013-e2e-unauthenticated-ifmatch-isolation-20260929`

## Required next gate

After this evidence-tooling correction is accepted on `main`:

1. deploy the exact new `main` source through the existing W01/W02 binding
   deployment workflow;
2. manually dispatch the existing AUTH-013 public HTTP E2E workflow using the
   exact deployed source SHA and successful deployment run ID;
3. admit evidence only from a successful artifact with exact provenance.

AUTH-013 and Mapping 0 remain `NOT_GREEN` until that evidence path succeeds.
