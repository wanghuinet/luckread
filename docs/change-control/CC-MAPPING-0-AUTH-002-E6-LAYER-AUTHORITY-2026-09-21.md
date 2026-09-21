# Change Control — AUTH-002 / AUTH-011 E6 Layer Output Authority Gap v1

- ID: CC-MAPPING-0-AUTH-002-E6-LAYER-AUTHORITY-2026-09-21
- Date: 2026-09-21
- Status: OPEN — EXPLICIT AUTHORITY DECISION REQUIRED
- Feature: AUTH-002 / AUTH-011
- Gate: E6 Wire/Runtime output authority

## Observed facts

The canonical authLogin/authRefresh response schema requires:
- layer: string
- pattern: ^L[0-8]$

The repository contains the authoritative L0-L8 permission-layer definitions, but the active W01 User runtime model has no implemented/canonical layer field or resolver. Current searches did not establish a runtime function that can authoritatively return the actor's layer.

## Prohibited inference

Do not:
- hard-code L1, L2 or another default;
- infer layer from account state, email verification, username, role name, subscription, entitlement, organization or device;
- add a new User field merely to make the response pass;
- introduce a new layer entity or Worker;
- treat documentation layer definitions as executable runtime evidence.

## Required authority decision

A Contract-First authority decision must identify the canonical source and resolver semantics for the response layer before E6 runtime implementation can be promoted.

The decision must specify:
1. authoritative source;
2. precedence when multiple authorization dimensions exist;
3. deterministic resolver input;
4. whether the layer is persisted, derived, or projected;
5. runtime binding for authLogin/authRefresh;
6. negative behavior when the resolver cannot establish a valid L0-L8 result.

## Current disposition

- E6 layer output authority: OPEN.
- E6 runtime implementation: BLOCKED by this gap.
- No runtime implementation or layer field is authorized by this record.
- Existing E6-WIRE-001 and E6-WIRE-002 remain resolved at authority scope.
- AUTH-002 and Mapping 0 remain NOT_GREEN.
