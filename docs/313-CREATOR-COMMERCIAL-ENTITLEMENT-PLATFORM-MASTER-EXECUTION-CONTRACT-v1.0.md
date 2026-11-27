# LuckRead Creator Commercial Membership & Entitlement Platform — Master Execution Contract v1.0

**状态：CONTRACT PROPOSED / IMPLEMENTATION NOT VERIFIED**  
**日期：2026-11-27**  
**仓库：wanghuinet/luckread**  
**基线：main @ 8ab5c22ec9d454fc9777ccfbe4cb8f821b300a46**  
**定位：创作者商业化、会员订阅、数字内容销售与统一权益的总执行契约**

> 本文件是既有商业、会员、订单、账务和内容合同的产品范围整合与分阶段执行入口，不创建第二套领域权威，不覆盖既有合同的细节定义。出现冲突时必须停止并按仓库权威合同裁决，不能由 GPT 自行选择有利解释。

## 1. 目标与产品原则

LuckRead 的商业权益系统以 Substack 的付费出版与创作者订阅为基础，吸收 Patreon 等平台的多级会员、创作者福利和社区商业化模式，形成覆盖 APP、H5、PC 的统一商业产品。

完整用户链路：

免费发现内容 → 关注创作者 → 查看会员方案 → 订阅或购买 → 服务端确认交易 → 授予权益 → 阅读文章/观看视频/使用会员功能 → 续费、升级、暂停、取消或退款 → 创作者查看增长、收入和转化。

核心原则：

1. 免费关注与付费订阅是两种独立关系；关注不收费，不自动创建订阅。
2. 按本产品规则，创作者会员订阅入口在用户关注该创作者后开放。取消关注不得自动取消已购买订阅，也不得单独撤销已获得的付费权益。
3. 会员资格不是内容权限本身。所有访问都必须由服务端根据有效权益、内容范围和当前策略作最终判定。
4. 付费方案属于具体创作者或经批准的组织主体；不得把创作者会员误做成一个覆盖全站的通用会员。
5. 订阅、一次性订单、赠送、团体席位可以产生权益，但不能各自维护一套相互冲突的访问规则。
6. 交易成功、权益授予、内容可访问、创作者收入确认和可提现余额是不同事实，必须分层处理。
7. APP、H5、PC 共享 W01 API、DTO、状态语义和权限结果；不得三端各自实现一套商业逻辑。
8. 复用仓库已有实现与成熟依赖，最小自研；不因本合同引入新的 Worker、数据库、Queue、Service Binding 或第二套商业系统。

## 2. 权威合同与执行关系

本文件必须与以下既有合同一起使用：

| 领域 | 既有权威文档 | 本文件关系 |
|---|---|---|
| 商业化总边界 | docs/65-MONETIZATION-COMMERCE-SYSTEM-CONTRACT-v1.0.md | 商品、报价、订单、支付、退款、权益、风险与商业化总边界 |
| 会员与订阅 | docs/108-MEMBERSHIP-AND-SUBSCRIPTION-SYSTEM-CONTRACT-v1.0.md | 会员计划、订阅生命周期、权益生命周期权威 |
| 会员追踪与准入 | docs/109-MEMBERSHIP-L1-L4-TRACEABILITY-AND-CONTRACT-ADMISSION-v1.0.md | L1-L4 到实现和证据追踪 |
| 会员数据 | docs/110-MEMBERSHIP-DATA-CONTRACT-v1.0.md | 会员/订阅/权益数据模型 |
| 会员 API | docs/111-MEMBERSHIP-API-CONTRACT-v1.0.md | 会员公开 API 和 mutation 规则 |
| 会员事件 | docs/112-MEMBERSHIP-EVENT-CONTRACT-v1.0.md | 事件 envelope、去重、重放 |
| 会员安全 | docs/113-MEMBERSHIP-PERMISSION-AND-SECURITY-CONTRACT-v1.0.md | 身份、scope、隐私和授权 |
| 会员测试 | docs/114-MEMBERSHIP-TEST-AND-ACCEPTANCE-CONTRACT-v1.0.md | 会员测试与验收 |
| 会员准入 | docs/115-MEMBERSHIP-READY-ADMISSION-GATE-v1.0.md | 会员系统最终准入 |
| 订单履约 | docs/124-COMMERCE-ORDER-FULFILLMENT-OPERATIONS-CONTRACT-v1.0.md 至 docs/131-COMMERCE-ORDER-FULFILLMENT-READY-ADMISSION-GATE-v1.0.md | 一次性购买、数字交付、退款与售后 |
| 创作者中心 | docs/43-CREATOR-CENTER-EXPERIENCE-CONTRACT-v1.0.md | 创作者配置、会员管理与经营体验 |
| 创作者系统 | docs/76-CREATOR-SYSTEM-CONTRACT-v1.0.md 至 docs/83-CREATOR-SYSTEM-READY-ADMISSION-GATE-v1.0.md | 创作者身份、归属、团队 scope |
| 钱包账务 | docs/68-WALLET-LEDGER-AND-SETTLEMENT-CONTRACT-v1.0.md | 收入确认、余额、结算与资金事实 |
| 分析 | docs/69-ANALYTICS-EXPERIMENT-GROWTH-CONTRACT-v1.0.md | 事件分析、转化与增长指标 |
| 内容 | docs/10-P0-CONTENT-AND-IP-GRAPH-CONTRACT-v1.0.md 及 W03 内容权威 | 内容正文、发布状态和内容访问执行 |
| 全局权限 | docs/04-P0-PERMISSION-RBAC-CONTRACT-v1.0.md、docs/14-P0-AUTHORIZATION-CONTRACT-RECONCILIATION-v1.0.md | 统一授权链与默认拒绝 |

GPT 必须先阅读上述适用合同及其最新准入文件，再核对仓库现有实现。不得仅凭本文件推翻既有数据/API/事件合同。若高级功能需要新增字段、API、事件、权限或状态机，先按变更控制补齐对应子合同，再实现。

## 3. 系统架构与领域责任

固定边界：

- W01 Payload：APP/H5/PC 唯一应用 API 边界、DTO、会话与产品体验适配；前端不得直连数据库或 W07/W03 内部存储。
- W02：身份与认证权威。
- W03：内容权威和内容访问执行；会员内容、视频、文章、合集、单篇购买均须由 W03 在服务端校验 W07/Membership 提供的有效权益结果。
- W05：关注/社交关系权威；免费关注与付费订阅必须分离。
- W07：会员方案、订阅生命周期、商业订单/支付适配和权益来源编排，严格遵守 65、108-115、124-131 的职责边界。
- W08：CASL/统一授权能力，不允许商业模块绕过统一授权。
- W10：既有 Queue/异步执行边界，负责允许的续费、通知、对账、事件分发等异步工作。
- W11：分析事件接收、去重和分析查询/聚合边界；不作为支付、订阅或 Ledger 的事实来源。
- W68：不可变财务事实、钱包投影、结算与提现权威。

### 3.1 销售方、平台角色与资金边界（用户已确认：创作者为销售方）

**产品决策：各创作者是其所发布付费内容、会员方案及数字商品的 Seller of Record（销售方）；LuckRead 是提供发现、交易界面、订单编排、支付技术接入、内容交付和平台服务的 marketplace / technology platform，不默认作为创作者商品的转售方或主要销售方。**

强制边界：

1. 每笔交易必须绑定唯一 seller/creator legal entity、seller account、商品/方案 owner、交易地区、币种和适用税务上下文；不得只记录 LuckRead 平台主体。
2. 创作者必须完成支付服务商要求的身份/KYC、受益所有人、制裁筛查、收款账户、税务资料和地区准入。未完成 onboarding 或 seller account 未获 provider 放行时，不得开放真实收费。
3. 支付集成必须验证当前支付服务商及 Hyperswitch 所配置 connector 是否真实支持 marketplace / connected-account 场景、创作者作为 merchant/seller、资金分配、退款/拒付责任、余额负数、reserve、payout 和对账。不得仅凭 API 字段或 Sandbox mock 宣称支持。
4. 交易必须保存 seller-of-record 快照、provider account / payment reference、gross amount、currency、platform fee、processor fee、tax amount、refund/chargeback、seller net proceeds、payout/settlement 状态。历史订单不得因创作者资料或平台费率变化而改写。
5. LuckRead 平台服务费必须作为独立、可审计的 fee line / application fee 处理；费率、计算基数、税务处理、退款时是否退回平台费，必须由合同和 provider 能力明确。不得把平台收入与创作者销售额混为同一笔收入。
6. W68 是平台及创作者资金分录/余额/结算的财务事实权威；支付服务商报告是外部资金事实输入；W11 仅作分析。不得由 W07 或 W01 直接改钱包余额。
7. 发票/收据、税务计算/代收/申报、消费者退款权、chargeback、VAT/GST/sales tax、平台报告义务和 marketplace facilitator 义务必须按 seller 与 buyer 所在司法辖区、商品分类及 provider 合同逐项核验。创作者作为销售方不自动免除 LuckRead 可能承担的平台法定义务。
8. 生产准入前必须有法律/税务专业审核及支付服务商书面/可验证能力证据；未完成前仅可开发和测试不触发真实资金移动的技术路径。不得将 TaxJar demo/sandbox 或其他演示税务适配视为生产税务。
9. 若当前 provider / connector 无法支持创作者作为销售方、独立创作者收款、退款/拒付和账务对账，必须 STOP 并报告差距；不得静默回退为 LuckRead 自营销售方。

本决策不指定某一家 PSP，也不代表税务/法律合规已完成。具体 provider 产品、交易模型和司法辖区仍须通过独立准入。


数据库使用当前批准的 Neon PostgreSQL 五库边界和既有 Worker 数据归属。严禁把旧文档中的 D1/Cloudflare 运行示例当成当前迁移目标；不得新增 D1、Worker、Queue、Service Binding 或数据库。不得改变 Payload Core。所有新表、迁移、索引必须归属正确 Worker 的现有数据库，迁移必须可重复执行、可验证并有前向恢复方案。

## 4. 商业产品目录与权益模式

所有商业 offer 都必须有明确 owner、scope、版本、币种、价格、可售状态、权益定义、退款规则、可见性和有效期。以下是产品目标范围，不代表仓库当前已经实现。

### 4.1 免费关注（Free Follow）

- 用户可免费关注/取消关注创作者。
- 关注用于关注流、通知偏好和订阅入口资格。
- 关注本身不授予付费文章、视频或高级功能权益。
- 用户取消关注不自动终止现存订阅；取消订阅也不自动取消关注。
- W05 负责关注事实，W07 负责订阅事实。

### 4.2 创作者订阅方案

每个创作者可创建多个独立方案/等级：

- Free：免费关注层，不是付费订阅。
- Supporter / Basic：基础付费会员。
- Premium：高级会员。
- VIP：高价值会员。
- Founding Member：创始会员/高阶支持者，可限量并提供专属权益。

等级名称允许创作者自定义，但平台保留稳定的系统 tier key、方案版本和能力映射。不得用显示名称作为权限依据。

计费周期：

- Monthly：月付，按订阅周期自动续费。
- Annual：年付，按订阅周期自动续费。
- Lifetime：终身会员，一次性购买，不自动续费。
- Custom interval：只有支付提供商、账务、合同和续费状态机全部验证支持后才可启用；不得为了 UI 灵活而接受未支持周期。

创作者可以设置每个等级的月价、年价、权益、介绍、可售地区、限量数和新会员价格。价格必须使用整数 minor units 和明确 ISO currency；禁止浮点金额。价格更新必须生成新版本，已有订阅按合同约定保留原价格/周期，不能静默改价或追溯扣款。

### 4.3 Founding Member / 灵活支持价

- 创作者可配置固定创始会员价格，允许高于普通年费。
- 可选 flexible founding pricing：创作者设定最低金额、建议金额和最高金额；用户只能在有效区间内选择，不能任意低于下限。
- 方案必须明确最低付款金额、权益级别、是否限量、退款规则及是否自动续费。
- 用户选择的实际金额必须固化到订单/订阅价格快照，不能被后续方案改价覆盖。
- 灵活定价不是绕过支付风控、税务或退款规则的方式。

### 4.4 终身会员（Lifetime）

- 终身会员是一次性订单产生的长期/永久权益，不是月付或年付订阅，不创建自动续费 mandate。
- 必须明确“终身”的主体范围：仅限购买时指定的创作者、方案与权益范围，不等于 LuckRead 全站终身会员。
- 购买成功后生成不可重复的 lifetime grant；必须保留订单来源、方案版本、权益范围、授予时间和退款/拒付关联。
- 终身权益不因创作者普通暂停新销售、用户取消关注而自动失效。
- 退款、拒付、欺诈、法律/版权强制下架、账户封禁、服务终止和平台关闭等例外必须有明确政策、审计和申诉路径；不得承诺超越平台实际持续运营能力的绝对永久服务。
- 创作者可限制名额、价格和销售窗口；不可对已售权益静默缩小范围。

### 4.5 单篇文章、单个视频与内容合集购买

- 用户可以不订阅，单独购买某篇付费文章、某个视频或创作者内容合集/课程包。
- 这是一次性订单，不是订阅。
- Offer 必须绑定稳定 content/resource reference、版本/权利范围、价格和权益有效期（永久、限期或许可期间）。
- 用户购买后，访问权按购买快照和有效授权判定；内容删除、版权争议、作者下架、退款和法律限制必须遵守 Rights/Content 合同。
- 不得只在前端隐藏 paywall；媒体原始 URL、封面、转码产物、下载地址和 CDN 缓存均必须执行服务端授权。
- 内容合集包含多个资源时，必须定义购买时包含的资源快照、后续新增资源是否自动包含以及退款后访问范围。

### 4.6 会员赠送（Gift）

- 支持购买月/年会员或指定权益并赠送给另一个用户。
- 礼品订单在被领取前是待领取状态；领取后绑定指定 recipient，形成明确权益 grant。
- 赠送方不得在领取后任意收回已生效权益，除非退款/欺诈/政策允许的例外。
- 礼品必须有领取截止时间、重复领取保护、recipient 身份校验、退款窗口、通知和审计。
- 未领取礼品退款、过期、撤销和领取后退款的处理必须分别定义。
- 礼品订阅到期后的续费必须由 recipient 明确同意；不得默认使用赠送方支付方式自动续费。

### 4.7 团体/企业订阅（Group）

- 支持一次购买多个席位，由购买者/组织管理员邀请成员使用。
- 需要定义 seat 数量、成员资格、邀请有效期、加入/移除、席位回收、席位转让、管理员权限和审计。
- 一个席位同一时刻只能绑定一个有效成员；移除成员后按合同立即或按宽限期撤销访问。
- 组织付款人与席位使用人可以不同，账单隐私和个人内容访问数据必须隔离。
- 组织成员离职、组织取消、席位超额、续费失败和退款必须有确定行为。
- Group v1 仅在现有组织/Creator scope、账务和授权边界能承载时实施；不得为此新增 Worker 或自建组织身份系统。

### 4.8 促销、试用与优惠

- 支持限时折扣、首月/首年优惠、优惠码、优惠券、创作者活动价和平台活动价。
- 支持免费试用（例如 7 天、14 天、30 天），试用结束前告知用户；若转自动付费，必须取得有效付款授权并清晰告知金额、币种、扣款日期和取消方法。
- 优惠必须明确适用方案、用户资格、使用次数、有效期、叠加规则、地区/币种和退款计算。
- 优惠不能修改既有已签约价格，除非用户明确接受新报价。
- 防止优惠码滥用、批量注册套利、重复兑换和自我推荐作弊。

### 4.9 限量会员与名额管理

- 创作者可以设定总名额、每期名额、销售开始/结束时间和候补状态。
- 并发购买时必须通过数据库唯一约束/原子条件更新或等效可靠机制防止超卖。
- 名额释放只能由明确订单/订阅状态触发；不能依赖缓存计数。
- 不能因已售会员取消或退款而篡改历史购买快照。

## 5. 统一权益模型

所有来源统一映射到 Entitlement Grant；至少识别：

- recurring subscription；
- lifetime purchase；
- single content purchase；
- content collection/package purchase；
- gift redemption；
- group seat assignment；
- free/trial entitlement；
- admin/support complimentary grant（受限、审计、需期限）。

每个权益至少包含：

- grantId；
- subjectId / beneficiaryId；
- ownerType / ownerId（creator 或合法组织主体）；
- sourceType / sourceId（subscription、order、gift、seat、trial 等）；
- planId / offerId 与 sourceVersion；
- entitlementKey；
- resourceScopeType / resourceScopeId；
- effectiveAt / expiresAt；
- status；
- grant/revoke reason；
- version、idempotency key、correlation ID；
- createdAt / updatedAt。

统一状态至少覆盖 PENDING、ACTIVE、SUSPENDED、EXPIRED、REVOKED、REFUNDED；具体状态转换以 108/110/112 与 Commerce 状态机合同为准。任何权益都必须可追溯至合法来源。禁止客户端直接创建、延长、撤销或修改权益。

权益合并规则：

1. 一个用户可以从多个独立来源获得同一资源权限。
2. 撤销某一个来源只能撤销该来源 grant，不得误删其他有效来源。
3. 访问判定根据所有有效 grant 与当前政策计算；优先采用明确的授权策略，不允许简单覆盖一个布尔 isMember。
4. grant 和 source transaction 必须可重建、可审计、可去重。
5. 退款、拒付、风险冻结或版权限制必须按来源和范围精准调整，不得全局误伤。

## 6. 订阅生命周期和计费规则

必须覆盖：

- 创建、待付款、激活；
- 月/年自动续费；
- 续费成功；
- 续费失败、重试、宽限期；
- 暂停、恢复；
- 用户取消（立即取消或周期结束取消，按产品政策明确）；
- 方案升级、降级；
- 价格版本变化；
- 付款方式失效、mandate 撤销；
- 退款、部分退款、拒付、争议；
- 过期和权益撤销；
- 账号封禁、创作者停用和服务不可用的处理。

升级/降级必须定义即时生效或周期结束生效、剩余金额抵扣/补差价、税额、续费日期和失败补偿；不允许重复订阅、重复收费或重复 grant。所有金额、周期边界和时区规则必须可确定、可测试。

用户取消订阅后，UI 必须说明是否仍可访问至周期结束。取消自动续费与立即撤销权益是两个不同动作。

**暂停规则（用户已确认：A）**：暂停生效后立即停止后续自动扣费，并冻结该订阅来源授予的付费权益；暂停期间不得继续访问该订阅所覆盖的付费内容。暂停时记录 pause_effective_at、当时 current_period_end、remaining_entitlement_duration（按统一 UTC 时间计算）及订阅 version。恢复时，只有在支付 mandate / seller account 仍有效且 provider 侧不会在暂停期间补扣的前提下，才可恢复订阅；恢复后将暂停时剩余有效时长顺延，即新的权益到期时间为 resumed_at + frozen_remaining_duration，后续续费时间与之对齐。暂停期间不得产生续费扣款；恢复不得重复收费或重置剩余时长。已经完成的当前周期扣款默认不自动退款，退款须走独立退款政策与订单流程。若暂停时剩余时长为零、provider 不支持安全暂停/恢复、mandate 已撤销或恢复需要重新授权/收费，必须按明确的重新付款流程处理，不得免费激活或静默补扣。暂停次数、最长暂停期限、是否允许无限期暂停尚未由用户决定，实施前须通过产品策略限制并明确展示。

## 7. 订单、支付、退款和财务边界

- 订单是购买意图和商业快照；支付提供商是外部支付执行方；经签名验证的 webhook/查询结果才是可信支付事实输入。
- Membership 根据可信交易事实更新订阅和权益；Commerce 处理订单、退款和履约；Ledger 记录最终财务事实。
- Webhook 必须验签、去重、幂等、版本/顺序保护和重放审计。
- 必须处理 pending、timeout、provider outage、重复/乱序 webhook、部分退款、全额退款、拒付和对账差异。
- 退款必须能定位到原始订单、支付、订阅周期和权益 grant；按退款政策撤销或调整对应权益。
- 禁止 W01/W07/Membership/Creator Center 直接修改 Wallet balance 或伪造 Ledger entry。
- 任何收入面板数字必须注明 gross、platform fee、processor fee、tax、refund、chargeback、pending、available、settled 等口径，不得混为“可提现收入”。
- 不得在本契约阶段擅自启用生产支付、真实扣款、生产退款或修改生产支付配置；必须由用户明确授权且经过独立生产准入。

## 8. 创作者经营中心与收益分析

Creator Center 至少提供：

### 方案管理
- 创建、编辑、预览、发布、暂停、归档方案；
- 配置等级、月/年/终身价格、创始会员、灵活定价、权益、名额和销售窗口；
- 显示当前生效版本和新价格对新老会员的影响；
- 不支持的功能必须禁用并说明原因，不能展示假按钮。

### 会员管理
- 当前会员、历史会员、试用会员、赠送会员、团体席位；
- 按等级、状态、来源和时间筛选；
- 显示必要的会员状态，不泄露支付敏感信息；
- 支持合同允许的取消、退款申请、赠送和成员管理操作；
- 所有敏感动作均需授权、幂等和审计。

### 收益与转化分析
- 关注→订阅转化率；
- 方案页访问→购买转化率；
- 新增/活跃/流失会员；
- 月度经常性收入 MRR、年度经常性收入 ARR（仅对有效循环订阅计算，明确排除一次性收入）；
- 一次性收入、终身会员收入、单篇/合集销售收入；
- 续费率、流失率、退款率、试用转付费率、优惠使用率；
- 按方案等级、内容、地区、时间窗口的收入归因；
- 净收入、平台费用、支付费用、税、退款、拒付和待结算/可结算状态。

W11 提供分析事件/聚合读取；W68 提供财务事实。分析数据不得回写订阅或 Ledger，也不得把一次性收入错误计入 MRR/ARR。指标必须有数据字典、时区、去重规则和刷新延迟说明。Creator Center 的 Coming Soon 页面不能作为已完成证据。

## 9. 内容付费与媒体保护

- 长文章支持公开、关注可见（如内容产品支持）、会员等级限制、单篇购买和合集权益。
- 视频支持公开、会员等级限制、单视频购买和合集权益。
- 内容发布时保存访问模式和所需 entitlement key/tier；不能仅存一个前端 paywall 标记。
- 未授权用户只可获得允许公开的预览字段；正文、原始媒体地址、下载地址、字幕/附件和高分辨率资源不得泄露。
- W03 对每次读取/媒体解析进行服务端授权；签名 URL 必须短期有效且绑定授权上下文。
- APP/H5/PC 的预览、购买、解锁和播放结果必须一致。
- 删除/隐藏/版权下架、退款、订阅到期和权益撤销必须及时影响访问；缓存必须可失效和回源。

## 10. API、事件与端侧统一

APP、H5、PC 只调用 W01 公开 API；W01 再通过既有 Service Binding 调用领域 Worker。禁止浏览器/APP 直连 Neon、W07 内部端点或支付提供商。

API 必须遵守既有 111、127 等合同。高级功能如 gifts、group seats、single-content offers、coupons/trials、lifetime grants 如尚无 API，先补齐 API/Data/Event/Permission 合同，再实现。

所有 mutation 必须具备 authentication、authorization、scope、idempotency key、expected version、request/correlation ID、稳定错误码、rate/quota 和审计。客户端不能传入 paid=true、active=true、refunded=false 等权威状态。

事件至少覆盖 offer/plan lifecycle、order lifecycle、payment outcome、subscription lifecycle、entitlement grant/revoke/expire、gift claim、seat assign/release、refund/chargeback、analytics attribution。事件 envelope、重试、DLQ、replay、乱序与去重遵循 112、128、163、164、165。

三端必须复用相同 API、DTO、服务端权限结果和错误语义；可以有不同布局，但不能有不同商业规则。跨端 E2E 必须覆盖购买、解锁、续费/取消后的权益一致性。

## 11. 安全、隐私与风控

必须默认拒绝并覆盖：

- 用户只能读取/操作自己的订阅、订单和权益；
- 创作者只能管理自己拥有的方案和授权范围内的会员经营数据；
- 团体管理员只能管理组织内席位，不能查看成员私密阅读/支付信息；
- 任何客户端不得伪造支付成功、订阅状态、价格、退款或权益；
- 赠送领取、优惠兑换、限量购买必须防重放、抢占和套利；
- 防止 IDOR/BOLA、跨创作者数据泄露、批量枚举、价格篡改和重复扣款；
- 管理员/客服授予或撤销权益必须有原因、期限、权限和审计；
- 日志不得包含卡号、支付密钥、完整个人财务数据或会员私密内容；
- 版权、内容审核、风险封禁和法律限制按各自权威域执行；
- 事件重放和缓存重建不得绕过权限或恢复已撤销权益。

高危安全问题、支付/账务不一致、媒体未授权访问、跨用户/跨创作者越权均为阻断项。

## 12. 状态机、幂等和一致性

所有状态机必须在代码与测试中有唯一权威定义，不能靠前端布尔字段拼接。

必须验证：

- 同一幂等键同一语义请求重放返回同一结果；
- 同一幂等键不同语义请求稳定拒绝；
- 重复支付通知不重复订单、扣款、grant 或收入；
- 乱序取消/续费/退款事件通过版本与可信时间裁决；
- 并发抢购不超卖；
- 并发 seat assignment 不产生双重分配；
- 周期边界、闰年、夏令时、时区和币种小数位处理确定；
- Queue 失败、数据库短暂故障和 provider outage 可恢复；
- entitlement cache 丢失后能从权威数据重建；
- 退款/拒付后的访问撤销在定义的 SLA 内收敛；
- 事件重放不造成重复通知、重复记账或权益复活。

不得用缓存、搜索索引、分析表或客户端本地状态作为权威。

## 13. 端到端用户旅程验收

至少建立以下真实边界测试，不得只用 mock 成功响应冒充端到端：

1. 用户注册/登录后关注创作者，看到会员入口。
2. 未关注用户按规则看不到订阅购买入口；免费公开内容仍可正常发现。
3. 用户购买月付会员，可信支付成功后只授予一次对应等级权益。
4. 用户购买年付会员，续费周期和展示日期正确。
5. 用户购买 Founding Member 固定价和灵活价，金额快照与权益正确。
6. 用户升级/降级，金额、周期、权益和账务一致。
7. 用户取消自动续费，周期结束前仍可按政策访问；到期后撤销。
8. 用户暂停/恢复订阅，扣费和权益状态符合明示规则。
9. 续费失败进入 grace，恢复支付后权益恢复；超期后按政策撤销。
10. 用户购买终身会员，不产生自动续费，退款/拒付时只调整对应 grant。
11. 用户单独购买文章/视频/合集，不订阅也可获得对应访问权。
12. 用户赠送会员，领取前后状态、期限和退款正确。
13. 企业购买席位、邀请成员、移除成员和回收席位均正确。
14. 优惠码、试用、限量方案并发购买不超卖、不重复兑换。
15. 退款、部分退款、拒付、webhook 重放后订单、权益和 Ledger 结果一致。
16. 同一用户在 Android、iOS、H5、PC 的会员状态和内容访问结果一致。
17. 创作者可查看会员增长、转化和收入拆分，且与 W68/W11 权威数据口径一致。
18. 未授权用户无法通过 API、媒体 URL、缓存、分享链接或客户端篡改访问付费资源。

## 14. 分阶段 GPT 执行计划

**每阶段是一个可独立审查的 Vertical Slice，不是把工作拆成大量无价值小 PR。每阶段完成后必须停止并交接，等待用户明确说“继续”再启动下一阶段。不得自动跨阶段。**

| 阶段 | 目标 | 主要交付 | 阶段完成条件 |
|---|---|---|---|
| 0 — Evidence Audit | 从最新 main 审计已有会员/支付/订单/权益/内容/APP/H5/PC/分析实现 | 能力矩阵、缺口、重复实现清单、现有 PR/CI/Review 证据 | 每个功能标记 VERIFIED / PARTIAL / MISSING / BLOCKED / NOT VERIFIED，附精确路径、SHA、测试证据 |
| 1 — Subscription Core Closure | 收口现有月付/年付、创作者定价、方案版本、购买、自动续费、取消、暂停/恢复、升级/降级 | W07/W01/W03 端到端闭环与回归 | 真实支付沙箱/可信 webhook、幂等、账务与访问测试通过；复用已有代码 |
| 2 — Tier & Founding Offers | 多等级会员、创始会员、灵活定价、限量和价格版本 | Plan/Offer 兼容扩展、创作者方案管理、购买流程 | 价格快照、权限映射、并发限量和旧会员价格保护通过 |
| 3 — Unified Entitlement Grants | 统一订阅、终身、赠送、试用、人工补偿等权益来源 | grant/source 追溯、合并、撤销、重建、W03 授权 | 多来源并存、来源级撤销、媒体保护、重放与恢复通过 |
| 4 — One-off Digital Commerce | 单篇文章、单视频、内容合集/课程包购买 | Offer/Order/fulfillment/entitlement 闭环 | 不订阅也可购买；退款和版权下架准确调整访问权 |
| 5 — Retention & Promotion | 试用、优惠券、折扣、礼品订阅 | 资格规则、兑换、领取、通知、退款规则 | 促销防滥用、自动转付费同意、礼品未领取/已领取状态正确 |
| 6 — Group Membership | 团体/企业购买、多席位、邀请和回收 | 组织 scope、seat lifecycle、管理员工作流 | 不超卖、不双重分配、组织隐私隔离、成员移除后访问收敛 |
| 7 — Refund, Finance & Creator Analytics | 退款/拒付/对账、收入拆分、转化/流失分析 | W68 财务对账、W11 分析、Creator Center 收益视图 | 财务事实可追溯；MRR/ARR 与一次性收入分离；指标口径一致 |
| 8 — Unified APP/H5/PC Acceptance | 三端完整体验与真实 E2E | 一致 API/DTO/权限、无 Coming Soon 假入口、跨端验收 | Android/iOS/H5/PC 关键旅程真实验证并达到适用准入门禁 |

阶段顺序可由阶段0证据调整，但调整必须写出理由和依赖，不得跳过安全/账务/权限门禁。某功能若已有真实实现与证据，应登记为 VERIFIED 并冻结，不得为了执行计划重写。阶段0发现的现有 PR 必须单独标注，不得重复创建同一功能 PR。

### 每阶段固定执行流程

1. 重新读取当前 main SHA、开放 PR、差异、Review、CI；不得沿用旧聊天状态。
2. 阅读本阶段适用的领域合同、数据/API/事件/权限/测试/准入文件。
3. 搜索当前代码、依赖和现有测试，建立调用链与 authority 图。
4. 明确本阶段范围、不做事项、影响面、风险和验收条件。
5. 选择最小可行改动；不得为文档状态而做实现，不得只做 UI 占位。
6. 添加成功、失败、越权、重放、并发和恢复测试（按本阶段风险适用）。
7. 执行必要测试与 CI，逐项记录 PASS / FAIL / SKIPPED / NOT RUN / UNKNOWN / BLOCKED。
8. 审查完整 diff、Review threads、安全边界和是否误改其他工程师工作。
9. 仅创建当前阶段专属 PR；PR 必须绑定精确 base/head SHA、测试证据和未完成项。
10. 用户明确批准合并后才能合并；合并后重新核对 main 和证据。
11. 输出交接报告后停止，等待用户下一条明确指令。

## 15. GitHub 与工程治理强制规则

- 仓库只使用 wanghuinet/luckread 最新 main，不得恢复旧 luckreadpro 状态。
- 每个新阶段开始先查 main SHA、开放 PR、diff、Review、CI；同一 SHA 已成功的工作流不无故重跑。
- 只允许 GPT 合并自己创建的 PR；不得修改、关闭或合并其他工程师创建的 PR，除非用户对具体 PR 明确授权。
- 用户没有明确说合并时，一律不合并。
- 任何 PR 必须先满足相关 CI 全绿、安全/架构/必要测试通过；不得把 NOT RUN、SKIPPED、UNKNOWN 当作 GREEN。
- 不直接向 main 提交；每阶段建立独立分支与 PR。
- 不部署、不切换生产数据库、不触发真实支付/退款、不改生产默认配置，除非用户明确授权。
- 禁止重复开发已验证完成的功能；禁止为“证明已完成”反复运行相同检查。
- 同一失败路径连续两轮没有新证据、代码变化、诊断结果或环境变化，立即 STOP 并报告阻塞。
- 一个阶段必须是完整业务纵切片，不把一个功能切成无意义碎片；但不得将互不相关的阶段合并到同一 PR。
- 每轮结束必须明确状态和下一步，不得自动继续。

## 16. 变更、迁移、回滚与可观测性

- 重大变更使用 docs/change-control/；长期产品取舍使用 docs/decisions/；验收证据使用 docs/evidence/ 和现有 Evidence Registry；不新建第二套日志。
- Schema 采用 Expand → Compatible Runtime → Backfill → Validate → Enforce → Cleanup；本阶段不需要的数据迁移不得顺手实施。
- Neon migration 必须确认目标数据库、编号、执行顺序、重复执行、索引/约束、兼容窗口、备份和前向恢复。
- 每个关键交易、订阅、权益变化需有 request/correlation ID、审计事件和可观测指标。
- 关键指标至少包括支付成功率、webhook 延迟/失败、订阅激活/续费/流失、grant/revoke 延迟、权益拒绝/误授权、退款/拒付率、内容解锁失败、三端关键旅程失败。
- 不允许用日志中的单次成功代替持续可靠性证据。

## 17. STOP 条件

出现任一情况，停止当前阶段：

- 领域权威冲突，无法确定数据 owner；
- 需要新增 Worker、数据库、Queue、Service Binding 或修改 Payload Core；
- APP/H5/PC 需要直连数据库或绕过 W01；
- 未验证支付结果就授予权益；
- 会员、订单、支付、Ledger 形成第二事实来源；
- 金额/币种/退款/税务语义不清；
- 权益无法追溯来源或多来源撤销会误删其他权益；
- 付费媒体可绕过服务端权限访问；
- 缺少幂等、并发保护、对账、重放或恢复；
- 高危安全问题、越权、隐私泄露；
- 必要 CI/测试失败或 PR 有未解决阻断性 Review；
- 相同失败两轮无新增证据；
- 变更范围超出当前阶段且无法安全审查。

STOP 时必须报告事实、证据、影响、最小解法和需要的决策，不得降低门禁继续。

## 18. 状态定义与 Definition of Done

状态必须严格区分：

DISCOVERED → CONTRACTED → IMPLEMENTING → CODE_COMPLETE → TESTS_GREEN → PR_OPEN → PR_MERGED → DEPLOYED → DEVICE_ACCEPTED → PRODUCTION_VERIFIED。

BLOCKED、DEFERRED、NOT_VERIFIED 是独立状态。PR 合并不等于部署；部署不等于生产验收。

一个阶段只有同时满足以下适用条件才算完成：

- 代码实现真实存在，不是文档/页面占位；
- 适用合同和 API/Data/Event/Permission/State Machine 一致；
- 成功、失败、安全、幂等、并发和恢复测试通过；
- 相关 CI 对精确 head SHA 全绿；
- 完整 diff 和 Review 无阻断问题；
- 证据绑定精确 SHA、环境和执行时间；
- 数据迁移、财务对账、回滚/前向恢复有证据；
- 未完成项与延期范围明确；
- PR 状态如实记录，未获授权不得合并；
- 完成本阶段后停止等待用户“继续”。

### 交接模板

Repository: wanghuinet/luckread  
Base branch / SHA:  
Working branch:  
Phase / Feature:  
Scope / Non-goals:  
Authority contracts:  
Changed files / Workers:  
Data/API/Event/Permission impact:  
Migration / Recovery:  
Tests executed + exact SHA:  
Tests not run / blockers:  
CI workflows and results:  
Review status / unresolved threads:  
Evidence references:  
PR URL / creator / merge state:  
Deployment / production state:  
Known defects / deferred scope:  
Current status:  
Next phase (not started):  
Stop reason:

## 19. 当前文件状态

本文件只定义产品目标、架构边界和 GPT 分阶段执行方法。它不证明任何高级商业模式已经存在，不代表任何 Worker 已完成适配，不授权生产支付/退款或自动 PR 合并。

阶段0必须以本文件合并后的最新 main 为基线重新审计；不得把 2026-11-27 的审计快照直接当作未来实现依据。现有 PR #2299 及其他开放 PR 必须保留其原有归属和状态，按实际代码证据纳入盘点，不得复制实现。
