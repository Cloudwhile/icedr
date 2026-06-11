import { defineConfig } from "vitepress";

const base = process.env.VITEPRESS_BASE || "/";

export default defineConfig({
  base,
  cleanUrls: true,
  description: "ICEDR workspace drive documentation",
  lang: "zh-CN",
  lastUpdated: true,
  title: "ICEDR",
  themeConfig: {
    footer: {
      message: "Released under the Apache License 2.0.",
      copyright: "Copyright © 2026 ICEDR",
    },
    nav: [
      { text: "指南", link: "/guide/getting-started" },
      { text: "部署", link: "/guide/deployment" },
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
        text: "开始使用",
        items: [
          { text: "项目概览", link: "/" },
          { text: "快速开始", link: "/guide/getting-started" },
          { text: "部署方式", link: "/guide/deployment" },
        ],
      },
      {
        text: "参考",
        items: [
          { text: "配置项", link: "/reference/configuration" },
          { text: "发布动态", link: "/reference/releases" },
        ],
      },
    ],
  },
});
