const fs = require("node:fs/promises");
const path = require("node:path");

const repository = process.env.GITHUB_REPOSITORY || "Cloudwhile/icedr";
const outputPath = path.resolve("docs/public/releases/latest.json");
const token = process.env.GITHUB_TOKEN || "";
const releaseLimit = Math.max(1, Math.min(Number(process.env.ICEDR_DOCS_RELEASE_LIMIT || 20), 100));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function isSafeUrl(value) {
  if (!value) return false;
  if (value.startsWith("#") || value.startsWith("/")) return true;

  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function renderInlineMarkdown(value) {
  let html = escapeHtml(value);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)]\(([^)\s]+)\)/g, (_, label, href) => {
    const normalizedHref = String(href).trim();
    if (!isSafeUrl(normalizedHref)) return label;
    return `<a href="${escapeAttribute(normalizedHref)}" target="_blank" rel="noreferrer">${label}</a>`;
  });

  return html;
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function renderTable(lines) {
  const [headerLine, , ...bodyLines] = lines;
  const headers = parseTableRow(headerLine);
  const rows = bodyLines.map(parseTableRow);
  const thead = headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("");
  const tbody = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");

  return `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let quoteLines = [];
  let codeLines = [];
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
  const body = release.body || "";

  return {
    assets: Array.isArray(release.assets) ? release.assets.map(pickAsset) : [],
    body: body || null,
    body_html: body ? renderMarkdown(body) : null,
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
