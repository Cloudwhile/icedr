---
layout: home
title: 首页

hero:
  name: ICEDR
  text: 自托管网盘文档
  tagline: 从首次部署、初始化到日常使用、管理和故障排查，按实际任务进入对应文档。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 选择部署方式
      link: /guide/deployment
    - theme: alt
      text: 项目概览
      link: /guide/overview

features:
  - title: 用户使用指南
    details: 上传与文件管理、外链分享、访问验证、下载限制和审计记录。
    link: /guide/user/file-management
    linkText: 开始使用
  - title: 管理员指南
    details: 用户与工作区、站点、邮件、认证和存储设置。
    link: /guide/admin/users-workspaces
    linkText: 管理 ICEDR
  - title: 部署
    details: Docker、Compose、二进制、反向代理、HTTPS、数据库、对象存储和升级迁移。
    link: /guide/deployment
    linkText: 查看部署方式
  - title: 参考与排障
    details: 配置、环境变量、错误码、安全建议、发布校验和故障排查。
    link: /reference/configuration
    linkText: 查阅参考
---

## 当前版本

::: warning Alpha 预发布
当前最新发布为 [v0.0.1-alpha.5](/reference/releases)。Alpha 版本适合评估和测试；用于重要数据前，请固定具体版本，并先完成可验证的备份与恢复流程。
:::

如果这是第一次部署，请从 [快速开始](/guide/getting-started) 完成启动、初始化和部署成功验证；已有运行实例出现问题时，直接查看 [故障排查](/reference/troubleshooting)。
