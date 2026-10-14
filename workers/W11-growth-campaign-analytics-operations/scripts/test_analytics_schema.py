#!/usr/bin/env python3
"""Exercise the W11 D1-05 migration and the exact projection SQL used by the adapter."""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations" / "0001_analytics_projection.sql"
STORE = ROOT / "src" / "analytics-d1-store.ts"
SQL_COLUMNS = (
    "event_id, dedupe_key, schema_version, event_name, source_worker, occurred_at, "
    "received_at, hour_start, actor_type, content_id, content_type, creator_id, "
    "duration_ms, position, metric_version, projection_status"
)


def extract_sql(source: str, constant: str) -> str:
    match = re.search(
        rf"const {re.escape(constant)} = String\.raw`(.*?)`",
        source,
        flags=re.DOTALL,
    )
    if not match:
        raise AssertionError(f"Unable to extract {constant} from analytics-d1-store.ts")
    return match.group(1)


def event(
    event_id: str,
    dedupe_key: str,
    name: str,
    worker: str = "W03",
    content_id: str | None = "article_01",
    content_type: str | None = "article",
    creator_id: str | None = None,
    duration_ms: int | None = None,
) -> tuple[object, ...]:
    occurred = "2026-10-14T00:12:34.000Z"
    hour = "2026-10-14T00:00:00.000Z"
    return (
        event_id, dedupe_key, "1.0", name, worker, occurred, occurred, hour,
        "user", content_id, content_type, creator_id, duration_ms, None, "1.0", "PENDING",
    )


def apply_batch(
    connection: sqlite3.Connection,
    rows: list[tuple[object, ...]],
    content_sql: str,
    creator_sql: str,
    mark_applied_sql: str,
) -> int:
    if not rows:
        return 0
    placeholders = "(" + ", ".join("?" for _ in rows[0]) + ")"
    insert_sql = (
        f"INSERT INTO analytics_event_dedupe ({SQL_COLUMNS}) VALUES "
        + ", ".join(placeholders for _ in rows)
        + " ON CONFLICT DO NOTHING"
    )
    connection.execute("BEGIN")
    try:
        inserted = connection.execute(
            insert_sql, [value for row in rows for value in row]
        ).rowcount
        connection.execute(content_sql)
        connection.execute(creator_sql)
        connection.execute(mark_applied_sql)
        connection.commit()
        return inserted
    except Exception:
        connection.rollback()
        raise


def main() -> None:
    schema = MIGRATION.read_text(encoding="utf-8")
    store_source = STORE.read_text(encoding="utf-8")
    content_sql = extract_sql(store_source, "CONTENT_PROJECTION_SQL")
    creator_sql = extract_sql(store_source, "CREATOR_PROJECTION_SQL")
    mark_applied_sql = extract_sql(store_source, "MARK_APPLIED_SQL")

    db = sqlite3.connect(":memory:")
    db.executescript(schema)

    columns = {
        row[1] for row in db.execute("PRAGMA table_info(analytics_event_dedupe)")
    }
    assert "event_id" in columns and "dedupe_key" in columns
    assert not {"actor_id", "visitor_id", "session_id"}.intersection(columns), (
        "D1-05 event rows must not persist direct identity/session fields"
    )

    first_batch = [
        event("evt_schema_0001", "dedupe_schema_0001", "content_open"),
        event("evt_schema_0002", "dedupe_schema_0002", "content_open"),
        event("evt_schema_0003", "dedupe_schema_0003", "read_dwell", duration_ms=1250),
        event("evt_schema_0004", "dedupe_schema_0004", "like_created", "W05", "article_01", "article"),
        event("evt_schema_0005", "dedupe_schema_0005", "dwell", content_id="post_01", content_type="post", duration_ms=800),
        event("evt_schema_0006", "dedupe_schema_0006", "video_watch", content_id="video_01", content_type="video", duration_ms=2200),
        event("evt_schema_0007", "dedupe_schema_0007", "follow_created", "W05", None, None, "creator_01"),
        event("evt_schema_0008", "dedupe_schema_0008", "follow_removed", "W05", None, None, "creator_01"),
    ]
    inserted = apply_batch(db, first_batch, content_sql, creator_sql, mark_applied_sql)
    assert inserted == 8, f"expected 8 inserted events, got {inserted}"

    article = db.execute(
        "SELECT opens, read_duration_ms, read_duration_events, likes "
        "FROM analytics_content_hourly WHERE content_id = 'article_01'"
    ).fetchone()
    assert article == (2, 1250, 1, 1), f"unexpected article projection: {article}"

    post = db.execute(
        "SELECT dwell_duration_ms, dwell_events FROM analytics_content_hourly WHERE content_id = 'post_01'"
    ).fetchone()
    assert post == (800, 1), f"unexpected post projection: {post}"

    video = db.execute(
        "SELECT video_watch_ms, video_watch_events FROM analytics_content_hourly WHERE content_id = 'video_01'"
    ).fetchone()
    assert video == (2200, 1), f"unexpected video projection: {video}"

    creator = db.execute(
        "SELECT followers_gained, followers_lost FROM analytics_creator_hourly WHERE creator_id = 'creator_01'"
    ).fetchone()
    assert creator == (1, 1), f"unexpected creator projection: {creator}"
    assert db.execute(
        "SELECT COUNT(*) FROM analytics_event_dedupe WHERE projection_status = 'PENDING'"
    ).fetchone()[0] == 0, "all committed events should be marked APPLIED"

    # Replaying an event ID or a dedupe key must not increment the projection.
    duplicates = [
        event("evt_schema_0001", "dedupe_replayed_different", "content_open"),
        event("evt_schema_newid", "dedupe_schema_0002", "content_open"),
    ]
    inserted = apply_batch(db, duplicates, content_sql, creator_sql, mark_applied_sql)
    assert inserted == 0, f"duplicate events unexpectedly inserted: {inserted}"
    assert db.execute(
        "SELECT opens FROM analytics_content_hourly WHERE content_id = 'article_01'"
    ).fetchone()[0] == 2, "replayed events must not double-count"

    # One bad owner/event mapping fails the whole transaction; it is not silently ignored.
    bad = [event("evt_schema_bad", "dedupe_schema_bad", "content_open", "W05")]
    try:
        apply_batch(db, bad, content_sql, creator_sql, mark_applied_sql)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("schema must reject a W05 content_open event")
    assert db.execute(
        "SELECT COUNT(*) FROM analytics_event_dedupe WHERE event_id = 'evt_schema_bad'"
    ).fetchone()[0] == 0

    # Projections are written once per grouped dimension, not once per input event.
    grouping = content_sql.upper()
    assert "GROUP BY HOUR_START, CONTENT_TYPE, CONTENT_ID, METRIC_VERSION" in grouping
    assert "ON CONFLICT" in grouping
    assert "PROJECTION_STATUS = 'PENDING'" in grouping

    print("W11 D1-05 schema smoke test passed: migration, grouped projections, dedupe, privacy, rollback")


if __name__ == "__main__":
    main()
