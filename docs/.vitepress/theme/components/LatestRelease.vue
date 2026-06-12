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
  html_url: string;
  name: string | null;
  prerelease: boolean;
  published_at: string | null;
  tag_name: string;
};

type ReleasePayload = {
  generated_at: string | null;
  release: GitHubRelease | null;
  error?: string | null;
};

const releaseDataUrl = `${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/releases/latest.json`;
const release = ref<GitHubRelease | null>(null);
const loading = ref(true);
const error = ref("");

const publishedAt = computed(() => {
  if (!release.value?.published_at) return "待发布";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(release.value.published_at));
});

const releaseBody = computed(() =>
  (release.value?.body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18),
);

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

    release.value = payload.release;
    if (!release.value) error.value = "暂无发布记录。";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "无法读取最新发布。";
  } finally {
    loading.value = false;
  }
});

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
</script>

<template>
  <section class="latest-release">
    <p v-if="loading" class="latest-release__muted">正在读取最新发布。</p>
    <p v-else-if="error" class="latest-release__muted">{{ error }}</p>
    <template v-else-if="release">
      <header class="latest-release__header">
        <div>
          <span class="latest-release__eyebrow">Latest Release</span>
          <h2>{{ release.name || release.tag_name }}</h2>
        </div>
        <a :href="release.html_url" target="_blank" rel="noreferrer">打开 GitHub Release</a>
      </header>

      <dl class="latest-release__meta">
        <div>
          <dt>版本</dt>
          <dd>{{ release.tag_name }}</dd>
        </div>
        <div>
          <dt>发布日期</dt>
          <dd>{{ publishedAt }}</dd>
        </div>
        <div>
          <dt>发布类型</dt>
          <dd>{{ release.prerelease ? "Prerelease" : "Stable" }}</dd>
        </div>
        <div>
          <dt>文件数量</dt>
          <dd>{{ release.assets.length }}</dd>
        </div>
      </dl>

      <div class="latest-release__section">
        <h3>Release 改动</h3>
        <div v-if="releaseBody.length" class="latest-release__body">
          <p v-for="line in releaseBody" :key="line">{{ line }}</p>
        </div>
        <p v-else class="latest-release__muted">本次发布暂未填写改动说明。</p>
      </div>

      <div class="latest-release__section">
        <h3>发布文件</h3>
        <ul v-if="release.assets.length" class="latest-release__assets">
          <li v-for="asset in release.assets" :key="asset.name">
            <a :href="asset.browser_download_url" target="_blank" rel="noreferrer">
              {{ asset.name }}
            </a>
            <span>{{ formatBytes(asset.size) }} · {{ asset.download_count }} 次下载</span>
          </li>
        </ul>
        <p v-else class="latest-release__muted">本次发布暂未附带文件。</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.latest-release {
  margin: 24px 0;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}

.latest-release__header {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
}

.latest-release__header h2 {
  margin: 4px 0 0;
  border: 0;
  padding: 0;
}

.latest-release__header a {
  white-space: nowrap;
}

.latest-release__eyebrow,
.latest-release__muted,
.latest-release__assets span {
  color: var(--vp-c-text-2);
}

.latest-release__eyebrow {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.latest-release__meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 18px 0 0;
}

.latest-release__meta div {
  padding: 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
}

.latest-release__meta dt {
  color: var(--vp-c-text-2);
  font-size: 12px;
}

.latest-release__meta dd {
  margin: 4px 0 0;
  font-weight: 700;
}

.latest-release__section {
  margin-top: 22px;
}

.latest-release__section h3 {
  margin-bottom: 10px;
}

.latest-release__body {
  display: grid;
  gap: 8px;
}

.latest-release__body p {
  margin: 0;
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
  .latest-release__header,
  .latest-release__assets li {
    flex-direction: column;
    align-items: flex-start;
  }

  .latest-release__meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .latest-release__meta {
    grid-template-columns: 1fr;
  }
}
</style>
