# ICEDR 项目概览

ICEDR 是面向个人、小团队和自托管环境的网盘系统，提供工作区文件管理、在线预览、外链分享、访问验证、下载限制和审计记录。前端页面与服务端随同一个发布产物交付，可以使用 Docker、Docker Compose 或平台二进制部署。

::: warning 当前为 Alpha 预发布版本
最新发布是 [v0.0.1-alpha.5](https://github.com/Cloudwhile/icedr/releases/tag/v0.0.1-alpha.5)，发布于 2026 年 6 月 15 日。Alpha 版本适合评估、测试和可接受升级调整的自托管环境；用于重要数据前，请先建立可验证的备份与恢复流程，并固定具体版本，不要依赖 `latest` 标签。
:::

## 从这里开始

| 你要完成的事情 | 入口 |
| --- | --- |
| 第一次部署并完成初始化 | [快速开始](/guide/getting-started) |
| 了解初始化每一步如何选择 | [初始化向导](/guide/setup-wizard) |
| 使用容器快速部署 | [Docker 部署](/guide/docker) |
| 使用 Compose 管理服务 | [Docker Compose 部署](/deployment/docker-compose) |
| 不使用容器 | [二进制部署](/guide/binary) |
| 上线域名与 HTTPS | [反向代理](/deployment/reverse-proxy) · [HTTPS 配置](/deployment/https) |
| 准备生产数据保护 | [备份与恢复](/deployment/backup-restore) · [安全部署建议](/reference/security) |

## 核心能力

### 文件与工作区

- 上传文件、创建文件夹、搜索、排序和多选操作。
- 文件预览、下载、重命名、移动、复制、收藏、回收站和版本记录。
- 工作区与个人空间用量统计、配额和生命周期策略。
- 本地文件存储或 S3 / MinIO 对象存储。

### 外链分享

- 分享文件或文件夹，并控制预览、下载、有效期和访问次数。
- 支持公开访问、邮箱验证或登录身份访问。
- 支持允许的邮箱域名、等待时间、查看次数和下载次数限制。
- 分享创建、验证、预览、下载、撤销和限流事件可进入审计记录。

### 身份与管理

- 本地账号、OAuth / OIDC 和 Passkey 登录策略。
- 站点名称、Logo、邮件、存储、配额和文件生命周期设置。
- 独立系统状态页，展示版本、运行环境、内存与存储状态。
- 管理员审计记录支持事件筛选、分页和行为追踪。

## 默认部署模型

全新数据目录第一次启动时，ICEDR 使用 SQLite 和本地文件存储。浏览器会进入初始化向导，完成管理员账号、登录方式、邮件、存储和站点信息设置。

生产环境可以按需替换为：

- PostgreSQL：用于更成熟的数据库备份、监控和多人运行环境。
- S3 / MinIO：用于独立管理文件对象与容量。
- SMTP：用于验证码、密码重置和系统邮件。
- OAuth / OIDC：用于接入组织身份提供方。
- HTTPS 反向代理：用于公网域名、Passkey 和安全 Cookie。

## 推荐阅读顺序

1. 阅读 [快速开始](/guide/getting-started)，完成首次启动和部署验证。
2. 按 [用户使用指南](/guide/user/file-management) 验证上传、预览、下载和分享。
3. 按 [管理员指南](/guide/admin/site-settings) 设置站点、认证、邮件和存储。
4. 上线前完成 [反向代理](/deployment/reverse-proxy)、[HTTPS](/deployment/https) 和 [备份恢复演练](/deployment/backup-restore)。
5. 升级前查看 [发布与校验](/reference/releases) 和 [升级迁移](/deployment/upgrade-migration)。
