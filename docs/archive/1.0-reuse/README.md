# LuckRead 1.0 文档备份索引

状态：**ARCHIVED / NON-AUTHORITATIVE**

本目录用于记录已从活动 `docs/` 区域移除的 1.0 复用闭环文档。

## 备份原则

1. 删除前已确认文件存在于 GitHub `main`。
2. Git 本身保留删除前的完整历史内容，可通过原 commit/blob SHA 恢复。
3. 下表记录删除前文件路径、blob SHA 与最终用途，作为可恢复索引。
4. 这些文档仅用于历史追溯、审计和恢复，不再作为当前架构、功能或 Contract 权威。
5. 当前实现权威仍为冻结后的 Blueprint、Canonical Contract、代码及可验证 CI Evidence。

## 已备份文档

| 原路径 | 删除前 Blob SHA | 分类 |
|---|---|---|
| `docs/00-LUCKREAD-1.0-HIGH-VALUE-REUSE-ALLOCATION-CLOSURE-v1.0.md` | `ff8eabdd24cf0c07c7d9bcf4f58c2350434f6be9` | 1.0 High-Value Reuse |
| `docs/00-LUCKREAD-1.0-REUSE-CLOSURE-BATCH-R1-API-CONTRACT-v1.0.md` | `3dd95a95ea608df233769e3a83d455611f3153a1` | R1 API / Contract |
| `docs/00-LUCKREAD-1.0-REUSE-CLOSURE-BATCH-R2-AUTHZ-SECURITY-v1.0.md` | `8e834e18929cd1af134dee5b4e0b44f52ef2ff7c` | R2 AuthZ / Security |
| `docs/00-LUCKREAD-1.0-REUSE-CLOSURE-BATCH-R4-EVENT-JOB-QUEUE-v1.0.md` | `2febe15de674bc95b54b5e1459e883e54e566bc3` | R4 Event / Job / Queue |
| `docs/00-LUCKREAD-1.0-REUSE-CLOSURE-BATCH-R6-PAY-COMMERCE-REVENUE-v1.0.md` | `37bddf70d0758ff038f6aca8118fca660b4888e8` | R6 PAY / Commerce / Revenue |
| `docs/00-LUCKREAD-1.0-REUSE-CLOSURE-BATCH-R7-IP-RIGHTS-MCN-v1.0.md` | `25a2a21d74fec2250098a7ac8ba6ecf0d4824232` | R7 IP / Rights / MCN |
| `docs/00-LUCKREAD-1.0-REUSE-CLOSURE-BATCH-R8-DATA-MIGRATION-PORTABILITY-v1.0.md` | `3d784e4ea296da6b569d8aca8636fc3443ac5782` | R8 Data / Migration / Portability |
| `docs/00-LUCKREAD-1.0-REUSE-CLOSURE-BATCH-R9-CI-VALIDATOR-EVIDENCE-v1.0.md` | `6e43267613e3b54108a0f5d841b7eccfad7a8c99` | R9 CI / Validator / Evidence |
| `docs/00-LUCKREAD-1.0-REUSE-CLOSURE-BATCH-R10-LEGACY-FINAL-DISPOSITION-v1.0.md` | `7499cd3e0a5be4ef7eb44b08c5d8190da7fe9e4c` | R10 Legacy Final Disposition |

## Not present as standalone active files

R3 State Machine and R5 Advertising were incorporated/audited through existing canonical state-machine and advertising assets rather than remaining as standalone 1.0 R3/R5 closure files. Therefore no nonexistent files are manufactured merely for archival symmetry.

## Recovery

To recover any archived document, use its recorded blob SHA or inspect Git history before the removal commit. Recovery must not make the recovered document authoritative again; it remains historical reference unless explicitly superseded into a current Contract.

## Post-1.0 rule

The 1.0 reuse cycle is closed. Do not create R11/R12/etc. Broad 1.0 audits are not part of normal development. New work follows:

`Feature ID -> Contract -> Reuse/Refactor -> Missing Implementation -> Tests -> CI -> SHA -> Evidence -> Verified`
