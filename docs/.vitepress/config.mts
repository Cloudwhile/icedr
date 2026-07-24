import { defineConfig } from "vitepress";

const base = process.env.VITEPRESS_BASE || "/";
const publicBase = base.endsWith("/") ? base : `${base}/`;

export default defineConfig({
  base,
  cleanUrls: true,
  description: "ICEDR 自托管网盘的使用、管理、部署与故障排查文档",
  head: [
    [
      "link",
      { rel: "icon", type: "image/png", href: `${publicBase}favicon.png` },
    ],
    ["link", { rel: "apple-touch-icon", href: `${publicBase}favicon.png` }],
  ],
  lang: "zh-CN",
  lastUpdated: true,
  title: "ICEDR",
  titleTemplate: ":title · ICEDR 文档",
  themeConfig: {
    footer: {
      message: "基于 Apache License 2.0 发布",
      copyright: "Copyright © 2026 ICEDR",
    },
    lastUpdated: {
      text: "最后更新",
      formatOptions: {
        dateStyle: "medium",
        timeStyle: "short",
      },
    },
    nav: [
      { text: "首页", link: "/" },
      {
        text: "使用 ICEDR",
        items: [
          { text: "快速开始", link: "/guide/getting-started" },
          { text: "初始化向导", link: "/guide/setup-wizard" },
          {
            text: "用户使用指南",
            link: "/guide/user/file-management",
          },
          {
            text: "管理员指南",
            link: "/guide/admin/users-workspaces",
          },
        ],
      },
      { text: "部署", link: "/guide/deployment" },
      { text: "参考", link: "/reference/configuration" },
      { text: "v0.0.1-alpha.5", link: "/reference/releases" },
    ],
    outline: {
      label: "本页目录",
      level: [2, 3],
    },
    search: {
      provider: "local",
    },
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/Cloudwhile/icedr",
        ariaLabel: "GitHub 仓库",
      },
    ],
    sidebar: [
      {
        text: "使用 ICEDR",
        items: [
          { text: "项目概览", link: "/guide/overview" },
          { text: "快速开始", link: "/guide/getting-started" },
          { text: "初始化向导", link: "/guide/setup-wizard" },
          {
            text: "用户使用指南",
            collapsed: false,
            items: [
              {
                text: "上传与文件管理",
                link: "/guide/user/file-management",
              },
              { text: "外链分享", link: "/guide/user/external-sharing" },
              {
                text: "下载限制与访问验证",
                link: "/guide/user/download-access",
              },
              { text: "审计记录", link: "/guide/user/audit-log" },
            ],
          },
          {
            text: "管理员指南",
            collapsed: false,
            items: [
              {
                text: "用户与工作区",
                link: "/guide/admin/users-workspaces",
              },
              { text: "站点设置", link: "/guide/admin/site-settings" },
              { text: "邮件设置", link: "/guide/admin/mail-settings" },
              { text: "认证设置", link: "/guide/admin/auth-settings" },
              { text: "存储设置", link: "/guide/admin/storage-settings" },
            ],
          },
        ],
      },
      {
        text: "部署",
        items: [
          { text: "部署方式对比", link: "/guide/deployment" },
          { text: "Docker 部署", link: "/guide/docker" },
          { text: "Docker Compose 部署", link: "/deployment/docker-compose" },
          { text: "二进制部署", link: "/guide/binary" },
          { text: "反向代理", link: "/deployment/reverse-proxy" },
          { text: "HTTPS 配置", link: "/deployment/https" },
          { text: "MinIO / S3 配置", link: "/deployment/minio-s3" },
          { text: "PostgreSQL 配置", link: "/deployment/postgresql" },
          { text: "备份与恢复", link: "/deployment/backup-restore" },
          { text: "升级迁移", link: "/deployment/upgrade-migration" },
        ],
      },
      {
        text: "参考",
        items: [
          { text: "配置说明", link: "/reference/configuration" },
          {
            text: "环境变量速查表",
            link: "/reference/environment-variables",
          },
          {
            text: "传输任务状态机",
            link: "/reference/transfer-state-machine",
          },
          { text: "错误码参考", link: "/reference/error-codes" },
          { text: "发布与校验", link: "/reference/releases" },
          { text: "安全部署建议", link: "/reference/security" },
          { text: "故障排查", link: "/reference/troubleshooting" },
        ],
      },
    ],
  },
});
