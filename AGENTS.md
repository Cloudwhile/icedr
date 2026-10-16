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

## 本会话：UI 分析报告修复（2026-10-16，已恢复）

- 目标：阅读根目录 `UI-ANALYSIS-REPORT.md`，修复其中仍可复现的 UI/UX 问题，并避免为实现细节堆叠低价值测试。
- 状态：用户曾在第一批改动尚未完成及尚未验证时要求停止，现已明确恢复任务并要求逐项处理；以下继续只记录已经落盘且实际完成的状态，不把未验收项视为完成。

### 已落盘的改动

1. 缩略图请求懒加载：新增 `frontend/src/components/ui/use-in-view-once.ts`，`DriveItemPreview` 仅在进入视口前后 200px 范围后请求预览 URL；图片增加 `loading="lazy"` 与 `decoding="async"`，进入视口后保持加载状态，不因滚出视口卸载。该项已于恢复任务后完成独立回归与浏览器验收。
2. 传输设置已接入真实行为：新增 `frontend/src/features/file/upload-preferences.ts`，使用 `icedr.ui.uploadPreferences` 持久化并发数与自动清除选择；上传批次把持久化并发数传给 `runUploadGroups`，默认值从界面显示的 3 真正作用于调度。该项已于恢复任务后完成独立回归与浏览器验收。
3. 移除无法实现的假限速控件：传输页已删除没有任何传输层支持的“上传限速”选择器，避免继续展示不会生效的设置。
4. 自动清除已接入完成路径：上传成功后若启用自动清除，会移除本地行并请求删除对应传输记录；删除失败时重新刷新传输列表，避免界面与服务端长期不一致。
5. P0-5 对外分享页暗色迁移已完成：`external-share.css` 的页面根节点、工作台、侧栏、hero、文件浏览区与反馈浮层均改用现有 `--ui-*` 主题 token，文件内不再存在裸写的 hex／rgba 颜色；无封面占位已移除装饰性标记与伪元素，改为简单的主题色图标占位，以符合 N06。浅色视觉层级保持不变，暗色卡片、文字、边框及状态反馈已能随主题正确切换。
6. P0-1 文件列表／网格虚拟化已完成：新增 `frontend/src/components/drive/use-drive-virtual-range.ts` 与 `drive-file-virtualization.ts`，超过 80 项时按视口和 overscan 仅渲染完整行；列表使用上下占位表格行，网格按列数切分完整行。`MotionList` 的 key 只绑定导航与目录，不再拼接全部文件 ID；跨虚拟窗口的 Shift+方向键会先滚动并恢复目标焦点，右键菜单和单项更新后的焦点保持不变。表格外壳改为实际纵向滚动容器，sticky 表头与列宽保持原样。
7. P1-F1 上传冲突关闭语义已修复：新增 `upload-conflict-prompt-queue.ts` 串行协调多个批次，后来的冲突请求不会再以 `null` 静默结束当前批次。ESC、关闭按钮或遮罩关闭冲突选择时，改为在同一弹窗内显示“放弃整批”二次确认，明确说明本批全部文件（包括无冲突文件）都会被放弃；取消确认会返回原冲突选择，只有明确确认才结束该批次。冲突策略 skip／overwrite／rename／version 的既有语义不变。
8. P1-F2 分享过期天数不再静默钳制：新增 `features/share/expiry-validation.ts`，统一要求输入为 1 至管理员上限内的整数；过大、空值、0 或非整数都会显示明确错误并禁用创建按钮。输入框补齐 `type="number"`、`min`、`max`、`step`、`aria-invalid` 与错误描述关联；提交时直接使用已验证的可见值，不再回退默认值或把超限值改写为上限。
9. P1-F3 通知语气已收紧：报告列出的 6 处以及额外发现的分享入口共 7 处 `app.noSelection` 均显式使用 `warning`。`showAppToast`、`showWorkspaceNotification`、工作台 `showFeedback` 及三个管理设置页的通知包装函数均要求调用方显式传 tone，原先依赖默认成功语气的真实成功路径已逐处补为 `success`。Playwright 还发现工作区通知的 `AnimatePresence + motion.div(layout)` 在当前 React／Framer Motion 组合下会生成两个完全重叠且透明的节点；该通知组件已改为单节点 CSS 入场动画，并保留 reduced-motion 处理，避免 warning 语义正确却不可见。
10. P1-F4 批量失败反馈已统一：新增 `frontend/src/components/drive/batch-operation-feedback.tsx` 与模型 helper，批量结果按全成功／部分失败／全部失败分别使用 `success`／`warning`／`error`；失败详情通过原始 `DriveItem` 映射显示文件名，不再暴露内部 UUID，最多列出 6 项并用本地化文案汇总剩余项，长文件名保留 `title` 悬停查看。下载、移动、复制、归档、恢复和永久删除均传入源项目名称；通知描述在桌面和移动布局中保持可读。
11. P1-F5 非上传操作的错误兜底已按语义拆分：中英文 locale 新增通用操作以及重命名、删除、复制、移动、归档、恢复、收藏和新建文件夹失败文案；头像更新／清除使用通用操作失败，传输恢复取消使用通用操作失败，删除传输记录使用删除失败。`app.uploadFailed` 在 TypeScript 调用中只保留于生成文件和上传任务的真实上传链路；重命名失败明确显示“重命名失败”。
12. P1-F6 上传失败入口已与活跃进度拆分：`upload-progress.ts` 新增只统计真实 `failed`、不包含 `expired` 的 `failedCount`；上传 HUD 使用两个并列的真实按钮呈现活跃上传与危险色“{count} 个失败”，失败归零后入口自动消失，不再嵌套交互元素。失败入口会导航到传输页、一次性选择并聚焦“需要关注”页签；传输页不再渲染 HUD，避免遮挡实时速度区域。HUD portal 注入现有主题变量，并移除在当前组合下显示异常的 `MotionPresence`，改用保留 reduced-motion 处理的 CSS 入场动画。
13. P1-F7 分享弹窗已迁移到基于 HeroUI Modal 的 `AppDialogShell`：Tab／Shift+Tab 焦点被限制在弹窗内，打开时焦点落到关闭图标按钮，ESC、遮罩和关闭按钮结束后由 React Aria 恢复至原分享触发按钮。`AppDialogShell` 新增可复用的 ARIA 标注、主题、遮罩关闭与键盘关闭参数；创建分享期间同时禁用 ESC、遮罩和关闭按钮，保持原有业务约束。弹窗沿用原视觉变量与布局，HeroUI 容器宽度覆盖保证桌面居中并在移动视口内完整显示。

### 核验后未照报告修改的项目

1. 报告 P0-4 所述“登录态过期后永久空白”在当前基线已有全局处理：`main.tsx` 始终挂载 `AuthSessionCoordinator`，API 的 session 过期事件会清理会话、提示并携带完整路径跳转登录；`auth-gate.test.tsx` 已覆盖 `/admin/audit?cursor=next#events` 返回地址。`AuthGate` 中的静默分支用于把跳转交给协调器，本轮未重复实现第二套跳转。
2. 报告 P1-D3 要求增加 `HeroUIProvider` 与当前安装的 HeroUI v3.1 不符。仓库本地 `@heroui/react` README 明确说明 v3 不需要 Provider，因此未加入不存在或多余的 Provider，也未进行报告建议的强制包装迁移。

### 尚未完成

- 报告中的 B1–B10、F8–F9、D1–D2、D4–D5、A1–A7、A9 等其余可复现项均尚未进入实现阶段。
- `UI-ANALYSIS-REPORT.md` 是本轮用户提供的未跟踪输入文件，本轮未修改其内容。

### 验证与测试状态

- 恢复任务后，P0-2 已新增 `frontend/src/components/ui/drive-item-preview.test.tsx`，覆盖进入预加载区前不请求、进入后仅请求一次、滚出后不卸载，以及图片 `loading="lazy"` / `decoding="async"`；目标测试 1 项通过。
- `pnpm --filter frontend lint` 通过，保留原有 23 项 warning，无 error；`pnpm --filter frontend build` 通过，保留现有大 chunk 提示。该结果确认当前工作区的 P0 改动可编译。
- P0-2 使用构建后的本地 preview 与 Playwright 模拟 200 个图片文件：首屏仅请求 8 个缩略图签名 URL，滚动到底部后增至 17；确认继续按需加载、媒体替换前后尺寸一致且无横向溢出。截图与模拟脚本位于 `output/playwright/thumbnail-lazy-smoke.png`、`thumbnail-lazy-smoke.js`，未启动 dev。
- P0-1 新增 2 项纯虚拟窗口计算测试；当时前端全量 `pnpm --filter frontend test` 为 83 个测试文件、481 项测试全部通过。`pnpm --filter frontend build` 与 `lint` 再次通过，lint 仍只有原有 23 项 warning；`git diff --check` 通过。
- P0-1 使用构建后的本地 preview 与 Playwright 模拟 1000 个文件：列表首屏 11 个、末端 12 个 DOM 项，网格 30 个 DOM 项；列表／网格均可到达第 1000 项，跨窗口 Shift+方向键焦点正确，单项状态更新不替换已聚焦节点，右键菜单保持在视口内且无横向溢出。截图与模拟脚本位于 `output/playwright/drive-virtual-scroll-smoke.png`、`drive-virtual-scroll-smoke.js`。
- P0-3 新增偏好存储和自动清除编排回归，覆盖并发值归一化、关闭时保留完成记录、开启时先移除本地行再删除服务端记录、删除失败刷新恢复。最终前端全量测试为 85 个测试文件、490 项测试全部通过；build、lint 通过，仍只有原有 23 项 warning。
- P0-3 使用构建后的本地 preview 与 Playwright 验证默认并发为 3，改为 1 并开启自动清除后刷新仍保持；页面不再存在假限速控件；1440px 与 390px 均无横向溢出。截图与模拟脚本位于 `output/playwright/transfer-settings-desktop.png`、`transfer-settings-mobile.png`、`transfer-settings-smoke.js`。
- P0-5 的相关弹窗测试 10 项通过；`external-share.css` 中裸写的 hex／rgba 颜色以及报告点名的白色、边框色均为零命中。Playwright 使用构建产物模拟 `/share/s/:token`，检查 1440px 浅色／暗色、下载失败反馈浮层和 390px 暗色视口：卡片、文字、边框均随主题切换，hero chip 正常换行，无横向溢出或同级元素重叠。截图与模拟脚本位于 `output/playwright/external-share-light-desktop.png`、`external-share-dark-desktop.png`、`external-share-dark-feedback.png`、`external-share-dark-mobile.png` 和 `external-share-theme-smoke.js`。尚未完成对“无所谓的测试”的价值审计，因此没有在缺乏证据时删除现有回归覆盖。
- P1-F1 新增 3 项冲突提示队列回归，与既有冲突规划测试合计 16 项定向测试通过；最终前端全量测试为 86 个测试文件、493 项测试全部通过，build、lint 通过，仍只有原有 23 项 warning。Playwright 连续提交两个冲突批次，确认第一批不会被第二批静默关闭、取消放弃会恢复原选择、明确放弃后第二批才出现，二次确认会显示包含非冲突文件在内的整批范围；1440px 与 390px 均无弹窗重叠或横向溢出。截图与模拟脚本位于 `output/playwright/upload-conflict-discard-confirm.png`、`upload-conflict-second-batch.png`、`upload-conflict-mobile.png` 和 `upload-conflict-queue-smoke.js`。
- P1-F2 新增 2 项范围校验回归，最终前端全量测试为 86 个测试文件、495 项测试全部通过；build、lint 通过，仍只有原有 23 项 warning。Playwright 在管理员上限 30 天时输入 90，确认错误提示可见、`max="30"` 与 `aria-invalid="true"` 生效、创建按钮禁用且没有发出请求；改回 30 后按钮恢复，只发出一次请求且载荷 `expiresDays` 为 30。1440px 与 390px 均无横向溢出，移动端弹窗保持在视口内。截图与模拟脚本位于 `output/playwright/share-expiry-invalid-desktop.png`、`share-expiry-invalid-mobile.png` 和 `share-expiry-validation-smoke.js`。
- P1-F3 新增 1 项工作区通知视觉语义回归，最终前端全量测试为 86 个测试文件、496 项测试全部通过；build、lint 通过，lint 仍只有原有 23 项 warning。Playwright 使用构建后的 13002 preview 分别触发复制和归档的空选择防御分支，两次文案均为 `Select files first`、`data-tone="warning"`，图标为感叹号且计算色值为 `rgb(217, 119, 6)`；1440px 与 390px 均位于视口内，移动端文案与关闭操作不重叠且无横向溢出。截图与模拟脚本位于 `output/playwright/no-selection-warning-desktop.png`、`no-selection-warning-mobile.png` 和 `no-selection-warning-smoke.js`。页面仍会记录此前已知的通用 Framer Motion `CSSStyleDeclaration` 控制台错误，本项已确保工作区通知不再使用会受其影响的 motion 节点，未把全站 motion 治理扩展进 F3。
- P1-F4 新增批量反馈组件与 hook 回归，前端全量 `pnpm --filter frontend test` 为 87 个测试文件、501 项测试全部通过；`pnpm --filter frontend build` 与 `pnpm --filter frontend lint` 通过，lint 保持原有 23 项 warning，无 error。构建产物下的 Playwright smoke 在 1440px 与 390px 触发 5 项归档中 2 项失败，通知显示 `3/5 completed, 2 failed`、`bravo.txt`、`delta.txt`，不含内部 UUID；桌面／移动通知均在视口内，移动端无横向溢出且内容与操作区不重叠。截图位于 `output/playwright/batch-operation-feedback-desktop.png` 和 `batch-operation-feedback-mobile.png`。
- P1-F5 新增重命名失败 fallback 回归，前端全量 `pnpm --filter frontend test` 为 87 个测试文件、502 项测试全部通过；`pnpm --filter frontend build` 与 `pnpm --filter frontend lint` 通过，lint 保持原有 23 项 warning，无 error。Playwright 使用构建产物模拟一次重命名接口失败，确认只发出 1 次请求、错误通知显示“重命名失败”且页面没有“上传失败”，通知位于 1440px 视口内并且页面无横向溢出。Vite preview 启动两次均被 Windows 对依赖文件的临时 `EPERM` 读取锁阻断，因此改用只读静态服务器承载同一份 `frontend/dist`，未启动 dev；专用浏览器与静态服务已关闭。截图与模拟脚本位于 `output/playwright/f5-rename-error-desktop.png` 和 `f5-rename-error-smoke.js`。控制台除刻意模拟的 418 外，仅记录已知的通用 Framer Motion `CSSStyleDeclaration` 错误。
- P1-F6 的 3 个定向测试文件共 10 项通过；前端全量 `pnpm --filter frontend test` 为 87 个测试文件、505 项测试全部通过；`pnpm --filter frontend build` 与 `pnpm --filter frontend lint` 通过，lint 保持原有 23 项 warning，无 error；`git diff --check` 通过。Playwright 使用构建产物确认失败入口计算色值为 `rgb(220, 38, 38)`，在 1440px 与 390px 视口中均无横向溢出，失败归零后入口消失；点击入口后“需要关注”页签选中并获得焦点，失败行可见、运行中行不在该分组中，且传输页没有 HUD 覆盖。Vite preview 仍因 `picomatch/lib/scan.js` 的 Windows `EPERM` 读取锁失败，因此改用只读静态服务器承载 `frontend/dist`，未启动 dev；专用浏览器与静态服务已关闭。截图位于 `output/playwright/f6-upload-failure-anchor-desktop.png`、`f6-upload-failure-anchor-mobile.png` 和 `f6-upload-failure-attention.png`。最终控制台仅记录已知的通用 Framer Motion `CSSStyleDeclaration` 错误。
- P1-F7 完成后，前端全量测试为 87 个测试文件、505 项测试全部通过；沙箱内首次启动 Vitest 时因 `magic-string` 依赖文件遭遇 Windows `EPERM` 读取限制，按原命令在沙箱外重跑通过。`pnpm --filter frontend build` 与 `pnpm --filter frontend lint` 通过，lint 保持原有 23 项 warning，无 error。Playwright 使用构建产物确认初始焦点位于关闭按钮，连续 18 次 Tab 与一次 Shift+Tab 均未离开弹窗，ESC 和遮罩关闭后焦点都恢复到原分享按钮；1440px 弹窗居中，390px 视口边界为 `left=14`、`top=14`、`right=376`、`bottom=830`，无横向溢出。截图与模拟脚本位于 `output/playwright/f7-share-dialog-focus-desktop.png`、`f7-share-dialog-focus-mobile.png` 和 `f7-share-dialog-focus-smoke.js`；专用浏览器已关闭，未启动 dev。
