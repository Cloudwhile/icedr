---
layout: home

hero:
  name: ICEDR
  text: 工作区文件、外链分享与审计平台
  tagline: 面向个人、小团队和自托管环境的文件管理服务。支持直接使用已发布的 Docker 镜像或平台二进制文件，并可按需接入 PostgreSQL、S3 / MinIO、SMTP 和统一身份认证。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: Docker 部署
      link: /guide/docker
    - theme: alt
      text: 二进制部署
      link: /guide/binary

features:
  - title: 开箱即可运行
    details: 默认使用本地 SQLite 和本地文件存储。首次打开页面后，按向导创建管理员账号即可进入系统。
  - title: 可控外链分享
    details: 支持访客访问、邮箱验证、登录身份、访问等待、限速、过期时间、下载次数和审计记录。
  - title: 面向自托管
    details: 发布 Docker 镜像和独立二进制文件。运行数据集中放在 data 目录或 Docker volume 中，便于备份和迁移。
  - title: 专业配置能力
    details: 可按需接入 PostgreSQL、Redis、S3 / MinIO、SMTP、OIDC、反向代理和更新检查。
---

## 部署入口

快速试用或单机部署优先选择 [Docker 部署](/guide/docker)。它无需安装 Node.js，也不需要从源码构建。

不运行容器，或需要在服务器上直接放置可执行文件时，选择 [二进制部署](/guide/binary)。

熟悉部署流程并只需查询变量含义时，查看 [配置说明](/reference/configuration)。

## 基础运行规则

1. 首次启动后访问 `http://服务器地址:13000`，浏览器会进入初始化向导。
2. 没有配置外部数据库时，ICEDR 会使用本地 SQLite；没有配置对象存储时，文件会保存在本地 `data/local-files`。
3. 需要长期保存的数据都在 `data` 目录中。Docker 部署时推荐映射到 `/opt/icedr/data`，升级前先备份这里。

## 进阶参考

- [Docker 部署](/guide/docker)：镜像标签、`docker run`、端口、持久化目录、环境变量和升级。
- [二进制部署](/guide/binary)：平台选择、启动命令、系统服务、数据目录和校验。
- [部署方式对比](/guide/deployment)：什么时候选 Docker，什么时候选二进制。
- [配置说明](/reference/configuration)：数据库、文件存储、外链、SMTP、OIDC、反代和安全检查。
- [发布与校验](/reference/releases)：最新版本、Release 文件、MD5 / SHA256 校验和预发布规则。
