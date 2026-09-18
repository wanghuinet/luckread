# Legacy Payload Root Archive

Archived from the repository-root `src/` tree at commit `1ec339311fdfe983c9bb7b996b9ecaabd7098143`.

Status: historical reference only. This directory is not an active runtime and MUST NOT be used for new implementation work.

Active Payload runtime authority:
- `workers/W01-payload/`

Reason for archival:
- remove the duplicate root Payload runtime so implementation work cannot drift back into the legacy root tree;
- preserve the legacy source as auditable historical material;
- keep existing contracts and evidence history intact while making W01 the only active Payload code location.

The archived tree is intentionally kept byte-for-byte as the pre-cleanup Git tree object; no business logic is promoted by this archive.
