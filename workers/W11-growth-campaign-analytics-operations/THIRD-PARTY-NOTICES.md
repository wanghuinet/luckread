# Third-party notices

## Traks shared analytics period and timezone helpers

- Upstream repository: https://github.com/shivamanupadi/traks
- Immutable upstream revision: `5b3a97eb4d403c170479a2626697eb4fd9604c36`
- Upstream source: `packages/shared/src/queries.ts` (timezone-aware period and bucket helpers)
- Upstream license: MIT, from the `LICENSE` file at the pinned revision
- Reuse type: adapted source-code reuse; only pure period/timezone helpers are included
- LuckRead changes: renamed functions/types and removed Traks-specific R2 SQL/query dependencies; W11 tests cover timezone and DST behavior
- Upstream module copyright: © 2026 Shivaprasad Manupadi

MIT License

Copyright (c) 2026 Shivaprasad Manupadi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## Open-source reuse assessment for W11 PR #1020

### Scope actually reused in this slice

- Reused capability: IANA-timezone reporting windows, local calendar-day calculations, hour/day/week bucket labels, DST-aware calendar stepping, and bounded formatter caching.
- Local implementation: `src/analytics-period.ts`.
- Local tests: `src/analytics-period.test.ts`.
- Evidence: the W11 Runtime CI run linked from PR #1020; this source reuse is not a production dashboard integration by itself.
- This inventory records source provenance and license only for the files actually adapted. It does **not** state that the overall 80% generic analytics reuse target has been achieved.

### Facet assessment

- Upstream repository: https://github.com/writerslogic/facet
- Inspected source: `packages/shared/src/schemas.ts` and `packages/shared/src/events.ts` at immutable revision `393ecb455dd834670c9ba704b6426904412918d2`.
- The inspected MIT-licensed shared event schema is designed for website traffic collection (`site_id`, `hostname`, `path`, `referrer`, and browser-tracker properties). It is not a drop-in schema for LuckRead's W03 content and W05 social business events, so it was **not copied or imported** into the current event-quality implementation.
- The Facet server/dashboard runtime was not copied. The reuse plan records its AGPL-3.0-only core as license-gated; the compatible MIT shared package is assessed separately from that core.

### Explicit compatibility exclusions

- Traks' R2 SQL query builders, its hot-storage Durable Object, Cloudflare Pipelines/Iceberg ingestion, R2 SQL reporting, and multi-worker topology were not copied or introduced.
- No Traks runtime, database schema, API, identity system, Queue, Durable Object, Worker, D1 binding, or Service Binding was added to LuckRead.
- W11's domain-specific W03/W05 event validation and business-metric mapping remain LuckRead-specific code in this PR. They still require additional reuse review before any claim against the 80% target.
- Umami remains the selected web-traffic analytics layer per `docs/analytics/decision.md`; it is separate from W11's domain-authoritative business analytics. This PR does not claim production Umami event collection or production creator analytics persistence.
