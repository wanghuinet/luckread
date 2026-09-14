#!/usr/bin/env python3
import json, pathlib, sys, yaml
ROOT=pathlib.Path(__file__).resolve().parents[1]; DOCS=ROOT/'docs'
MACHINE=DOCS/'d21-machine-readable-contract-v1.0.json'; STATE=DOCS/'d21-state-machine-registry-v1.0.yaml'; EVENT=DOCS/'d21-event-registry-v1.0.yaml'; PERM=DOCS/'d21-permission-capability-registry-v1.0.yaml'; API_MAP=DOCS/'d21-api-capability-map-v1.0.yaml'; OPENAPI=DOCS/'d21-openapi-v1.0.yaml'
errors=[]; checks=[]
def ok(n,d=''): checks.append(('PASS',n,d))
def fail(n,d): errors.append((n,d)); checks.append(('FAIL',n,d))
def load_json(p):
    try:return json.loads(p.read_text(encoding='utf-8'))
    except Exception as e: fail('json_parse',f'{p}: {e}'); return {}
def load_yaml(p):
    try:return yaml.safe_load(p.read_text(encoding='utf-8')) or {}
    except Exception as e: fail('yaml_parse',f'{p}: {e}'); return {}
def main():
    for p in [MACHINE,STATE,EVENT,PERM,API_MAP,OPENAPI]:
        if not p.is_file(): fail('required_file',str(p))
    if errors: print('STATUS=BLOCKED'); sys.exit(1)
    m,s,e,p,a,o=load_json(MACHINE),load_yaml(STATE),load_yaml(EVENT),load_yaml(PERM),load_yaml(API_MAP),load_yaml(OPENAPI)
    caps=set(m.get('capabilities',[])); mev=set(m.get('events',[])); mst=m.get('states',{})
    en={x.get('type') for x in (e.get('events',[]) or []) if isinstance(x,dict) and x.get('type')}
    pc=p.get('capability_index',[]) or []
    if not isinstance(pc,list): fail('capability_index_shape','capability_index must be a list'); pc=[]
    pcaps=set(pc)
    explicit=p.get('capabilities',{}) or {}
    if not isinstance(explicit,dict): fail('capability_metadata_shape','capabilities must be mapping'); explicit={}
    pcaps |= set(explicit)
    if mev==en: ok('event_set_equality',str(len(mev)))
    else: fail('event_set_equality',f'missing={sorted(mev-en)} extra={sorted(en-mev)}')
    if caps==pcaps: ok('capability_registry_coverage',str(len(caps)))
    else: fail('capability_registry_coverage',f'missing={sorted(caps-pcaps)} extra={sorted(pcaps-caps)}')
    machines=s.get('machines',{})
    for name,expected_list in mst.items():
        reg=machines.get(name,{}) or {}; actual=set(expected_list or []); declared=set()
        for t in reg.get('transitions',[]) or []:
            if isinstance(t,dict): declared.update([t.get('from'),t.get('to')])
        declared.discard(None); declared.add(reg.get('initial')); declared.update(reg.get('terminal',[]) or []); declared.discard(None)
        if actual==declared: ok(f'state_set:{name}')
        else: fail('state_set_equality',f'{name}: machine={sorted(actual)} registry={sorted(declared)}')
        ts=reg.get('transitions',[]) or []; terminal=set(reg.get('terminal',[]) or []); outgoing={t.get('from') for t in ts if isinstance(t,dict)}
        if terminal&outgoing: fail('terminal_semantics',f'{name}:{sorted(terminal&outgoing)}')
        else: ok(f'terminal_semantics:{name}')
        for t in ts:
            if not all(k in t for k in ('from','to','action','capability','event')): fail('transition_schema',f'{name}:{t}'); continue
            if t['capability'] not in caps: fail('transition_capability',f'{name}:{t["capability"]}')
            if t['event'] not in mev: fail('transition_event',f'{name}:{t["event"]}')
            if t['from'] not in actual or t['to'] not in actual: fail('transition_state',f'{name}:{t}')
    mapped=a.get('operations',{}) or {}
    if not isinstance(mapped,dict): fail('api_map_shape','operations must be mapping'); mapped={}
    oo=set()
    for pi in (o.get('paths') or {}).values():
        if not isinstance(pi,dict): continue
        for method,op in pi.items():
            if method.lower() in {'get','post','put','patch','delete','options','head','trace'} and isinstance(op,dict) and op.get('operationId'): oo.add(op['operationId'])
    if oo==set(mapped): ok('openapi_operation_mapping_equality',str(len(oo)))
    else: fail('openapi_operation_mapping_equality',f'missing={sorted(oo-set(mapped))} orphan={sorted(set(mapped)-oo)}')
    mcaps=set(mapped.values())
    if mcaps<=caps: ok('api_capability_validity')
    else: fail('api_capability_validity',f'unknown={sorted(mcaps-caps)}')
    if 'payment.settle' not in caps: ok('no_direct_d15_settlement')
    else: fail('no_direct_d15_settlement','payment.settle present')
    for n,exp in {'billing':{'PENDING','VALID','BILLABLE','FINALIZED','INVALID','SUSPICIOUS','REVERSED','ADJUSTED'},'traffic_validity':{'PENDING','VALID','SUSPICIOUS','INVALID','REVERSED'},'reconciliation':{'MATCHED','MINOR_VARIANCE','MATERIAL_VARIANCE','DISPUTED','RESOLVED'}}.items():
        if exp<=set(mst.get(n,[])): ok(f'required_states:{n}')
        else: fail(f'required_states:{n}',f'missing={sorted(exp-set(mst.get(n,[])))}')
    inv={x.get('id') for x in m.get('invariants',[]) if isinstance(x,dict)}
    for x in ['D21-AD-001','D21-AD-002','D21-AD-003','D21-AD-005','D21-AD-008','D21-AD-010','D21-AD-012']:
        if x in inv: ok(f'invariant:{x}')
        else: fail(f'invariant:{x}','missing')
    print('D21 CONTRACT VALIDATOR'); print('======================')
    for st,n,d in checks: print(f'[{st}] {n}'+(f' :: {d}' if d else ''))
    print(f'CHECKS={len(checks)} FAILURES={len(errors)}'); print('STATUS='+('PASS' if not errors else 'BLOCKED')); sys.exit(0 if not errors else 1)
if __name__=='__main__': main()
