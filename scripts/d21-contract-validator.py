#!/usr/bin/env python3
import json
import pathlib
import sys
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'

MACHINE = DOCS / 'd21-machine-readable-contract-v1.0.json'
STATE = DOCS / 'd21-state-machine-registry-v1.0.yaml'
EVENT = DOCS / 'd21-event-registry-v1.0.yaml'
PERM = DOCS / 'd21-permission-capability-registry-v1.0.yaml'
API_MAP = DOCS / 'd21-api-capability-map-v1.0.yaml'
OPENAPI = DOCS / 'd21-openapi-v1.0.yaml'

errors = []
checks = []

def ok(name, detail=''):
    checks.append(('PASS', name, detail))

def fail(name, detail):
    errors.append((name, detail))
    checks.append(('FAIL', name, detail))

def load_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception as e:
        fail('json_parse', f'{path}: {e}')
        return {}

def load_yaml(path):
    try:
        return yaml.safe_load(path.read_text(encoding='utf-8')) or {}
    except Exception as e:
        fail('yaml_parse', f'{path}: {e}')
        return {}

def require_files():
    for p in [MACHINE, STATE, EVENT, PERM, API_MAP, OPENAPI]:
        if not p.is_file():
            fail('required_file', str(p))
    if not errors:
        ok('required_files')

def main():
    require_files()
    machine = load_json(MACHINE)
    state = load_yaml(STATE)
    event = load_yaml(EVENT)
    perm = load_yaml(PERM)
    api_map = load_yaml(API_MAP)
    openapi = load_yaml(OPENAPI)

    machine_caps = set(machine.get('capabilities', []))
    machine_events = set(machine.get('events', []))
    machine_states = machine.get('states', {})

    event_items = event.get('events', event.get('registry', []))
    if isinstance(event_items, dict):
        event_items = list(event_items.values())
    event_names = set()
    for item in event_items or []:
        if isinstance(item, str): event_names.add(item)
        elif isinstance(item, dict) and item.get('name'): event_names.add(item['name'])

    perm_caps = set()
    for item in perm.get('capabilities', perm.get('registry', [])) or []:
        if isinstance(item, str): perm_caps.add(item)
        elif isinstance(item, dict) and item.get('capability'): perm_caps.add(item['capability'])
        elif isinstance(item, dict) and item.get('name'): perm_caps.add(item['name'])

    map_entries = api_map.get('operations', api_map.get('mappings', [])) or []
    mapped_operation_ids = {}
    mapped_caps = set()
    for item in map_entries:
        if not isinstance(item, dict): continue
        op = item.get('operationId') or item.get('operation_id')
        cap = item.get('capability')
        if op:
            if op in mapped_operation_ids:
                fail('api_mapping_unique', f'duplicate operationId: {op}')
            mapped_operation_ids[op] = cap
        if cap: mapped_caps.add(cap)

    # Event set equality.
    if machine_events == event_names:
        ok('event_set_equality', f'{len(machine_events)} events')
    else:
        fail('event_set_equality', f'missing={sorted(machine_events-event_names)} extra={sorted(event_names-machine_events)}')

    # Capability registry coverage.
    missing_perm = machine_caps - perm_caps
    if not missing_perm:
        ok('capability_registry_coverage')
    else:
        fail('capability_registry_coverage', f'missing={sorted(missing_perm)}')

    # State registry must match machine contract and transitions must be legal.
    machines = state.get('machines', {})
    for name, states in machine_states.items():
        actual = set(states or [])
        registry = machines.get(name, {})
        declared = set(registry.get('states', [])) if isinstance(registry, dict) else set()
        # The canonical registry stores states implicitly in transitions; derive them.
        if not declared and isinstance(registry, dict):
            declared = set()
            for t in registry.get('transitions', []) or []:
                declared.update([t.get('from'), t.get('to')])
            declared.discard(None)
            if registry.get('initial'): declared.add(registry['initial'])
            declared.update(registry.get('terminal', []) or [])
        if actual != declared:
            fail('state_set_equality', f'{name}: machine={sorted(actual)} registry={sorted(declared)}')
        else:
            ok(f'state_set:{name}')
        transitions = registry.get('transitions', []) if isinstance(registry, dict) else []
        terminal = set(registry.get('terminal', []) or []) if isinstance(registry, dict) else set()
        outgoing = set(t.get('from') for t in transitions if isinstance(t, dict))
        bad_terminal = terminal & outgoing
        if bad_terminal:
            fail('terminal_semantics', f'{name}: terminal states have outgoing transitions {sorted(bad_terminal)}')
        else:
            ok(f'terminal_semantics:{name}')
        for t in transitions:
            if not all(k in t for k in ('from','to','action','capability','event')):
                fail('transition_schema', f'{name}: incomplete transition {t}')
                continue
            if t['capability'] not in machine_caps:
                fail('transition_capability', f'{name}: {t["capability"]}')
            if t['event'] not in machine_events:
                fail('transition_event', f'{name}: {t["event"]}')
            if t['from'] not in actual or t['to'] not in actual:
                fail('transition_state', f'{name}: {t}')
        if not any(t.get('from') == registry.get('initial') for t in transitions):
            # A single-state machine can be valid; D21 machines are not.
            fail('initial_transition', f'{name}: no transition from initial state {registry.get("initial")}')

    # OpenAPI operationIds must map exactly once and every mapped operation must exist.
    openapi_ops = set()
    for path_item in (openapi.get('paths') or {}).values():
        if not isinstance(path_item, dict): continue
        for method, op in path_item.items():
            if method.lower() in {'get','post','put','patch','delete','options','head','trace'} and isinstance(op, dict):
                if op.get('operationId'): openapi_ops.add(op['operationId'])
    if openapi_ops == set(mapped_operation_ids):
        ok('openapi_operation_mapping_equality', f'{len(openapi_ops)} operationIds')
    else:
        fail('openapi_operation_mapping_equality', f'missing_map={sorted(openapi_ops-set(mapped_operation_ids))} orphan_map={sorted(set(mapped_operation_ids)-openapi_ops)}')

    unmapped_caps = {c for c in mapped_caps if c not in machine_caps}
    if unmapped_caps:
        fail('api_capability_validity', f'unknown capabilities={sorted(unmapped_caps)}')
    else:
        ok('api_capability_validity')

    # Read-to-mutation escalation checks.
    forbidden_pairs = {('billing.read','billing.finalize'),('billing.read','billing.adjust'),('billing.read','billing.reverse'),('dispute.read','dispute.resolve'),('advertising.read','billing.finalize'),('advertising.read','campaign.publish')}
    for read_cap, mut_cap in forbidden_pairs:
        if read_cap in machine_caps and mut_cap in machine_caps:
            ok(f'forbidden_escalation:{read_cap}->{mut_cap}', 'registry presence only; authorization must remain denied')

    # Hard boundary checks.
    if 'billing.finalize' in machine_caps and 'external_adapter.finalize' not in machine_caps:
        ok('external_adapter_no_billing_finalize')
    else:
        fail('external_adapter_no_billing_finalize', 'forbidden external billing finalization capability detected')
    if 'payment.settle' not in machine_caps:
        ok('no_direct_d15_settlement')
    else:
        fail('no_direct_d15_settlement', 'D21 contains payment.settle capability')

    # Required machine states.
    required = {
        'billing': {'PENDING','VALID','BILLABLE','FINALIZED','INVALID','SUSPICIOUS','REVERSED','ADJUSTED'},
        'traffic_validity': {'PENDING','VALID','SUSPICIOUS','INVALID','REVERSED'},
        'reconciliation': {'MATCHED','MINOR_VARIANCE','MATERIAL_VARIANCE','DISPUTED','RESOLVED'},
    }
    for name, expected in required.items():
        actual = set(machine_states.get(name, []))
        if expected <= actual: ok(f'required_states:{name}')
        else: fail(f'required_states:{name}', f'missing={sorted(expected-actual)}')

    # Evidence-critical invariants.
    invariant_ids = {x.get('id') for x in machine.get('invariants', []) if isinstance(x, dict)}
    for inv in ['D21-AD-001','D21-AD-002','D21-AD-003','D21-AD-005','D21-AD-008','D21-AD-010','D21-AD-012']:
        if inv in invariant_ids: ok(f'invariant:{inv}')
        else: fail(f'invariant:{inv}', 'missing')

    print('D21 CONTRACT VALIDATOR')
    print('======================')
    for status, name, detail in checks:
        print(f'[{status}] {name}' + (f' :: {detail}' if detail else ''))
    print(f'CHECKS={len(checks)} FAILURES={len(errors)}')
    if errors:
        print('STATUS=BLOCKED')
        sys.exit(1)
    print('STATUS=PASS')

if __name__ == '__main__':
    main()
