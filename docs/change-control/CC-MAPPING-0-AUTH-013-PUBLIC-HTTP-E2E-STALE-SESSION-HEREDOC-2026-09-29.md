# CC-MAPPING-0-AUTH-013-PUBLIC-HTTP-E2E-STALE-SESSION-HEREDOC-2026-09-29

## Status

`APPROVED_FOR_EVIDENCE_TOOLING_ALIGNMENT`

## Trigger

AUTH-013 Public HTTP E2E Run `36503289078` used main commit
`e3117374e0f1643634d0f5332539bb62e64b05f9`.

The run reached and passed the complete public transport E2E step, including the
authorized transition and stale `If-Match` assertion. It then failed only in
the subsequent `Verify stale-session public denial` workflow step because the
shell heredoc contained a nested `node --input-type=module <<'NODE'` marker.
Node therefore attempted to parse the nested shell syntax as JavaScript and
returned `SyntaxError: Unexpected identifier 'input'`.

## Decision

Correct the workflow-only heredoc structure so the stale-session step performs
the HTTP assertion and writes its non-secret evidence result inside one Node
script/heredoc.

No request semantics, authentication logic, authorization logic, runtime Worker
code, Contract/OpenAPI, D1 schema, Payload version, topology, or evidence
promotion rule changes.

## Provenance

- Trigger run: `36503289078`
- Tested/deployed source: `f4c329b74f7110af76c7ba7339bfd9d3cb81f910`
- Current workflow/tooling main at trigger: `e3117374e0f1643634d0f5332539bb62e64b05f9`
- Backup: `backup/pre-auth013-e2e-stale-session-heredoc-20260929`
- Working branch: `fix/auth013-e2e-stale-session-heredoc-20260929`

## Admission boundary

The correction only makes the already-defined stale-session assertion executable.
AUTH-013 remains `NOT_GREEN` until a fresh controlled E2E run completes all
required steps and its resulting evidence artifact is admitted.
