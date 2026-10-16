<!-- BEGIN:rules -->
# This is a Vite + React + HeroUI + NESTJS project

This frontend uses Vite, React, HeroUI, Tailwind CSS, and local UI primitives under `/frontend/src/components`.

Read `/skills` first when project-specific workflow guidance is needed,`frontend design skill in /skills` is a key of design.

你需要向我询问尽可能多的问题以具体地确认要求和细节。

中文不要使用 unicode 转义。
Node.js 项目调试无需 run dev，走 build lint smoke。
不要把技术约束，流程等写到前端和任意会被公开访问的地方。
创建或重构前端可复用小组件时放到 `frontend/src/components` 下。
单个代码源文件不能大幅超过 1000 行。
**git提交描述和pr描述都请使用中文编写。提交需要添加英文前缀(feat,fix...)或者(feat(scope),fix(scope)...)**
使用Git进行提交时不能越过签名(--no-gpg-sign)，且含有这类安全风险极高的操作都不能越过认证，但凡要简化流程的操作都必须告知于我并征求意见。

前端项目需遵守下列规则：
N01：「禁止在可以用图标时使用圆角矩形按钮内嵌文字」
N02：「禁止用内嵌文字描述应用功能」
N03：「禁止创建落地页，应直接呈现可用体验」
N04：「禁止特定 Hero 区设计模式」
N05：「禁止卡片嵌套」
N06：「禁止装饰性球体和虚化斑点或云团」
N07：「禁止随视口缩放字号」
N08：「禁止单色调和禁忌配色」
N09：「禁止元素重叠」
N10:  使用Playwright确认UI设计是否合格。

<!-- END:rules -->

## 本会话：OAuth 与 Passkey 认证治理（2026-10-16）

- 目标：修复登录、敏感操作再次验证、认证方式统计和凭据管理之间的不一致；本节统一记录本会话所有变更与验证结果。
- 登录会话与再次验证凭据用途分离；再次验证不得替换登录会话，必须绑定当前账号、发起会话、用途与有效期。
- OAuth 登录必须绑定发起浏览器；回调和一次性交换码不能作为脱离发起流程的登录入口。保留管理员配置的已验证邮箱自动关联策略。
- OAuth 再次验证只允许选择当前账号已经绑定且仍启用、配置完整的提供商，不得默认跳转到无关提供商。
- 认证方式统计、权限检查和删除 Passkey 的保护统一使用可实际登录的认证方式；恢复码仅用于已登录会话的再次验证，不计入登录方式数量。
- Passkey 登录与再次验证要求用户验证；挑战按流程、账号和会话隔离，签名计数器与挑战、登录或再次验证凭据一起原子提交。
- 前端调整沿用现有设计与组件体系，可复用逻辑和组件保持独立；只运行 build、lint 和 smoke，不启动 dev。
- 用户已确认：初始化必须保留密码登录；管理员绑定其他可用登录方式后才允许关闭密码，优先保证管理员能够再次登录。
- 进度：已完成排查、实现和回归验证。以下内容是本会话的统一行为约定、变更索引及验证记录。

### 问题与修复后的统一行为

1. OAuth 登录流程此前缺少发起浏览器绑定。现在由前端生成随机流程凭据，通过 `X-OAuth-Flow` 请求头发起登录，服务端只存哈希；前端使用当前标签页的 `sessionStorage` 保存流程类型、提供商 state、有效期和安全站内返回地址。回调与兑换必须匹配原流程，登录兑换码不能在其他浏览器兑换。前端回调接口会在消耗 state、调用提供商和关联账号之前检查浏览器绑定。
2. OAuth 登录与再次验证此前存在入口和提供商选择混用。现在再次验证只选择当前账号已绑定、仍启用且配置完整的提供商；显式选择未绑定或不可用提供商会被拒绝。再次验证回调不注册用户、不自动关联其他账号，只为原账号、原会话及 `manage-authenticators` 用途签发短期一次性凭据。OIDC 再次验证请求使用 `prompt=login`、`max_age=0`，兑换时校验认证时效；其他 OAuth 协议沿用提供商支持的认证能力。
3. OAuth 身份统计此前把已停用、已删除和无关提供商的身份也算作登录方式。现在登录身份命名空间由共享帮助函数生成；认证统计、写入权限检查、管理员配置保存和 Passkey 删除保护共同读取实际启用且配置完整的提供商，并与账号的绑定身份匹配。空密码和恢复码均不计入可登录方式；多个 Passkey 仍只算一种登录方式。
4. OAuth 身份关联此前可能在并发 upsert 时被转移到其他账号。现在已存在的身份不会更新所属账号；注册用户与创建身份在同一事务中完成，身份已被占用时整体回滚。保留管理员配置的已验证邮箱自动关联策略。
5. OAuth 一次性交换码消费与登录会话创建此前不在同一事务。现在一次性消费、浏览器绑定检查和会话创建原子提交，失败会回滚，重复兑换不会创建多份会话。全局关闭 OAuth 后，回调和兑换也会拒绝继续。
6. Passkey 注册、登录、再次验证的挑战现在按流程隔离；已登录操作还绑定账号与发起会话。匿名登录要求有效且匹配凭据所属账号的 `userHandle`；再次验证中出现的 `userHandle` 也必须匹配。畸形断言提前拒绝，注册、登录和再次验证均要求用户验证。
7. Passkey 签名计数器此前可能在并发验证时被旧结果覆盖。现在通过期望旧计数器进行条件更新，挑战消费、计数器更新与会话或再次验证凭据签发在同一事务中提交；失败会回滚，避免计数器回退和凭据重复使用。
8. 删除 Passkey 现在先串行化同账号的删除，再以统一认证统计检查删除前后状态，防止并发删除所有可用凭据。只有减少可用登录方式并违反最低数量的删除才会被阻止；停用的非贡献凭据可以清理。删除与策略更新使用可串行化事务及现有冲突重试机制。
9. 初始化此前允许在管理员没有任何 Passkey 时仅开启 Passkey，退出即无法登录。现在初始化的前后端均强制保留密码登录。修改认证开关、停用或删除 OAuth 提供商、激活替代提供商时，在保存事务内确认发起管理员仍有实际可用的登录方式；失败会回滚配置。
10. 变更 Passkey RP ID 会令现有凭据失效。单独的 Passkey 配置接口和统一认证策略保存接口现在共用保护规则，有现存 Passkey 时拒绝更改 RP ID。检查读取事务内的原配置，防止旧页面覆盖新配置；注册落库也核对当前 RP ID，注册与配置变更发生冲突时整体回滚。
11. 前端 OAuth 回调此前可能因 React 严格模式、重复 effect 或过早清除 URL 参数而重复兑换或中止完成。现在共享进行中的兑换、保护完成回调、保留初始兑换码并及时移除地址栏敏感参数；成功返回原先安全的站内地址，失败能够显示错误。每次调用仍检查有效流程，流程结束会清除兑换缓存，不保留可复用的旧登录结果。
12. 敏感操作的 OAuth 续办记录现在同时检查动作格式、十分钟有效期及当前登录会话；过期、换号、旧格式和损坏记录不会恢复执行。再次验证不会替换登录 token。前端在认证方式异步加载后自动选择可用方式，禁用不可用的注册入口，并用带可访问名称的图标按钮呈现方式选择和提交操作。

### 文件变更索引

- `backend/src/extensions/oauth/oauth-provider-identity.ts`：新增提供商身份命名空间共享逻辑；`oauth-provider-adapters.ts`：复用命名空间并增加 OIDC 再次验证的认证时效参数。
- `backend/src/modules/auth/core/authentication-method-reader.ts`：新增统一的实际登录方式读取和管理员登录保护；`auth-settings-policy.ts`：提取认证开关的配置校验；`oauth-flow-policy.ts`：提取回调目标、配置快照、邮箱策略和流程凭据校验；`passkey-assertion.ts`：提取断言与用户句柄校验；`passkey-settings-policy.ts`：新增共享 RP ID 变更保护与配置读取。
- `backend/src/modules/auth/core/auth.controller.ts`、`auth.dto.ts`、`auth.service.ts`：接入流程凭据、区分登录和再次验证、限制提供商选择、统一配置校验与初始化密码保护。
- `backend/src/modules/auth/core/auth.repository.ts`：身份归属保护、登录兑换原子提交、管理员策略保存保护；新增 `auth.repository-models.ts` 和 `auth.repository-mappers.ts`，拆分数据类型与映射，缩短原有超长仓库文件。
- `backend/src/modules/auth/core/passkey.repository.ts`、`passkey.service.ts`：挑战会话绑定、断言校验、计数器条件更新、注册配置核对、原子提交和并发删除保护；已禁用的密码或 Passkey 不再作为再次验证入口使用。
- `backend/src/modules/admin/settings/settings-oauth.helpers.ts`：收窄共享 readiness 校验所需字段类型；`settings.controller.ts`：保存提供商时传入发起管理员；`settings.repository.ts`：支持保存事务内读取原值、校验并回滚，复用现有可串行化事务冲突重试；`settings.service.ts`：接入实际登录保护和 Passkey 配置保护。
- `backend/src/modules/admin/policies/admin-policies.service.ts`：统一策略保存复用管理员实际登录检查与 RP ID 保护，使用事务内原配置及冲突重试；`backend/src/modules/admin/setup/setup.service.ts`：初始化必须保留密码登录。
- `frontend/src/features/auth/oauth-browser-flow.ts`：新增当前标签页的 OAuth 流程状态、随机凭据、安全返回地址、有效期和重复请求合并逻辑。
- `frontend/src/lib/drive-api-auth-settings.ts`：接入 OAuth 浏览器绑定及续办检查；`drive-api-errors.ts`：增加 Passkey 域名变更保护的错误映射；`frontend/src/i18n/locales/zh_CN.tsln`、`en_US.tsln`：补充对应用户提示。
- `frontend/src/views/drive/auth-client.tsx`、`oauth-callback-client.tsx`：处理重复兑换、URL 清理、登录会话竞态与返回地址；`setup-client.tsx`：初始化密码登录保持启用；`frontend/src/components/ui/setup-flow-primitives.tsx`：复用初始化开关组件的禁用状态。
- `frontend/src/components/security/passkey-manager-state.ts`、`passkey-manager.tsx`：敏感动作续办绑定会话和时效、清理无效流程及禁用不可用操作；`security-reauth-dialog.tsx`、`security-dialogs.css`：修正异步认证方式选择并沿用现有图标按钮和弹窗布局。
- 后端回归文件：`backend/src/extensions/oauth/oauth-provider-adapters.spec.ts`；`backend/src/modules/admin/policies/admin-policies.service.spec.ts`；`backend/src/modules/admin/setup/setup.service.spec.ts`；`backend/src/modules/auth/core/auth.repository.spec.ts`、`auth.service.spec.ts`、`auth.service.setup.spec.ts`、新增 `auth.oauth-security.spec.ts`、`passkey.repository.security.spec.ts`、`passkey.service.spec.ts`。
- 前端回归文件：`frontend/src/components/security/passkey-manager.test.ts`；`frontend/src/views/drive/oauth-callback-client.test.tsx`；新增 `frontend/src/features/auth/oauth-browser-flow.test.ts` 和 `frontend/src/lib/drive-api-oauth-flow.test.ts`。
- 本文件记录全部治理口径；本地 Playwright 模拟脚本和截图保留于 `output/playwright/`，会话快照位于 `.playwright-cli/`。这些目录不属于前端公共资源。

### 验证结果与边界

- `pnpm lint` 通过；最后的前端回调调整又单独运行 `pnpm --filter frontend lint` 通过。前端仍有原有的 23 项 warning，主要涉及 fast refresh 导出和未使用类型；没有 lint error。
- `pnpm build` 通过；最后的前端回调调整又单独运行 `pnpm --filter frontend build` 通过。Vite 保留现有的大 chunk 提示。
- 后端全量 `pnpm --filter backend test --runInBand`：106 个测试套件通过、888 项测试通过；原有 MinIO 外部集成套件及其中 1 项测试因环境开关未启用而跳过。
- 前端最终全量 `pnpm --filter frontend test`：81 个测试文件、478 项测试全部通过。覆盖错误 state、流程过期、换会话、重复 effect、缺少流程凭据、兑换缓存失效和原站内返回地址。
- 真实 SQLite 临时数据库回归覆盖挑战竞争、失败次数上限、计数器冲突及回滚、跨会话挑战拒绝、并发删除最后登录方式、配置保存回滚、身份不可转移、OAuth 兑换浏览器绑定和 RP ID 变更时的注册回滚。未连接部署数据库或修改真实账号凭据。
- Playwright 使用构建后的本地 preview，不启动 dev。检查安全设置页、密码／Passkey／OAuth 再次验证方式切换，以及 1440px 桌面和 390px 移动视口：弹窗在视口内、无横向溢出，图标按钮不重叠。初始化认证步骤确认密码登录为启用且不可关闭，移动端无横向溢出。
- OAuth 备用回调的模拟浏览器检查成功：`/login?oauthCode=...` 只兑换一次，携带原浏览器凭据，完成后清除流程状态并返回保存的 `/settings?tab=security`，不采用传入的其他返回地址。截图包括 `auth-security-desktop.png`、`auth-reauth-desktop.png`、`auth-reauth-mobile.png`、`setup-password-required-desktop.png` 和 `setup-password-required-mobile.png`。
- 原有综合 `drive-visual-smoke.spec.ts` 在认证步骤之前因 `.drive-address-bar` 同时匹配两处目录栏而失败，未作为通过项统计；本会话采用上述定向浏览器检查。另观察到通用 motion 的 `CSSStyleDeclaration` 报错和部分既有弹窗的无障碍标题告警，记录为 UI 基础层待办。
- 自动审批拒绝了浏览器中的“确认移除 Passkey”点击，理由是该动作可能删除登录凭据并影响管理员登录；未重试该点击。再次验证弹窗改由恢复码入口检查，删除保护由隔离数据库测试验证。
- 第三方真实 OAuth 提供商、实体 Passkey 设备和 PostgreSQL 并发场景尚未进行部署环境联调；本次结果不等同于这些环境的验收。

### 后续维护约定

- 本次无需数据库迁移，复用现有 OAuth 状态、交换码、挑战 metadata 和再次验证凭据字段；前后端应配套更新。旧的无浏览器绑定登录流程会被拒绝，需要重新发起 OAuth 登录。
- 检查完成后，已关闭本次专用的 Playwright 浏览器会话和临时 preview 服务；保留本地截图及模拟脚本以便复查。
- 认证方式统计与删除保护继续复用统一读取函数；保存认证配置必须在同一事务中检查发起管理员的实际可登录能力。不得只根据启用开关或提供商数量推断账号是否能够登录。
- 不得把再次验证凭据写入登录 token 存储；不得取消用户验证、浏览器／账号／会话／用途绑定或绕过现有 Git 签名和认证要求。本会话未执行推送、部署或真实凭据删除。

### 用户授权的本地提交

- 用户在修复完成后明确要求创建 commit；本次提交保留现有 GPG 签名与认证流程，不覆盖签名配置，不跳过检查。
- 提交说明使用中文和英文类型前缀：`fix(auth): 统一 OAuth 与 Passkey 认证流程并防止管理员锁号`。
- 根目录 `AGENTS.md` 原被 `.gitignore` 的 `AGENTS*` 规则忽略；按本会话统一记录要求，将该文件一并纳入本次提交。Playwright 本地模拟脚本、截图与会话快照继续保留在忽略目录中。
