# CC-MAPPING-0-WORKER-D1-ACCESS-BOUNDARY-2026-10-01

Status: READY FOR CI / MERGE — NOT A MAPPING GREEN DECISION

## Finding

The Worker × D1 Mapping defines scoped access, but the existing implementation did not mechanically prevent an undeclared or out-of-domain physical D1 binding from being added later.

## Minimum correction

Add a small contract and CI guard that checks:

- physical D1 UUIDs against the registered four-domain registry;
- Worker-to-D1 domain allowlists against the canonical Worker × D1 mapping;
- raw D1 binding references in Worker code against each Worker’s declared Wrangler D1 bindings;
- absence of a physical Worker configuration is allowed until its separate physical-binding gate is admitted.

## Deliberate limits

- No table-level SQL semantic inference.
- No database proxy.
- No new D1.
- No Worker topology change.
- No runtime deployment.
- No Mapping 0 GREEN promotion.

Runtime Evidence remains the authority for deployed behavior; this Guard is a preventative static control.