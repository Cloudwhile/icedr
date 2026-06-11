# ICEDR vX.Y.Z

> [!WARNING]
>
> alpha版本存在较多不稳定的功能和缺陷请勿将该版本的服务用于生产环境!

本次版本发布聚焦于 ICEDR 的核心网盘能力建设，包括文件管理、对象存储、外链分享、权限控制、认证流程与部署体验等方面的改进。本版本仍属于早期迭代版本，主要目标是形成可运行、可验证、可继续扩展的系统基础。

## Highlights

* 完成文件上传、下载与文件节点管理的基础闭环
* 支持 S3 / MinIO 兼容对象存储接入
* 实现外链分享与邮箱验证访问流程
* 增加基础审计日志，用于记录分享、验证和下载行为
* 完善前后端分离结构与 Docker Compose 本地部署环境
* 优化认证、权限、主面板或存储相关逻辑

## Added

* 新增文件节点管理能力，包括文件列表、上传确认、状态更新等
* 新增外链分享功能，支持通过分享链接访问指定文件
* 新增邮箱验证码验证流程，用于控制匿名访客访问权限
* 新增下载意图机制，下载前由后端进行权限校验
* 新增基础审计事件记录，便于追踪关键操作
* 新增对象存储配置，支持 MinIO / S3-compatible storage
* 新增 Docker Compose 开发环境，包含 PostgreSQL、Redis、MinIO、API 与 Web 服务

## Changed

* 调整项目目录结构，使 frontend、backend、database、deploy、docs 职责更加清晰
* 优化文件上传 / 下载流程，减少前端直接接触底层存储细节
* 优化分享访问流程，将匿名访问纳入后端授权控制
* 调整部分环境变量与部署配置，提升本地开发和生产部署的一致性
* 优化前端主面板结构，使文件、分享、传输、管理入口更加清晰

## Fixed

* 修复部分接口返回字段不统一的问题
* 修复分享访问流程中权限边界不清晰的问题
* 修复对象存储链接可能被直接暴露的问题
* 修复开发环境下部分配置缺失导致服务启动异常的问题
* 修复部分页面状态刷新后数据不同步的问题

## Security

* 避免向前端暴露长期有效的 S3 / MinIO 固定文件地址
* 下载请求统一经过后端权限校验后再生成短期访问凭证
* 分享访问增加邮箱验证与访问审计
* 对生产环境关键配置进行校验，避免缺少必要依赖时错误启动
* 对后续权限系统、下载策略和分享策略留出扩展空间

## Known Issues

* 当前权限模型仍处于早期阶段，后续需要进一步拆分站点角色、工作区角色和分享访问权限
* OAuth / OIDC 接入流程仍需进一步标准化，尤其是外部身份与本地用户的绑定关系
* 数据库迁移体系仍需完善，后续计划引入 Prisma Migration 或其他 migration 管理方案
* Office 在线预览 / 编辑能力暂未完整接入
* WebDAV、WOPI、多节点存储、对象对账和完整后台任务系统仍在规划中
* 当前部分临时状态仍需迁移到 Redis，以支持多实例部署和服务重启后的状态恢复

## Upgrade Notes

1. 请检查 `.env` 中的数据库、Redis、对象存储和前端 API 地址配置。
2. 如果使用 MinIO，请确认 bucket 已创建且未设置为公开读。
3. 生产环境请勿使用示例账号、默认密码或开发模式配置。
4. 如果本版本涉及数据库结构变化，请先备份数据库后再执行迁移。
5. 如果使用反向代理，请确保 `/api`、前端 history fallback 和对象存储访问策略配置正确。

## Deployment

```bash
pnpm install
pnpm build
docker compose up -d
```

或根据实际部署方式启动：

```bash
pnpm --filter backend start:prod
pnpm --filter frontend build
```

## Compatibility

* Node.js: 20+
* Package Manager: pnpm
* Database: PostgreSQL
* Cache / Queue: Redis
* Object Storage: MinIO / S3-compatible storage

## Contributors

* @your-name

## Full Changelog

See commit history for details.
