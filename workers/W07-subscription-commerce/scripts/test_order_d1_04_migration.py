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
CONFIG = WORKER / "wrangler.jsonc"
NOW = "2026-10-28T00:00:00.000Z"
LATER = "2026-10-28T00:00:01.000Z"


class D104OrderMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.payment_sql = PAYMENT_MIGRATION.read_text(encoding="utf-8")
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

    def test_only_expected_tables_and_indexes_exist(self):
        tables = {row[0] for row in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertEqual(tables, {
            "orders", "order_lines", "order_create_idempotency", "payments", "payment_provider_events",
        })
        indexes = {row[0] for row in self.db.execute("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")}
        self.assertTrue({
            "ix_orders_customer_created_order", "ix_orders_status_created_order",
            "ix_order_lines_order_id", "ix_order_lines_item_ref_version",
            "ix_order_create_idempotency_customer_created", "ix_order_create_idempotency_expiration",
            "ix_payments_customer_created_payment", "ix_payments_order_created_payment",
            "ix_payments_status_updated_payment", "ix_payment_provider_events_state_received",
            "ix_payment_provider_events_payment_received",
        }.issubset(indexes))
        self.assertFalse(tables.intersection({"payment_intents", "ledger_entries", "refunds", "entitlements"}))
        self.assertNotIn("client_secret", {r[1] for r in self.db.execute('PRAGMA table_info("payments")')})
        self.assertNotIn("raw_body", {r[1] for r in self.db.execute('PRAGMA table_info("payment_provider_events")')})

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
            {"payment_id":"pay_" + "z"*26, "customer":"other_user"},
            {"payment_id":"pay_" + "y"*26, "amount":999},
            {"payment_id":"pay_" + "x"*26, "currency":"EUR"},
            {"payment_id":"pay_short"},
            {"payment_id":"pay_" + "bad!" + "a"*22},
        ]
        for i, kwargs in enumerate(invalid):
            with self.subTest(i=i), self.assertRaises(sqlite3.IntegrityError):
                self.payment(payment_id="pay_" + chr(ord("b")+i)*26,
                             **{k:v for k,v in kwargs.items() if k != "payment_id"})
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(order_id="missing")
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(provider="unknown_gateway")
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(amount=0)
        self.payment()
        with self.assertRaises(sqlite3.IntegrityError):
            self.payment(payment_id="pay_" + "d"*26, idempotency_key="payment_key_1")

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
