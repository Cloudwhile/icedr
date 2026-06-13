<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

type GitHubReleaseAsset = {
  browser_download_url: string;
  download_count: number;
  name: string;
  size: number;
  updated_at: string;
};

type GitHubRelease = {
  assets: GitHubReleaseAsset[];
  body: string | null;
  body_html?: string | null;
  html_url: string;
  name: string | null;
  prerelease: boolean;
  published_at: string | null;
  tag_name: string;
};

type ReleasePayload = {
  generated_at: string | null;
  release: GitHubRelease | null;
  releases?: GitHubRelease[];
  error?: string | null;
};

const releaseDataUrl = `${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/releases/latest.json`;
const releases = ref<GitHubRelease[]>([]);
const loading = ref(true);
const error = ref("");

const latestRelease = computed(() => {
  return [...releases.value].sort((left, right) => releaseTime(right) - releaseTime(left))[0] || null;
});

const timelineReleases = computed(() => {
  return [...releases.value].sort((left, right) => {
    const timeDifference = releaseTime(left) - releaseTime(right);
    if (timeDifference !== 0) return timeDifference;
    return left.tag_name.localeCompare(right.tag_name);
  });
});

onMounted(async () => {
  try {
    const response = await fetch(releaseDataUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error("无法读取发布数据。");
    }

    const payload = (await response.json()) as ReleasePayload;
    if (payload.error) {
      throw new Error(payload.error);
    }

    const loadedReleases = Array.isArray(payload.releases)
      ? payload.releases
      : payload.release
        ? [payload.release]
        : [];

    releases.value = loadedReleases.filter((release) => Boolean(release?.tag_name));
    if (!releases.value.length) error.value = "暂无发布记录。";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "无法读取发布记录。";
  } finally {
    loading.value = false;
  }
});

function releaseTime(release: GitHubRelease) {
  if (!release.published_at) return 0;
  const timestamp = new Date(release.published_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDate(value: string | null) {
  if (!value) return "待发布";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "大小未知";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function dockerTag(version: string) {
  return version.replace(/^v(?=\d)/i, "");
}

function isLatest(release: GitHubRelease) {
  return release.tag_name === latestRelease.value?.tag_name;
}

function renderReleaseBody(release: GitHubRelease) {
  if (release.body_html) return release.body_html;
  return renderMarkdown(release.body || "");
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function isSafeUrl(value: string) {
  if (!value) return false;
  if (value.startsWith("#") || value.startsWith("/")) return true;

  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function renderInlineMarkdown(value: string) {
  let html = escapeHtml(value);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    const normalizedHref = href.trim();
    if (!isSafeUrl(normalizedHref)) return label;
    return `<a href="${escapeAttribute(normalizedHref)}" target="_blank" rel="noreferrer">${label}</a>`;
  });

  return html;
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function renderTable(lines: string[]) {
  const [headerLine, , ...bodyLines] = lines;
  const headers = parseTableRow(headerLine);
  const rows = bodyLines.map(parseTableRow);
  const thead = headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("");
  const tbody = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");

  return `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function renderMarkdown(markdown: string) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html: string[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];
  let quoteLines: string[] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType) return;
    html.push(`<${listType}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    html.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join("")}</blockquote>`);
    quoteLines = [];
  };

  const flushCode = () => {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };

  const flushBlocks = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        flushBlocks();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushBlocks();
      continue;
    }

    if (trimmed.includes("|") && lines[index + 1] && isTableDivider(lines[index + 1])) {
      flushBlocks();
      const tableLines = [line, lines[index + 1]];
      index += 2;

      while (index < lines.length && lines[index].trim().includes("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }

      index -= 1;
      html.push(renderTable(tableLines));
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushBlocks();
      html.push("<hr>");
      continue;
    }

    const unorderedItem = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (unorderedItem) {
      flushParagraph();
      flushQuote();
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(unorderedItem[1]);
      continue;
    }

    const orderedItem = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (orderedItem) {
      flushParagraph();
      flushQuote();
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(orderedItem[1]);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }

  if (inCodeBlock) flushCode();
  flushBlocks();

  return html.join("\n");
}
</script>

<template>
  <section class="latest-release">
    <p v-if="loading" class="latest-release__state">正在读取发布记录。</p>
    <p v-else-if="error" class="latest-release__state">{{ error }}</p>
    <div v-else class="latest-release__timeline" aria-label="ICEDR 发布记录">
      <details
        v-for="item in timelineReleases"
        :key="item.tag_name"
        class="latest-release__item"
        :open="isLatest(item)"
      >
        <summary class="latest-release__summary">
          <span class="latest-release__marker" aria-hidden="true"></span>
          <span class="latest-release__summary-main">
            <span class="latest-release__title-row">
              <span class="latest-release__version">{{ item.tag_name }}</span>
              <span v-if="isLatest(item)" class="latest-release__badge latest-release__badge--latest">最新</span>
              <span
                class="latest-release__badge"
                :class="item.prerelease ? 'latest-release__badge--preview' : 'latest-release__badge--stable'"
              >
                {{ item.prerelease ? "预发布" : "稳定版" }}
              </span>
            </span>
            <span class="latest-release__subline">
              <time :datetime="item.published_at || undefined">{{ formatDate(item.published_at) }}</time>
              <span v-if="item.assets.length">{{ item.assets.length }} 个文件</span>
            </span>
          </span>
          <span class="latest-release__chevron" aria-hidden="true"></span>
        </summary>

        <div class="latest-release__panel">
          <div class="latest-release__release-links">
            <a :href="item.html_url" target="_blank" rel="noreferrer">GitHub Release</a>
            <code>docker pull corecherry/icedr-po:{{ dockerTag(item.tag_name) }}</code>
          </div>

          <section class="latest-release__section">
            <h3>Release 改动</h3>
            <div
              v-if="renderReleaseBody(item)"
              class="latest-release__notes"
              v-html="renderReleaseBody(item)"
            ></div>
            <p v-else class="latest-release__muted">本次发布暂未填写改动说明。</p>
          </section>

          <section class="latest-release__section">
            <h3>Release Assets</h3>
            <ul v-if="item.assets.length" class="latest-release__assets">
              <li v-for="asset in item.assets" :key="asset.name">
                <a :href="asset.browser_download_url" target="_blank" rel="noreferrer">
                  {{ asset.name }}
                </a>
                <span>{{ formatBytes(asset.size) }} · {{ asset.download_count }} 次下载</span>
              </li>
            </ul>
            <p v-else class="latest-release__muted">本次发布暂未附带文件。</p>
          </section>
        </div>
      </details>
    </div>
  </section>
</template>

<style scoped>
.latest-release {
  margin: 24px 0;
}

.latest-release__state {
  margin: 0;
  padding: 16px 0;
  color: var(--vp-c-text-2);
}

.latest-release__timeline {
  position: relative;
  display: grid;
  gap: 16px;
  padding-left: 28px;
}

.latest-release__timeline::before {
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 8px;
  width: 2px;
  border-radius: 999px;
  background: linear-gradient(to top, var(--vp-c-brand-1), var(--vp-c-divider));
  content: "";
}

.latest-release__item {
  position: relative;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
}

.latest-release__item[open] {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 36%, var(--vp-c-divider));
  box-shadow: 0 12px 30px rgb(0 0 0 / 0.06);
}

.latest-release__summary {
  position: relative;
  display: flex;
  gap: 14px;
  align-items: center;
  min-height: 72px;
  padding: 14px 16px;
  cursor: pointer;
  list-style: none;
}

.latest-release__summary::-webkit-details-marker {
  display: none;
}

.latest-release__marker {
  position: absolute;
  top: 27px;
  left: -26px;
  width: 12px;
  height: 12px;
  border: 3px solid var(--vp-c-bg);
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--vp-c-brand-1) 36%, var(--vp-c-divider));
}

.latest-release__summary-main {
  display: grid;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.latest-release__title-row,
.latest-release__subline {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.latest-release__version {
  font-family: var(--vp-font-family-mono);
  font-size: 17px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.latest-release__badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.latest-release__badge--latest {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, transparent);
  background: color-mix(in srgb, var(--vp-c-brand-1) 12%, var(--vp-c-bg));
  color: var(--vp-c-brand-1);
}

.latest-release__badge--preview {
  border-color: color-mix(in srgb, #c06a00 38%, transparent);
  background: color-mix(in srgb, #c06a00 12%, var(--vp-c-bg));
  color: #8b4d00;
}

.latest-release__badge--stable {
  border-color: color-mix(in srgb, #16815f 38%, transparent);
  background: color-mix(in srgb, #16815f 12%, var(--vp-c-bg));
  color: #0f6b4e;
}

.latest-release__subline {
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.latest-release__subline span::before {
  color: var(--vp-c-divider);
  content: "•";
  margin-right: 8px;
}

.latest-release__chevron {
  width: 10px;
  height: 10px;
  border-right: 2px solid var(--vp-c-text-3);
  border-bottom: 2px solid var(--vp-c-text-3);
  transform: rotate(45deg);
  transition: transform 0.18s ease;
}

.latest-release__item[open] .latest-release__chevron {
  transform: rotate(225deg) translate(-2px, -2px);
}

.latest-release__panel {
  display: grid;
  gap: 22px;
  padding: 0 16px 18px;
}

.latest-release__release-links {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}

.latest-release__release-links code {
  overflow: auto;
  max-width: 100%;
  white-space: nowrap;
}

.latest-release__section h3 {
  margin: 0 0 10px;
  border: 0;
  padding: 0;
  font-size: 18px;
}

.latest-release__notes {
  overflow-x: auto;
}

.latest-release__notes :deep(h1),
.latest-release__notes :deep(h2),
.latest-release__notes :deep(h3),
.latest-release__notes :deep(h4),
.latest-release__notes :deep(h5),
.latest-release__notes :deep(h6) {
  margin: 18px 0 8px;
  border: 0;
  padding: 0;
}

.latest-release__notes :deep(h1:first-child),
.latest-release__notes :deep(h2:first-child),
.latest-release__notes :deep(h3:first-child) {
  margin-top: 0;
}

.latest-release__notes :deep(p),
.latest-release__notes :deep(ul),
.latest-release__notes :deep(ol),
.latest-release__notes :deep(blockquote),
.latest-release__notes :deep(table),
.latest-release__notes :deep(pre) {
  margin: 10px 0;
}

.latest-release__notes :deep(ul),
.latest-release__notes :deep(ol) {
  padding-left: 20px;
}

.latest-release__notes :deep(li + li) {
  margin-top: 4px;
}

.latest-release__notes :deep(blockquote) {
  padding-left: 14px;
  border-left: 3px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
}

.latest-release__notes :deep(pre) {
  padding: 12px;
  overflow: auto;
  border-radius: 8px;
  background: var(--vp-code-block-bg);
}

.latest-release__notes :deep(table) {
  display: table;
  width: 100%;
}

.latest-release__muted,
.latest-release__assets span {
  color: var(--vp-c-text-2);
}

.latest-release__assets {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.latest-release__assets li {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.latest-release__assets li:last-child {
  border-bottom: 0;
}

@media (max-width: 720px) {
  .latest-release__release-links,
  .latest-release__assets li {
    align-items: flex-start;
    flex-direction: column;
  }

  .latest-release__summary {
    padding-right: 14px;
  }
}

@media (max-width: 480px) {
  .latest-release__timeline {
    padding-left: 22px;
  }

  .latest-release__marker {
    left: -22px;
  }
}
</style>
