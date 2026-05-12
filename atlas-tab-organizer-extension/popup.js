const api = typeof browser !== "undefined" ? browser : chrome;

const state = {
  plan: null,
  tabsById: new Map()
};

const COLORS = ["blue", "green", "purple", "cyan", "orange", "yellow", "pink", "red", "grey"];
const INTERNAL_PROTOCOLS = new Set(["chrome:", "chrome-extension:", "edge:", "about:", "moz-extension:", "devtools:"]);

const CATEGORY_RULES = [
  { name: "Code", color: "blue", patterns: ["github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "stackblitz.com", "codesandbox.io"] },
  { name: "Docs", color: "green", patterns: ["docs.google.com", "notion.so", "confluence", "readthedocs", "developer.mozilla.org", "developer.chrome.com"] },
  { name: "AI", color: "purple", patterns: ["chatgpt.com", "claude.ai", "gemini.google.com", "openai.com", "anthropic.com", "perplexity.ai"] },
  { name: "Media", color: "pink", patterns: ["youtube.com", "bilibili.com", "netflix.com", "spotify.com", "twitch.tv"] },
  { name: "Shopping", color: "orange", patterns: ["amazon.", "taobao.com", "tmall.com", "jd.com", "shopee.", "lazada."] },
  { name: "Communication", color: "cyan", patterns: ["mail.google.com", "outlook.", "slack.com", "discord.com", "telegram.org", "web.whatsapp.com"] },
  { name: "Local Dev", color: "yellow", patterns: ["localhost", "127.0.0.1", "0.0.0.0"] }
];

const els = {
  smart: document.getElementById("analyzeSmart"),
  domain: document.getElementById("analyzeDomain"),
  apply: document.getElementById("applyPlan"),
  copy: document.getElementById("copyPlan"),
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  plan: document.getElementById("plan"),
  groups: document.getElementById("groups")
};

els.smart.addEventListener("click", () => preview("smart"));
els.domain.addEventListener("click", () => preview("domain"));
els.apply.addEventListener("click", applyCurrentPlan);
els.copy.addEventListener("click", copyCurrentPlan);

async function preview(mode) {
  setStatus("Reading tabs in this window...");
  setBusy(true);

  try {
    const tabs = await callApi(api.tabs.query, [{ currentWindow: true }], api.tabs);
    state.tabsById = new Map(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => [tab.id, tab]));
    state.plan = buildPlan(tabs, mode);
    renderPlan(state.plan);
    els.apply.disabled = state.plan.groups.length === 0;
    setStatus(state.plan.groups.length ? "Preview ready. Review it, then apply groups." : "No groupable tabs found.");
  } catch (error) {
    console.error(error);
    setStatus(`Could not create preview: ${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

function buildPlan(tabs, mode) {
  const candidates = tabs.filter(isGroupableTab);
  const duplicateUrls = findDuplicateUrls(candidates);
  const buckets = new Map();

  for (const tab of candidates) {
    const key = mode === "domain" ? domainKey(tab) : smartKey(tab);
    if (!key) continue;
    if (!buckets.has(key.name)) {
      buckets.set(key.name, { title: key.name, color: key.color, tabIds: [], tabs: [] });
    }
    buckets.get(key.name).tabIds.push(tab.id);
    buckets.get(key.name).tabs.push({ id: tab.id, title: tab.title || tab.url, url: tab.url });
  }

  const groups = [...buckets.values()]
    .filter(group => group.tabIds.length >= 2)
    .sort((a, b) => b.tabIds.length - a.tabIds.length || a.title.localeCompare(b.title));

  return {
    mode,
    generatedAt: new Date().toISOString(),
    groups,
    duplicateUrls,
    skipped: tabs.length - candidates.length
  };
}

function isGroupableTab(tab) {
  if (!tab || !Number.isInteger(tab.id) || tab.pinned || !tab.url) return false;
  try {
    const url = new URL(tab.url);
    return !INTERNAL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function smartKey(tab) {
  const haystack = `${tab.title || ""} ${tab.url || ""}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some(pattern => haystack.includes(pattern))) {
      return { name: rule.name, color: rule.color };
    }
  }
  const host = getHost(tab.url);
  if (!host) return null;
  if (looksLikeSearch(tab)) return { name: "Research", color: "red" };
  return { name: compactDomain(host), color: COLORS[Math.abs(hashCode(host)) % COLORS.length] };
}

function domainKey(tab) {
  const host = getHost(tab.url);
  if (!host) return null;
  return { name: compactDomain(host), color: COLORS[Math.abs(hashCode(host)) % COLORS.length] };
}

function getHost(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function compactDomain(host) {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

function looksLikeSearch(tab) {
  const host = getHost(tab.url) || "";
  return ["google.", "bing.com", "duckduckgo.com", "kagi.com", "search.brave.com"].some(item => host.includes(item));
}

function findDuplicateUrls(tabs) {
  const seen = new Map();
  const duplicates = [];

  for (const tab of tabs) {
    const key = normalizeUrl(tab.url);
    if (!key) continue;
    if (seen.has(key)) {
      duplicates.push({ originalTabId: seen.get(key), duplicateTabId: tab.id, url: tab.url });
    } else {
      seen.set(key, tab.id);
    }
  }

  return duplicates;
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function applyCurrentPlan() {
  if (!state.plan) return;
  if (!api.tabs.group || !api.tabGroups || !api.tabGroups.update) {
    setStatus("This browser does not expose tab group APIs to extensions yet.");
    return;
  }

  setBusy(true);
  setStatus("Applying groups...");

  try {
    for (const group of state.plan.groups) {
      const liveTabIds = group.tabIds.filter(id => state.tabsById.has(id));
      if (liveTabIds.length < 2) continue;
      const groupId = await callApi(api.tabs.group, [{ tabIds: liveTabIds }], api.tabs);
      await callApi(api.tabGroups.update, [groupId, { title: group.title, color: group.color }], api.tabGroups);
    }
    setStatus("Groups applied. Duplicate tabs were only reported, not closed.");
  } catch (error) {
    console.error(error);
    setStatus(`Could not apply groups: ${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

async function copyCurrentPlan() {
  if (!state.plan) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.plan, null, 2));
    setStatus("Plan copied as JSON.");
  } catch (error) {
    setStatus(`Could not copy plan: ${error.message || error}`);
  }
}

function renderPlan(plan) {
  els.summary.hidden = false;
  els.plan.hidden = false;
  els.summary.textContent = `${plan.groups.length} groups planned. ${plan.duplicateUrls.length} duplicate tabs detected. ${plan.skipped} tabs skipped.`;
  els.groups.textContent = "";

  for (const group of plan.groups) {
    const card = document.createElement("article");
    card.className = "group-card";

    const title = document.createElement("h3");
    title.textContent = group.title;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `${group.tabIds.length} tabs`;
    title.appendChild(badge);
    card.appendChild(title);

    const list = document.createElement("ul");
    for (const tab of group.tabs.slice(0, 6)) {
      const item = document.createElement("li");
      item.title = tab.url;
      item.textContent = tab.title || tab.url;
      list.appendChild(item);
    }
    if (group.tabs.length > 6) {
      const more = document.createElement("li");
      more.textContent = `+${group.tabs.length - 6} more`;
      list.appendChild(more);
    }
    card.appendChild(list);
    els.groups.appendChild(card);
  }
}

function setBusy(isBusy) {
  els.smart.disabled = isBusy;
  els.domain.disabled = isBusy;
  els.apply.disabled = isBusy || !state.plan || state.plan.groups.length === 0;
}

function setStatus(message) {
  els.status.textContent = message;
}

function callApi(fn, args, context) {
  return new Promise((resolve, reject) => {
    try {
      const result = fn.apply(context, args);
      if (result && typeof result.then === "function") {
        result.then(resolve, reject);
        return;
      }
      if (chrome && chrome.runtime && chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
}

function hashCode(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
