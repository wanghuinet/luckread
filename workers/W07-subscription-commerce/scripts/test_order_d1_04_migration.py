#!/usr/bin/env python3
"""Offline SQLite tests for the D1-04 order migration candidate; never connects remotely."""
import json
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKER = ROOT / "workers" / "W07-subscription-commerce"
MIGRATION = WORKER / "migrations-d1-04" / "0001_order_commerce.sql"
PAYMENT_MIGRATION = WORKER / "migrations-d1-04" / "0002_payment_provider_events.sql"
SAVED_METHOD_MIGRATION = WORKER / "migrations-d1-04" / "0003_saved_payment_methods_mandates.sql"
CONFIG = WORKER / "wrangler.jsonc"
NOW = "2026-10-28T00:00:00.000Z"
LATER = "2026-10-28T00:00:01.000Z"


class D104OrderMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.payment_sql = PAYMENT_MIGRATION.read_text(encoding="utf-8")
        cls.saved_method_sql = SAVED_METHOD_MIGRATION.read_text(encoding="utf-8")
        config = json.loads(CONFIG.read_text(encoding="utf-8"))
        bindings = {item["binding"]: item for item in config["d1_databases"]}
        if bindings["D1_01"]["migrations_dir"] != "migrations":
            raise AssertionError("D1-01 migration directory changed")
        if bindings["D1_04"]["migrations_dir"] != "migrations-d1-04":
            raise AssertionError("D1-04 must have a separate migration directory")
        if bindings["D1_01"]["database_id"] == bindings["D1_04"]["database_id"]:
            raise AssertionError("D1-01 and D1-04 must remain physically separate")

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(self.sql)
        self.db.executescript(self.payment_sql)
        self.db.executescript(self.saved_method_sql)

    def tearDown(self):
        self.db.close()

    def order(self, order_id="ord_1", customer="user_1", status="CREATED", version=1,
              currency="USD", subtotal=1000, discount=0, tax=0, total=1000,
              created=NOW, updated=NOW):
        # The schema requires the matching completed idempotency response first.
        self.idem(
            row_id="seed_idem_" + order_id,
            customer=customer,
            key="seed_key_" + order_id,
            response='{"orderId":"' + order_id + '"}',
        )
        self.db.execute(
            """INSERT INTO orders(order_id,customer_id,status,version,currency,subtotal_minor,
               discount_minor,tax_minor,total_minor,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (order_id, customer, status, version, currency, subtotal, discount, tax, total, created, updated),
        )

    def line(self, line_id="line_1", order_id="ord_1", item_type="MEMBERSHIP_PLAN",
             item_ref="plan_1", item_version="1", quantity=2, unit=500,
             subtotal=1000, discount=0, tax=0, total=1000,
             snapshot='{"planId":"plan_1","planVersion":1}'):
        self.db.execute(
            """INSERT INTO order_lines(order_line_id,order_id,item_type,item_ref,item_version,
               quantity,unit_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,
               line_total_minor,item_snapshot_json,created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (line_id, order_id, item_type, item_ref, item_version, quantity, unit, subtotal,
             discount, tax, total, snapshot, NOW),
        )

    def idem(self, row_id="idem_1", customer="user_1", key="key_1", request_hash="a"*64,
             state="COMPLETED", response_status=201, response='{"data":{"orderId":"ord_1"}}'):
        self.db.execute(
            """INSERT INTO order_create_idempotency(id,customer_id,operation_key,idempotency_key,
               request_hash,state,response_status,response_json,created_at,expires_at)
               VALUES(?,?,?, ?,?,?,?,?,?,?)""",
            (row_id, customer, "POST /v1/commerce/orders", key, request_hash, state,
             response_status, response, NOW, "2026-10-29T00:00:00.000Z"),
        )

    def payment(self, payment_id="pay_" + "a"*26, order_id="ord_1", customer="user_1",
                provider="hyperswitch", merchant="merchant_1", amount=1000, currency="USD",
                status="INITIATING", version=1, idempotency_key="payment_key_1",
                request_hash="b"*64, provider_updated_at=None, failure_code=None,
                created=NOW, updated=NOW):
        self.db.execute(
            """INSERT INTO payments(payment_id,order_id,customer_id,provider,merchant_id,
               amount_minor,currency,status,version,idempotency_key,request_hash,
               provider_updated_at,failure_code,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (payment_id, order_id, customer, provider, merchant, amount, currency, status,
             version, idempotency_key, request_hash, provider_updated_at, failure_code, created, updated),
        )

    def provider_event(self, row_id="evtrow_1", merchant="merchant_1", event_id="evt_1",
                       event_type="payment_succeeded", payment_id="pay_" + "a"*26,
                       payload_hash="c"*64, state="RECEIVED", received=NOW,
                       processed=None, outcome=None):
        self.db.execute(
            """INSERT INTO payment_provider_events(event_row_id,provider,merchant_id,event_id,
               event_type,payment_id,payload_sha256,state,received_at,processed_at,outcome_code)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (row_id, "hyperswitch", merchant, event_id, event_type, payment_id,
             payload_hash, state, received, processed, outcome),
        )

    def provider_event_conflict(self, conflict_id="conflict_1", merchant="merchant_1",
                                event_id="evt_1", existing_hash="c"*64, incoming_hash="d"*64,
                                state="OPEN", count=1, version=1, first_seen=NOW,
                                last_seen=NOW, resolved_at=None, resolution_code=None):
        self.db.execute(
            """INSERT INTO payment_provider_event_conflicts(conflict_id,provider,merchant_id,event_id,
               existing_payload_sha256,incoming_payload_sha256,state,occurrence_count,version,
               first_seen_at,last_seen_at,resolved_at,resolution_code)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (conflict_id, "hyperswitch", merchant, event_id, existing_hash, incoming_hash,
             state, count, version, first_seen, last_seen, resolved_at, resolution_code),
        )

    def test_only_expected_tables_and_indexes_exist(self):
        tables = {row[0] for row in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertEqual(tables, {
            "orders", "order_lines", "order_create_idempotency", "payments", "payment_provider_events",
            "payment_provider_event_conflicts", "saved_payment_methods", "payment_mandates",
        })
        indexes = {row[0] for row in self.db.execute("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")}
        self.assertTrue({
            "ix_orders_customer_created_order", "ix_orders_status_created_order",
            "ix_order_lines_order_id", "ix_order_lines_item_ref_version",
            "ix_order_create_idempotency_customer_created", "ix_order_create_idempotency_expiration",
            "ix_payments_customer_created_payment", "ix_payments_order_created_payment",
            "ix_payments_status_updated_payment", "ux_payments_single_live_or_successful_per_order", "ix_payment_provider_events_state_received",
            "ix_payment_provider_events_payment_received", "ix_payment_provider_event_conflicts_state_last_seen",
            "ix_payment_provider_event_conflicts_identity", "ix_saved_payment_methods_customer_created",
            "ux_payment_mandates_provider_mandate_id", "ix_payment_mandates_customer_status_created",
            "ix_payment_mandates_method_status",
        }.issubset(indexes))
        self.assertFalse(tables.intersection({"payment_intents", "ledger_entries", "refunds", "entitlements"}))
        self.assertNotIn("client_secret", {r[1] for r in self.db.execute('PRAGMA table_info("payments")')})
        self.assertNotIn("raw_body", {r[1] for r in self.db.execute('PRAGMA table_info("payment_provider_events")')})
        for table in ("orders", "order_lines", "order_create_idempotency", "payments",
                      "payment_provider_events", "payment_provider_event_conflicts",
                      "saved_payment_methods", "payment_mandates"):
            self.assertEqual(self.db.execute(f'PRAGMA foreign_key_list("{table}")').fetchall(), [])


    def test_order_insert_requires_matching_completed_idempotency_result(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO orders(order_id,customer_id,status,version,currency,subtotal_minor,
                   discount_minor,tax_minor,total_minor,created_at,updated_at)
                   VALUES('ord_unclaimed','user_1','CREATED',1,'USD',100,0,0,100,?,?)""",
                (NOW, NOW),
            )
        self.idem(row_id="idem_wrong_response", key="key_wrong_response",
                  response='{"orderId":"different_order"}')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO orders(order_id,customer_id,status,version,currency,subtotal_minor,
                   discount_minor,tax_minor,total_minor,created_at,updated_at)
                   VALUES('ord_wrong_response','user_1','CREATED',1,'USD',100,0,0,100,?,?)""",
                (NOW, NOW),
            )

    def test_order_constraints_and_immutable_money_snapshot(self):
        bad = [
            {"currency":"usd"}, {"status":"PAID"}, {"subtotal":-1, "total":-1},
            {"subtotal":1000, "discount":1001, "total":0}, {"subtotal":1000, "tax":1, "total":1000},
            {"subtotal":1.5, "total":1}, {"total":9007199254740992, "subtotal":9007199254740992},
        ]
        for i, kwargs in enumerate(bad):
            with self.subTest(i=i), self.assertRaises(sqlite3.IntegrityError):
                self.order(order_id=f"bad_{i}", **kwargs)
        self.order()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE orders SET total_minor=900 WHERE order_id='ord_1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE orders SET status='PENDING_PAYMENT' WHERE order_id='ord_1'")
        self.db.execute(
            "UPDATE orders SET status='PENDING_PAYMENT',version=2,updated_at=? WHERE order_id=? AND version=?",
            (LATER, "ord_1", 1),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE orders SET status='COMPLETED',version=3,updated_at=? WHERE order_id=? AND version=?",
                ("2026-10-28T00:00:02.000Z", "ord_1", 2),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM orders WHERE order_id='ord_1'")

    def test_order_line_requires_parent_and_is_immutable(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.line(order_id="missing")
        self.order()
        self.line()
        bad = [
            {"quantity":0, "subtotal":0, "total":0}, {"quantity":2, "unit":500, "subtotal":999, "total":999},
            {"item_type":"UNKNOWN"}, {"snapshot":"not-json"}, {"snapshot":"[]"},
            {"discount":1001, "subtotal":1000, "total":0},
        ]
        for i, kwargs in enumerate(bad):
            with self.subTest(i=i), self.assertRaises(sqlite3.IntegrityError):
                self.line(line_id=f"bad_line_{i}", **kwargs)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE order_lines SET quantity=3 WHERE order_line_id='line_1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM order_lines WHERE order_line_id='line_1'")

    def test_idempotency_scope_hash_and_response_constraints(self):
        self.idem()
        with self.assertRaises(sqlite3.IntegrityError):
            self.idem(row_id="duplicate")
        self.idem(row_id="another_user", customer="user_2")
        invalid = [
            {"request_hash":"g"*64}, {"state":"COMPLETED", "response_status":None, "response":None},
            {"state":"IN_PROGRESS", "response_status":201, "response":'{"data":1}'},
            {"state":"FAILED", "response_status":201, "response":'{"data":1}'},
        ]
        for i, kwargs in enumerate(invalid):
            with self.subTest(i=i), self.assertRaises(sqlite3.IntegrityError):
                self.idem(row_id=f"bad_idem_{i}", **kwargs)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE order_create_idempotency SET request_hash=? WHERE id='idem_1'", ("b"*64,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE order_create_idempotency SET response_json=? WHERE id='idem_1'", ('{"data":2}',))

    def test_transaction_rollback_keeps_order_line_and_idempotency_atomic(self):
        self.db.execute("BEGIN")
        try:
            self.idem(row_id="idem_atomic", key="key_atomic", state="IN_PROGRESS",
                      response_status=None, response=None)
            self.order(order_id="ord_atomic")
            with self.assertRaises(sqlite3.IntegrityError):
                self.line(line_id="line_atomic", order_id="ord_atomic", quantity=1, unit=10,
                          subtotal=999, total=999)
        finally:
            self.db.rollback()
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM orders WHERE order_id='ord_atomic'").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM order_lines WHERE order_line_id='line_atomic'").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM order_create_idempotency WHERE id='idem_atomic'").fetchone()[0], 0)

    def test_in_progress_record_can_complete_once(self):
        self.idem(row_id="idem_pending", key="key_pending", state="IN_PROGRESS",
                  response_status=None, response=None)
        self.db.execute(
            "UPDATE order_create_idempotency SET state='COMPLETED',response_status=201,response_json=? WHERE id='idem_pending'",
            ('{"data":{"orderId":"ord_2"}}',),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE order_create_idempotency SET response_json=? WHERE id='idem_pending'", ('{"data":2}',))


    def test_payment_must_match_an_owned_positive_order_snapshot(self):
        self.order()
        invalid = [
            {"customer":"other_user"},
            {"amount":999},
            {"currency":"EUR"},
        ]
        for i, kwargs in enumerate(invalid):
            with self.subTest(i=i), self.assertRaises(sqlite3.IntegrityError):
                self.payment(payment_id="pay_" + chr(ord("b")+i)*26,
                             **{k:v for k,v in kwargs.items() if k != "payment_id"})
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(payment_id="pay_short")
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(payment_id="pay_" + "bad!" + "a"*22)
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(order_id="missing")
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(provider="unknown_gateway")
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(amount=0)
        self.payment()
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(payment_id="pay_" + "d"*26, idempotency_key="payment_key_1")
        self.order(order_id="ord_2", customer="user_1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(payment_id="pay_" + "e"*26, order_id="ord_2", idempotency_key="payment_key_1")

    def test_order_cannot_have_two_live_or_successful_payment_attempts(self):
        self.order()
        self.payment()
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(payment_id="pay_" + "f"*26, idempotency_key="another_key")
        # Once a previous attempt has durably failed, the same order may have a new attempt.
        self.db.execute(
            """UPDATE payments SET status='failed',version=2,
               provider_updated_at=?,updated_at=? WHERE payment_id=? AND version=1""",
            (LATER, LATER, "pay_" + "a"*26),
        )
        self.payment(payment_id="pay_" + "f"*26, idempotency_key="another_key", created=LATER, updated=LATER)

    def test_payment_snapshot_cas_provider_timestamp_and_terminal_status_guards(self):
        self.order()
        self.payment()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE payments SET amount_minor=900 WHERE payment_id=?", ("pay_" + "a"*26,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE payments SET status='requires_payment_method',updated_at=? WHERE payment_id=?",
                (LATER, "pay_" + "a"*26),
            )
        self.db.execute(
            """UPDATE payments SET status='requires_payment_method',version=2,
               provider_updated_at=?,updated_at=? WHERE payment_id=? AND version=1""",
            (LATER, LATER, "pay_" + "a"*26),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE payments SET status='processing',version=3,
                   provider_updated_at=?,updated_at=? WHERE payment_id=? AND version=2""",
                (LATER, "2026-10-28T00:00:02.000Z", "pay_" + "a"*26),
            )
        self.db.execute(
            """UPDATE payments SET status='succeeded',version=3,
               provider_updated_at=?,updated_at=? WHERE payment_id=? AND version=2""",
            ("2026-10-28T00:00:02.000Z", "2026-10-28T00:00:02.000Z", "pay_" + "a"*26),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE payments SET status='processing',version=4,
                   provider_updated_at=?,updated_at=? WHERE payment_id=? AND version=3""",
                ("2026-10-28T00:00:03.000Z", "2026-10-28T00:00:03.000Z", "pay_" + "a"*26),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM payments WHERE payment_id=?", ("pay_" + "a"*26,))

    def test_webhook_inbox_enforces_deduplication_and_terminal_immutability(self):
        self.provider_event()
        with self.assertRaises(sqlite3.IntegrityError):
            self.provider_event(row_id="evtrow_dup", payload_hash="d"*64)
        self.db.execute(
            """UPDATE payment_provider_events SET state='APPLIED',processed_at=?,outcome_code='APPLIED'
               WHERE event_row_id='evtrow_1'""",
            (LATER,),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE payment_provider_events SET outcome_code='RECONCILIATION_REQUIRED' WHERE event_row_id='evtrow_1'"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM payment_provider_events WHERE event_row_id='evtrow_1'")

    def test_webhook_inbox_rejects_incomplete_or_malformed_deduplication_facts(self):
        invalid = [
            {"event_id":""},
            {"payload_hash":"g"*64},
            {"state":"APPLIED", "processed":None},
            {"state":"RECEIVED", "processed":LATER},
        ]
        for i, kwargs in enumerate(invalid):
            with self.subTest(i=i), self.assertRaises(sqlite3.IntegrityError):
                self.provider_event(
                    row_id="bad_evt_"+str(i),
                    event_id=kwargs.get("event_id","evt_"+str(i)),
                    payload_hash=kwargs.get("payload_hash","c"*64),
                    state=kwargs.get("state","RECEIVED"),
                    processed=kwargs.get("processed"),
                )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO payment_provider_events(event_row_id,provider,merchant_id,event_id,
                   event_type,payment_id,payload_sha256,state,received_at)
                   VALUES('bad_provider','another_provider','merchant_1','evt_provider',
                   'payment_succeeded',NULL,?,'RECEIVED',?)""",
                ("c"*64, NOW),
            )


    def test_mismatched_webhook_replay_has_durable_conflict_and_reconciliation_lifecycle(self):
        self.provider_event()
        self.provider_event_conflict()
        with self.assertRaises(sqlite3.IntegrityError):
            self.provider_event_conflict(conflict_id="conflict_duplicate")
        # Another payload hash for the same upstream event creates a separately
        # auditable conflict record; no raw event body is persisted.
        self.provider_event_conflict(
            conflict_id="conflict_payload_2",
            incoming_hash="e"*64,
        )
        self.db.execute(
            """UPDATE payment_provider_event_conflicts
               SET occurrence_count=2,version=2,last_seen_at=? WHERE conflict_id='conflict_1'""",
            (LATER,),
        )
        self.db.execute(
            """UPDATE payment_provider_event_conflicts
               SET state='RESOLVED',version=3,resolved_at=?,resolution_code='MANUAL_RECONCILIATION'
               WHERE conflict_id='conflict_1'""",
            ("2026-10-28T00:00:02.000Z",),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE payment_provider_event_conflicts
                   SET state='OPEN',version=4,last_seen_at=? WHERE conflict_id='conflict_1'""",
                ("2026-10-28T00:00:03.000Z",),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM payment_provider_event_conflicts WHERE conflict_id='conflict_1'")

    def test_webhook_conflict_requires_distinct_valid_hashes_and_version_cas(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.provider_event_conflict(existing_hash="c"*64, incoming_hash="c"*64)
        with self.assertRaises(sqlite3.IntegrityError):
            self.provider_event_conflict(conflict_id="conflict_bad_hash", incoming_hash="g"*64)
        self.provider_event()
        self.provider_event_conflict()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """UPDATE payment_provider_event_conflicts
                   SET occurrence_count=2,last_seen_at=? WHERE conflict_id='conflict_1'""",
                (LATER,),
            )


    def test_saved_method_and_mandate_require_provider_verified_payment_and_start_pending(self):
        self.order()
        self.payment(status="succeeded", provider_updated_at=NOW)
        self.provider_event(event_id="evt_saved", event_type="payment_succeeded",
                            payment_id="pay_" + "a"*26, state="RECEIVED")

        saved_id = "spm_" + "s"*26
        method_id = "pm_hyperswitch_test_123"
        self.db.execute(
            """INSERT INTO saved_payment_methods(saved_payment_method_id,provider,merchant_id,customer_id,
               payment_method_id,source_payment_id,source_event_id,created_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (saved_id, "hyperswitch", "merchant_1", "user_1", method_id,
             "pay_" + "a"*26, "evt_saved", NOW),
        )
        mandate_id = "mnd_" + "m"*26
        self.db.execute(
            """INSERT INTO payment_mandates(mandate_record_id,provider,merchant_id,customer_id,payment_method_id,
               source_payment_id,source_event_id,consent_accepted_at,consent_acceptance_type,consent_scope,
               consent_terms_version,provider_mandate_id,status,version,provider_updated_at,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (mandate_id, "hyperswitch", "merchant_1", "user_1", method_id,
             "pay_" + "a"*26, "evt_saved", NOW, "online", "OFF_SESSION_RECURRING",
             "luckread-recurring-consent-v1", "mandate_1", "PENDING_PROVIDER_CONFIRMATION",
             1, None, NOW, NOW),
        )
        stored = self.db.execute(
            "SELECT status, version, provider_updated_at, consent_acceptance_type, consent_scope FROM payment_mandates WHERE mandate_record_id=?",
            (mandate_id,),
        ).fetchone()
        self.assertEqual(stored, ("PENDING_PROVIDER_CONFIRMATION", 1, None, "online", "OFF_SESSION_RECURRING"))

        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO payment_mandates(mandate_record_id,provider,merchant_id,customer_id,payment_method_id,
                   source_payment_id,source_event_id,consent_accepted_at,consent_acceptance_type,consent_scope,
                   consent_terms_version,provider_mandate_id,status,version,provider_updated_at,created_at,updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                ("mnd_" + "n"*26, "hyperswitch", "merchant_1", "user_1", method_id,
                 "pay_" + "a"*26, "evt_saved", NOW, "online", "OFF_SESSION_RECURRING",
                 "luckread-recurring-consent-v1", "mandate_2", "ACTIVE", 1, NOW, NOW, NOW),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE saved_payment_methods SET payment_method_id=? WHERE saved_payment_method_id=?",
                ("pm_changed", saved_id),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM payment_mandates WHERE mandate_record_id=?", (mandate_id,))

    def test_saved_method_rejects_missing_provider_event_and_cross_customer_token_binding(self):
        self.order()
        self.payment(status="succeeded", provider_updated_at=NOW)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO saved_payment_methods(saved_payment_method_id,provider,merchant_id,customer_id,
                   payment_method_id,source_payment_id,source_event_id,created_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                ("spm_" + "x"*26, "hyperswitch", "merchant_1", "user_1", "pm_missing_event",
                 "pay_" + "a"*26, "evt_missing", NOW),
            )

        shared_method_id = "pm_customer_bound_token"
        self.provider_event(event_id="evt_owner", payment_id="pay_" + "a"*26)
        self.db.execute(
            """INSERT INTO saved_payment_methods(saved_payment_method_id,provider,merchant_id,customer_id,
               payment_method_id,source_payment_id,source_event_id,created_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            ("spm_" + "s"*26, "hyperswitch", "merchant_1", "user_1", shared_method_id,
             "pay_" + "a"*26, "evt_owner", NOW),
        )

        self.order(order_id="ord_2", customer="user_2")
        other_payment_id = "pay_" + "b"*26
        self.payment(payment_id=other_payment_id, order_id="ord_2", customer="user_2",
                     idempotency_key="payment_key_2", status="succeeded", provider_updated_at=NOW)
        self.provider_event(row_id="evtrow_other_customer", event_id="evt_other_customer", payment_id=other_payment_id)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO saved_payment_methods(saved_payment_method_id,provider,merchant_id,customer_id,
                   payment_method_id,source_payment_id,source_event_id,created_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                ("spm_" + "t"*26, "hyperswitch", "merchant_1", "user_2", shared_method_id,
                 other_payment_id, "evt_other_customer", NOW),
            )

if __name__ == "__main__":
    unittest.main(verbosity=2)
