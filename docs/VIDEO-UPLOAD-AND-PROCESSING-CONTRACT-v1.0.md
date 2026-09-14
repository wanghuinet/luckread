# VIDEO UPLOAD AND PROCESSING CONTRACT v1.0

## 1. Scope

This contract defines the platform-neutral video upload, resumable transfer, validation, processing, and delivery state model. It is designed for the Cloudflare D1 + R2 baseline while keeping persistence portable to PostgreSQL-compatible deployments.

## 2. Upload identity

Every upload has a globally unique `uploadId`. A video asset has exactly one active upload session. The upload session records owner, expected SHA-256, expected byte size, chunk size, total chunks, received chunks, object key, expiry, lifecycle state, and optimistic version.

## 3. Idempotency

`(uploadId, partNumber)` is the logical idempotency key. Repeating the same part with the same SHA-256 and size is a successful no-op. Reusing a part number with different bytes or checksum is a conflict and must never silently overwrite the existing part record.

## 4. Security invariants

- Only the authenticated owner or an explicitly authorized organization scope may mutate an upload.
- Client input must never choose an arbitrary R2 object key.
- Upload expiry is enforced server-side.
- Part number must be within `1..totalChunks`.
- Declared size, MIME type and final SHA-256 are validated before the asset becomes READY.
- A client cannot mark a video as READY or create a successful processing result directly.
- Processing jobs are system-controlled and retryable.

## 5. Lifecycle

Session: `OPEN → COMPLETING → COMPLETED | FAILED | CANCELLED | EXPIRED`.

Asset: `UPLOADING → UPLOADED → VALIDATING → QUEUED → PROCESSING → READY | FAILED | CANCELLED → DELETED`.

Processing stages: `VALIDATE → PROBE → TRANSCODE → POSTER → PUBLISH`.

## 6. Completion requirements

Completion requires every expected part to be present and verified, total received bytes to equal the declared size, and the assembled object checksum to equal the declared SHA-256. Only then may the asset enter `UPLOADED` and a processing job be queued.

## 7. Retry

Transient processing failures use bounded retries with `attempts`, `maxAttempts`, `nextAttemptAt`, and structured error code/message. Permanent validation failures do not retry automatically.

## 8. Delivery

A READY asset may expose only server-generated delivery references: HLS master and/or MP4 variant plus poster. Internal source object keys and upload-part keys are not public API fields.

## 9. Portability

The database model uses ordinary relational fields, unique keys, indexes, relationships, timestamps, and numeric versioning. No Cloudflare-only database primitive is part of the logical contract. R2 remains the storage adapter behind the object-key abstraction.

## 10. Required API surface

The implementation phase must provide:

1. `POST /video-uploads/init`
2. `PUT /video-uploads/:uploadId/parts/:partNumber`
3. `POST /video-uploads/:uploadId/complete`
4. `GET /video-uploads/:uploadId`
5. `POST /video-uploads/:uploadId/cancel`
6. `POST /video-uploads/:uploadId/retry`
7. `GET /video-assets/:id/playback`

The API must use request idempotency where a state-changing operation can be retried by mobile clients.
