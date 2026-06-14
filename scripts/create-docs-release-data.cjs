const fs = require("node:fs/promises");
const path = require("node:path");

const repository = process.env.GITHUB_REPOSITORY || "Cloudwhile/icedr";
const outputPath = path.resolve("docs/public/releases/latest.json");
const token = process.env.GITHUB_TOKEN || "";
const releaseLimit = Math.max(1, Math.min(Number(process.env.ICEDR_DOCS_RELEASE_LIMIT || 20), 100));

function pickAsset(asset) {
  return {
    browser_download_url: asset.browser_download_url,
    download_count: asset.download_count,
    name: asset.name,
    size: asset.size,
    updated_at: asset.updated_at,
  };
}

function pickRelease(release) {
  return {
    assets: Array.isArray(release.assets) ? release.assets.map(pickAsset) : [],
    html_url: release.html_url,
    name: release.name || null,
    prerelease: Boolean(release.prerelease),
    published_at: release.published_at || null,
    tag_name: release.tag_name,
  };
}

async function writePayload(payload) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(`${outputPath}.tmp`, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(`${outputPath}.tmp`, outputPath);
}

async function main() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "icedr-docs-release-data",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=${releaseLimit}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`GitHub Releases returned ${response.status}`);
  }

  const releaseResponse = await response.json();
  const releases = Array.isArray(releaseResponse) ? releaseResponse : [];
  const pickedReleases = releases.map(pickRelease);

  await writePayload({
    generated_at: new Date().toISOString(),
    release: pickedReleases[0] || null,
    releases: pickedReleases,
  });
}

main().catch(async (error) => {
  await writePayload({
    generated_at: new Date().toISOString(),
    release: null,
    releases: [],
    error: "暂时无法读取发布信息。",
  });
  console.error(error instanceof Error ? error.message : error);
});
