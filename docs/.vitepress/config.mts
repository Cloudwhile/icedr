import { defineConfig } from "vitepress";

const base = process.env.VITEPRESS_BASE || "/";
const publicBase = base.endsWith("/") ? base : `${base}/`;

export default defineConfig({
  base,
  cleanUrls: true,
  description: "ICEDR 工作区文件、外链分享与审计平台文档",
  head: [
    ["link", { rel: "icon", type: "image/png", href: `${publicBase}favicon.png` }],
    ["link", { rel: "apple-touch-icon", href: `${publicBase}favicon.png` }],
  ],
  lang: "zh-CN",
  lastUpdated: true,
  title: "ICEDR",
  themeConfig: {
    footer: {
      message: "Released under the Apache License 2.0.",
      copyright: "Copyright © 2026 ICEDR",
    },
    nav: [
      { text: "开始", link: "/guide/getting-started" },
      { text: "Docker", link: "/guide/docker" },
      { text: "二进制", link: "/guide/binary" },
      { text: "配置", link: "/reference/configuration" },
      { text: "发布", link: "/reference/releases" },
    ],
    outline: {
      label: "本页目录",
    },
    search: {
      provider: "local",
    },
    sidebar: [
      {
        text: "使用 ICEDR",
        items: [
          { text: "项目概览", link: "/" },
          { text: "快速开始", link: "/guide/getting-started" },
          { text: "Docker 部署", link: "/guide/docker" },
          { text: "二进制部署", link: "/guide/binary" },
          { text: "部署方式对比", link: "/guide/deployment" },
        ],
      },
      {
        text: "参考",
        items: [
          { text: "配置说明", link: "/reference/configuration" },
          { text: "发布与校验", link: "/reference/releases" },
        ],
      },
    ],
  },
});
