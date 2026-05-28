import type { Locale } from "@/features/file/model";

export type LegalDocumentKey = "terms" | "privacy";
export type LegalTextLocale = "zh" | "en";

export type LegalSection = {
  title: string;
  body: string[];
};

export type LegalDocumentText = {
  title: string;
  subtitle: string;
  effectiveDate: string;
  intro: string[];
  sections: LegalSection[];
};

type LegalDocument = {
  key: LegalDocumentKey;
  route: string;
  label: Record<Locale, string>;
  text: Record<LegalTextLocale, LegalDocumentText>;
};

const effectiveDate = "2026-05-27";

export const legalDocuments: Record<LegalDocumentKey, LegalDocument> = {
  terms: {
    key: "terms",
    route: "/terms",
    label: {
      en: "Terms of Service",
      zh: "用户协议",
    },
    text: {
      zh: {
        title: "ICEDR Drive 用户协议",
        subtitle: "适用于账号、工作区文件、外链分享、预览、下载与管理功能的服务条款。",
        effectiveDate,
        intro: [
          "欢迎使用 ICEDR Drive。本协议说明你与提供 ICEDR Drive 的工作区运营方之间关于访问、注册、上传、分享、预览、下载、管理和使用相关功能的基本规则。",
          "点击注册、登录、继续使用服务，或由管理员为你开通账号，即表示你确认已经阅读并同意本协议。若你代表组织使用服务，你确认自己有权代表该组织接受本协议。",
        ],
        sections: [
          {
            title: "一、服务范围",
            body: [
              "ICEDR Drive 提供工作区文件存储、目录管理、外链分享、访问验证、下载意向、预览意向、审计记录、管理员安全设置以及与这些功能相关的辅助服务。部分功能可能依赖本地存储、对象存储、邮件投递、OAuth、Passkey 或其他由管理员配置的基础设施。",
              "服务可能随产品迭代而增加、调整、暂停或移除部分功能。我们会以合理方式维护服务的可靠性，但不保证任何功能在所有时间、所有网络或所有设备上都不间断、无错误或完全满足你的特定目的。",
            ],
          },
          {
            title: "二、账号与资格",
            body: [
              "你应使用真实、准确、当前且完整的信息注册或接受账号邀请，不得冒用他人身份、使用误导性信息，或以自动化、批量化、绕过限制的方式创建账号。你需要妥善保管账号凭据、Passkey、验证码和访问令牌，并对账号下发生的活动负责。",
              "如果你使用组织、学校、团队或雇主提供的邮箱或工作区访问服务，该组织可能拥有管理、审计、暂停、删除或导出与该账号及工作区相关数据的权限。你应遵守组织内部规则、授权范围和适用法律。",
            ],
          },
          {
            title: "三、用户内容与权限",
            body: [
              "你保留对上传、创建、存储或分享的文件、目录、备注、外链配置、预览请求和相关材料的权利。为了提供服务，你授予工作区运营方一项有限的、必要的、非独占许可，用于存储、复制、传输、索引、转换格式、生成预览、创建下载意向、执行安全扫描和向你指定的接收方展示内容。",
              "你承诺拥有使用、上传、处理和分享相关内容所需的权利。不得上传或分享侵犯他人知识产权、隐私权、商业秘密、合同权利或其他合法权益的内容。对于你通过外链向访客开放的内容，你应自行确认分享范围、有效期、下载权限和接收方身份。",
            ],
          },
          {
            title: "四、可接受使用",
            body: [
              "你不得使用服务从事违法、欺诈、误导、骚扰、威胁、滥发、钓鱼、传播恶意软件、绕过安全限制、未经授权访问系统、过度占用资源、规避访问控制、破坏服务稳定性或侵犯他人权益的活动。",
              "你不得上传、生成、传播或分享涉及儿童剥削、极端暴力、恶意攻击、非法交易、未经授权的个人敏感信息或其他依法应当限制的内容。我们可以在必要时采取限制访问、暂停账号、移除外链、保留证据、通知管理员或配合法律程序等措施。",
            ],
          },
          {
            title: "五、外链分享与访客访问",
            body: [
              "外链分享可能允许未登录访客访问指定文件或目录。管理员可以设置邮箱验证、OAuth 验证、等待时间、限速、下载次数、允许域名、预览权限、下载权限和过期规则。创建外链即表示你确认有权向相关访客开放该内容。",
              "外链访问可能产生审计记录，包括访问时间、操作类型、分享 token、下载或预览事件、邮箱验证状态以及管理员启用的其他安全信号。你应谨慎复制和分发外链，并在不再需要时及时关闭或更新权限。",
            ],
          },
          {
            title: "六、管理员与组织控制",
            body: [
              "管理员可以配置站点品牌、登录方式、SMTP、OAuth、Passkey、存储模式、外链策略、审计策略和其他安全参数。管理员还可以查看工作区内的外链、活动记录、存储状态和与安全管理相关的信息。",
              "当服务由组织运营时，组织对工作区数据、账号生命周期、权限分配、合规保留、导出、删除和安全响应具有管理职责。普通用户应理解，组织管理权限可能优先于个人偏好或本地设备设置。",
            ],
          },
          {
            title: "七、第三方服务与集成",
            body: [
              "服务可能连接对象存储、邮件服务、OAuth 身份提供方、Passkey 平台、浏览器下载能力或其他第三方组件。这些组件可能有自己的服务条款、隐私政策、可用性、费用和安全模型。",
              "我们不对第三方服务的内容、运营、故障、延迟、数据处理或政策变更承担超出法律要求的责任。管理员在启用第三方集成前，应确认相应供应商符合组织的安全和合规要求。",
            ],
          },
          {
            title: "八、服务变更、暂停与终止",
            body: [
              "我们可以为了安全、维护、合规、性能、产品改进或防止滥用而更新服务。重大变更会尽量通过界面、文档、管理员通知或其他合理方式说明，但紧急安全修复可能无需提前通知。",
              "如果你违反本协议、法律要求、组织规则或安全策略，我们可以暂停或终止你的访问，限制外链，删除或隔离风险内容。账号关闭后，你可能无法继续访问相关内容；请根据组织规则保留必要备份。",
            ],
          },
          {
            title: "九、知识产权与反馈",
            body: [
              "服务本身的界面、软件、设计、商标、图标、文档、工作流和技术实现属于相应权利人。除非获得明确授权，你不得复制、反向工程、绕过限制、出租、转售或以竞争性方式使用服务组件。",
              "如果你提供建议、问题报告、改进意见或其他反馈，你同意我们可以在不向你支付费用的情况下使用这些反馈来改进服务，但这不会改变你对个人内容和组织内容的所有权。",
            ],
          },
          {
            title: "十、责任限制",
            body: [
              "在法律允许的最大范围内，服务按现状和可用状态提供。我们不承诺服务完全无错误、无中断、无安全事件、无数据丢失或适用于所有特定场景。你应根据数据重要性建立备份、权限复核和应急流程。",
              "对于间接损失、利润损失、业务中断、数据损坏、未经授权分享、第三方服务故障或因你违反本协议造成的损失，我们在法律允许范围内不承担责任。任何强制性法定责任不受本条限制。",
            ],
          },
          {
            title: "十一、争议、法律适用与变更",
            body: [
              "与本协议或服务相关的问题，应首先通过工作区管理员或运营方指定的联系渠道协商解决。若适用法律要求特定争议处理机制，应以该法律要求为准。",
              "我们可能不时更新本协议。更新版本发布后继续使用服务，表示你接受更新。若更新对你的权利义务产生重大影响，我们会尽量提供合理提示。你应定期查看独立协议页面以了解最新版本。",
            ],
          },
        ],
      },
      en: {
        title: "ICEDR Drive Terms of Service",
        subtitle: "Terms for accounts, workspace files, external sharing, preview, download, and administration features.",
        effectiveDate,
        intro: [
          "Welcome to ICEDR Drive. These Terms describe the rules that apply when you access, register for, upload to, share through, preview from, download from, administer, or otherwise use ICEDR Drive.",
          "By registering, signing in, continuing to use the service, or accepting access provisioned by an administrator, you confirm that you have read and agree to these Terms. If you use the service for an organization, you represent that you are authorized to accept these Terms for that organization.",
        ],
        sections: [
          {
            title: "1. Scope of the Service",
            body: [
              "ICEDR Drive provides workspace file storage, directory management, external link sharing, visitor verification, download intents, preview intents, audit records, administrator security settings, and supporting services. Some features depend on local storage, object storage, mail delivery, OAuth, Passkeys, or other infrastructure configured by administrators.",
              "The service may evolve over time. Features may be added, changed, suspended, or removed. We use reasonable efforts to operate the service reliably, but do not promise that every feature will be uninterrupted, error-free, available on every network or device, or fit every particular purpose.",
            ],
          },
          {
            title: "2. Accounts and Eligibility",
            body: [
              "You must provide accurate, current, and complete information when registering or accepting an account invitation. You may not impersonate others, use misleading information, or create accounts through automated, bulk, or restriction-avoidance methods. You are responsible for safeguarding credentials, Passkeys, verification codes, and access tokens.",
              "If you use an organization, school, team, or employer email address or workspace, that organization may administer, audit, suspend, delete, or export data associated with the account and workspace. You must follow internal rules, authorization boundaries, and applicable law.",
            ],
          },
          {
            title: "3. User Content and Permissions",
            body: [
              "You retain rights in files, folders, notes, sharing settings, preview requests, and other materials that you upload, create, store, or share. To provide the service, you grant the workspace operator a limited, necessary, non-exclusive license to store, copy, transmit, index, transform, preview, create download intents for, scan, and display content to recipients you authorize.",
              "You represent that you have the rights needed to use, upload, process, and share your content. You may not upload or share content that infringes intellectual property, privacy, trade secret, contractual, or other rights. When you create an external link, you are responsible for confirming the share scope, expiry, download permission, and visitor identity model.",
            ],
          },
          {
            title: "4. Acceptable Use",
            body: [
              "You may not use the service for unlawful, fraudulent, misleading, harassing, threatening, spam, phishing, malware, security-bypass, unauthorized access, resource-abuse, access-control evasion, service-disruption, or rights-infringing activities.",
              "You may not upload, generate, distribute, or share content involving child exploitation, extreme violence, malicious attacks, unlawful trade, unauthorized sensitive personal information, or other restricted material. Where necessary, we may limit access, suspend accounts, remove links, preserve evidence, notify administrators, or cooperate with legal process.",
            ],
          },
          {
            title: "5. External Links and Visitor Access",
            body: [
              "External links may allow visitors who are not signed in to access selected files or folders. Administrators may configure email verification, OAuth verification, wait time, rate limits, download limits, allowed domains, preview permission, download permission, and expiry rules. By creating a link, you confirm that you are authorized to disclose the selected content.",
              "External link access may generate audit records, including access time, action type, share token, download or preview events, email verification status, and other security signals enabled by administrators. Copy and distribute links carefully, and close or update access when it is no longer needed.",
            ],
          },
          {
            title: "6. Administrator and Organization Controls",
            body: [
              "Administrators may configure site branding, sign-in methods, SMTP, OAuth, Passkeys, storage mode, external link policy, audit policy, and other security settings. Administrators may also review workspace links, activity records, storage status, and information needed for security management.",
              "When the service is operated by an organization, the organization is responsible for workspace data, account lifecycle, permissions, compliance retention, export, deletion, and incident response. Users should understand that organization controls may take precedence over personal preferences or local device settings.",
            ],
          },
          {
            title: "7. Third-Party Services and Integrations",
            body: [
              "The service may connect to object storage, mail services, OAuth identity providers, Passkey platforms, browser download capabilities, or other third-party components. Those components may have their own terms, privacy policies, availability, fees, and security models.",
              "We are not responsible beyond what law requires for third-party service content, operation, outages, latency, data handling, or policy changes. Administrators should evaluate whether enabled third-party providers meet their organization’s security and compliance requirements.",
            ],
          },
          {
            title: "8. Changes, Suspension, and Termination",
            body: [
              "We may update the service for security, maintenance, compliance, performance, product improvement, or abuse prevention. Material changes will generally be described through the interface, documentation, administrator notices, or other reasonable channels, but urgent security fixes may be made without advance notice.",
              "If you violate these Terms, law, organization rules, or security policy, we may suspend or terminate your access, restrict external links, and delete or quarantine risky content. After account closure, you may lose access to related content; maintain backups according to organization policy.",
            ],
          },
          {
            title: "9. Intellectual Property and Feedback",
            body: [
              "The service interface, software, design, marks, icons, documentation, workflows, and technical implementation belong to their respective rights holders. Unless expressly authorized, you may not copy, reverse engineer, bypass restrictions, rent, resell, or use service components competitively.",
              "If you provide suggestions, issue reports, improvement ideas, or other feedback, you agree that we may use that feedback to improve the service without payment to you. This does not change your ownership of personal or organization content.",
            ],
          },
          {
            title: "10. Limitation of Responsibility",
            body: [
              "To the maximum extent permitted by law, the service is provided as is and as available. We do not promise that the service will be free of errors, interruptions, security incidents, data loss, or that it will be suitable for every specific scenario. Maintain backups, access reviews, and incident procedures appropriate to the importance of your data.",
              "To the extent permitted by law, we are not responsible for indirect losses, lost profits, business interruption, corrupted data, unauthorized sharing, third-party outages, or losses caused by your violation of these Terms. Mandatory statutory responsibilities are not limited by this section.",
            ],
          },
          {
            title: "11. Disputes, Governing Rules, and Changes",
            body: [
              "Questions related to these Terms or the service should first be raised through the workspace administrator or the channel designated by the operator. If applicable law requires a specific dispute process, that legal requirement will control.",
              "We may update these Terms from time to time. Continuing to use the service after an updated version is published means you accept the update. When an update materially affects your rights or obligations, we will try to provide reasonable notice. Review the standalone Terms page periodically for the current version.",
            ],
          },
        ],
      },
    },
  },
  privacy: {
    key: "privacy",
    route: "/privacy",
    label: {
      en: "Privacy Policy",
      zh: "隐私政策",
    },
    text: {
      zh: {
        title: "ICEDR Drive 隐私政策",
        subtitle: "说明我们如何收集、使用、共享、保留和保护与你使用 ICEDR Drive 有关的信息。",
        effectiveDate,
        intro: [
          "本隐私政策适用于 ICEDR Drive 的账号、工作区、文件操作、外链分享、访客验证、预览、下载、审计和管理员设置功能。",
          "我们以最小必要、透明、可控、安全和依法处理为原则。根据你的角色、管理员配置和使用方式，我们处理的数据类型和目的可能不同。",
        ],
        sections: [
          {
            title: "一、我们收集的信息",
            body: [
              "账号信息包括邮箱、显示名称、角色、账号状态、创建时间、语言偏好、主题偏好以及登录方式。认证信息可能包括密码哈希、Passkey 公钥凭据、OAuth 标识符、会话令牌哈希、验证码状态和安全事件信息。",
              "文件与工作区信息包括文件名、目录结构、MIME 类型、大小、所有者、创建和更新时间、归档状态、收藏状态、对象存储键、上传与下载任务、预览意向、分享范围、外链 token、访问策略和备注。",
            ],
          },
          {
            title: "二、访客与外链数据",
            body: [
              "当访客访问外链时，我们可能处理分享 token、被访问项目、验证邮箱、验证码发送和验证结果、OAuth 分享会话、访问时间、下载或预览事件、等待时间、限速状态以及管理员启用的审计字段。",
              "如果管理员启用域名限制、下载次数限制或异常下载检测，系统可能使用相关访问记录判断是否允许访问、是否需要等待、是否达到次数上限或是否应向管理员呈现风险信号。",
            ],
          },
          {
            title: "三、我们如何使用信息",
            body: [
              "我们使用信息来创建和维护账号、验证身份、提供文件列表、存储和检索文件、生成预览、创建下载意向、发送邮箱验证码、执行外链访问控制、同步界面偏好、记录审计事件并支持管理员安全管理。",
              "我们还使用必要信息来排查故障、维护服务稳定性、防止欺诈和滥用、检测安全风险、执行组织策略、响应用户请求、改进产品体验以及履行法律或合规义务。",
            ],
          },
          {
            title: "四、处理依据",
            body: [
              "根据适用法律，我们处理信息的依据可能包括履行与你或组织之间的服务关系、取得你的同意、满足合法权益、保护用户和服务安全、遵守法律义务或执行公共利益相关要求。",
              "当某些功能需要单独同意时，界面会要求你作出选择。你可以撤回可撤回的同意，但撤回后相关功能可能不可用，且撤回不影响此前基于同意完成的合法处理。",
            ],
          },
          {
            title: "五、信息共享",
            body: [
              "我们不会出售你的个人信息。我们可能在必要范围内与工作区管理员、组织运营方、受托服务提供商、对象存储服务、邮件服务、身份提供方、日志和安全服务共享信息，以便提供、保护和管理服务。",
              "我们也可能在你指示、组织授权、法律要求、合并重组、安全事件处理、权利保护或防止严重损害时披露信息。服务提供商应按照合同和我们的指示处理信息，不得为自身目的任意使用。",
            ],
          },
          {
            title: "六、数据保留",
            body: [
              "我们仅在实现收集目的所需期间保留信息，包括提供服务、维护账号、支持外链有效期、保留审计记录、处理安全事件、满足法律义务和解决争议所需期间。",
              "文件、账号和日志的具体保留时间可能由管理员、组织政策、存储配置和法律要求决定。删除账号、关闭外链或移除文件后，备份、审计日志或法律要求保留的数据可能仍会在有限期间内存在。",
            ],
          },
          {
            title: "七、安全措施",
            body: [
              "我们使用访问控制、令牌哈希、密码哈希、会话管理、权限校验、外链访问策略、审计日志、配置隔离和基础设施安全实践来保护信息。管理员应妥善配置 SMTP、OAuth、Passkey、对象存储和网络访问。",
              "没有任何系统能够保证绝对安全。你应使用强密码或 Passkey，保护邮箱和设备，避免转发验证码，谨慎分发外链，并在发现异常访问、账号泄露或错误分享时及时联系管理员。",
            ],
          },
          {
            title: "八、你的选择与权利",
            body: [
              "根据适用法律和组织政策，你可以请求访问、更正、导出、删除或限制处理与你相关的个人信息。部分请求可能需要通过管理员处理，因为工作区数据通常由组织控制。",
              "我们可能需要验证你的身份，并可能在请求影响他人隐私、安全、审计完整性、法律义务或组织合法权益时拒绝、延迟或部分满足请求。你也可以调整界面语言、主题和部分账号偏好。",
            ],
          },
          {
            title: "九、国际传输与存储位置",
            body: [
              "根据部署方式，数据可能存储在本地服务器、对象存储、数据库、邮件服务或身份提供方所在地区。管理员负责选择基础设施区域，并评估跨境传输、供应商和合规要求。",
              "当数据需要跨地区处理时，我们会尽量使用合理的合同、技术和组织措施保护信息，但具体保护机制取决于部署环境、组织选择和适用法律。",
            ],
          },
          {
            title: "十、儿童与敏感信息",
            body: [
              "ICEDR Drive 面向组织和工作区使用，不面向未达到所在地法定同意年龄的儿童。未成年人使用服务应取得父母、监护人或组织授权，并遵守适用法律。",
              "除非业务和法律允许且确有必要，请不要上传高度敏感个人信息、儿童数据、健康信息、金融凭据、身份证件、密钥、密码明文或其他不应通过工作区分享的内容。",
            ],
          },
          {
            title: "十一、政策变更与联系",
            body: [
              "我们可能因产品、法律、安全或组织要求更新本隐私政策。重大变更会尽量通过界面、独立页面、管理员通知或其他合理方式提示。继续使用服务表示你了解更新后的处理方式。",
              "如需行使权利、提出隐私问题、报告安全事件或请求删除错误分享，请联系你的工作区管理员或服务运营方指定的联系渠道。管理员应维护清晰的内部响应流程。",
            ],
          },
        ],
      },
      en: {
        title: "ICEDR Drive Privacy Policy",
        subtitle: "How we collect, use, share, retain, and protect information related to your use of ICEDR Drive.",
        effectiveDate,
        intro: [
          "This Privacy Policy applies to ICEDR Drive accounts, workspaces, file operations, external sharing, visitor verification, preview, download, audit, and administrator settings features.",
          "We follow principles of necessity, transparency, control, security, and lawful processing. The information we process and the purposes for processing may vary depending on your role, administrator configuration, and how you use the service.",
        ],
        sections: [
          {
            title: "1. Information We Collect",
            body: [
              "Account information includes email address, display name, role, account status, creation time, language preference, theme preference, and sign-in method. Authentication information may include password hashes, Passkey public credentials, OAuth identifiers, session token hashes, verification code status, and security event information.",
              "File and workspace information includes file names, directory structure, MIME type, size, owner, creation and update time, archive status, starred status, object storage keys, upload and download tasks, preview intents, sharing scope, external link tokens, access policies, and notes.",
            ],
          },
          {
            title: "2. Visitor and External Link Data",
            body: [
              "When a visitor opens an external link, we may process the share token, accessed item, verification email, code delivery and verification results, OAuth share session, access time, download or preview events, wait time, rate-limit status, and audit fields enabled by administrators.",
              "If administrators enable domain restrictions, download limits, or anomaly detection, the system may use access records to decide whether access is allowed, whether waiting is required, whether a limit has been reached, or whether risk signals should be shown to administrators.",
            ],
          },
          {
            title: "3. How We Use Information",
            body: [
              "We use information to create and maintain accounts, verify identity, provide file lists, store and retrieve files, generate previews, create download intents, send email verification codes, enforce external link access controls, synchronize interface preferences, record audit events, and support administrator security management.",
              "We also use necessary information to troubleshoot, maintain service stability, prevent fraud and abuse, detect security risks, enforce organization policies, respond to user requests, improve the product experience, and comply with legal or regulatory obligations.",
            ],
          },
          {
            title: "4. Legal Bases",
            body: [
              "Depending on applicable law, our bases for processing may include performing a service relationship with you or your organization, obtaining your consent, pursuing legitimate interests, protecting users and the service, complying with legal obligations, or carrying out requirements connected to public interest.",
              "Where separate consent is required for a feature, the interface will ask you to choose. You may withdraw consent where withdrawal is available, but the related feature may stop working and withdrawal will not affect processing already completed lawfully on the basis of consent.",
            ],
          },
          {
            title: "5. Sharing Information",
            body: [
              "We do not sell your personal information. We may share information as necessary with workspace administrators, organization operators, service providers, object storage services, mail services, identity providers, logging services, and security services to provide, protect, and administer the service.",
              "We may also disclose information at your direction, with organization authorization, when required by law, during reorganization, in response to security incidents, to protect rights, or to prevent serious harm. Service providers must process information under contract and our instructions, and may not use it freely for their own purposes.",
            ],
          },
          {
            title: "6. Data Retention",
            body: [
              "We retain information only as long as needed for the purposes for which it was collected, including service operation, account maintenance, external link validity, audit records, security incident handling, legal compliance, and dispute resolution.",
              "Specific retention periods for files, accounts, and logs may be determined by administrators, organization policy, storage configuration, and legal requirements. After account deletion, link closure, or file removal, backups, audit logs, or legally retained data may remain for a limited period.",
            ],
          },
          {
            title: "7. Security Measures",
            body: [
              "We use access controls, token hashing, password hashing, session management, permission checks, external link policies, audit logs, configuration isolation, and infrastructure security practices to protect information. Administrators should carefully configure SMTP, OAuth, Passkeys, object storage, and network access.",
              "No system can be absolutely secure. Use strong passwords or Passkeys, protect your email and devices, do not forward verification codes, distribute external links carefully, and contact an administrator promptly if you notice unusual access, account compromise, or mistaken sharing.",
            ],
          },
          {
            title: "8. Your Choices and Rights",
            body: [
              "Depending on applicable law and organization policy, you may request access, correction, export, deletion, or restriction of processing for personal information about you. Some requests may need to be handled through an administrator because workspace data is usually controlled by the organization.",
              "We may need to verify your identity and may deny, delay, or partially fulfill a request when it affects another person’s privacy, security, audit integrity, legal obligations, or an organization’s legitimate interests. You may also adjust interface language, theme, and certain account preferences.",
            ],
          },
          {
            title: "9. International Transfers and Storage Locations",
            body: [
              "Depending on deployment, data may be stored in local servers, object storage, databases, mail services, or identity providers located in different regions. Administrators are responsible for choosing infrastructure regions and evaluating cross-border transfer, vendor, and compliance requirements.",
              "Where data must be processed across regions, we aim to use reasonable contractual, technical, and organizational measures to protect information, but the specific safeguards depend on the deployment environment, organization choices, and applicable law.",
            ],
          },
          {
            title: "10. Children and Sensitive Information",
            body: [
              "ICEDR Drive is intended for organization and workspace use, not for children below the age required for consent in their location. Minors should use the service only with parent, guardian, or organization authorization and in compliance with applicable law.",
              "Unless legally and operationally necessary, do not upload highly sensitive personal information, children’s data, health information, financial credentials, identity documents, keys, plaintext passwords, or other content that should not be shared through a workspace.",
            ],
          },
          {
            title: "11. Changes and Contact",
            body: [
              "We may update this Privacy Policy for product, legal, security, or organization reasons. Material changes will generally be indicated through the interface, standalone pages, administrator notices, or other reasonable channels. Continuing to use the service means you understand the updated processing practices.",
              "To exercise rights, raise privacy questions, report a security incident, or request deletion of mistaken sharing, contact your workspace administrator or the service operator’s designated channel. Administrators should maintain a clear internal response process.",
            ],
          },
        ],
      },
    },
  },
};

export function getLegalDocument(key: LegalDocumentKey) {
  return legalDocuments[key];
}

export function getLegalPageLabel(key: LegalDocumentKey, locale: Locale) {
  return legalDocuments[key].label[locale];
}
