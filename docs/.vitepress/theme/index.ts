import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import LatestRelease from "./components/LatestRelease.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("LatestRelease", LatestRelease);
  },
} satisfies Theme;
