import { toMarkdown } from "../lib/format.js";
import { parseGitLabUrl } from "../lib/url.js";
import { probePage, fetchItem } from "../lib/inject.js";
import { loadSettings } from "../lib/settings.js";
import { scrapePage, normalizeScrape } from "../lib/scrape.js";

const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"),
  message: $("message"),
  output: $("output"),
  stats: $("stats"),
  copy: $("copy"),
  download: $("download"),
  settings: $("settings"),
};

let fileName = "gitlab.md";

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = kind;
}

function fail(status, message) {
  setStatus(status, "err");
  els.message.textContent = message;
  els.message.hidden = false;
}

async function run(tabId, fn, args = []) {
  const [res] = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: fn,
    args,
  });
  if (res?.error) throw new Error(String(res.error));
  return res?.result;
}

async function copy() {
  try {
    await navigator.clipboard.writeText(els.output.value);
    setStatus("Copied to clipboard", "ok");
  } catch (e) {
    els.output.select();
    setStatus("Copy failed — select and copy manually", "err");
  }
}

function download() {
  const blob = new Blob([els.output.value], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function main() {
  els.copy.addEventListener("click", copy);
  els.download.addEventListener("click", download);
  els.settings.addEventListener("click", () => browser.runtime.openOptionsPage());

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "https:")) {
    return fail("Not a GitLab page", "Open a GitLab issue or merge request and try again.");
  }

  let probe;
  try {
    probe = await run(tab.id, probePage);
  } catch {
    return fail("Cannot access this page", "Firefox does not allow extensions to run on this page.");
  }
  if (!probe?.isGitLab) {
    return fail("Not a GitLab page", "Open a GitLab issue or merge request and try again.");
  }

  const target = parseGitLabUrl(probe.href, probe.relativeRoot);
  if (!target) {
    return fail("Unsupported page", "Works on project issues (/-/issues/N, /-/work_items/N) and merge requests (/-/merge_requests/N).");
  }

  const settings = await loadSettings();
  setStatus(`Reading ${target.kind === "merge_request" ? "!" : "#"}${target.iid}…`);

  let data = null;
  let source = "";
  let apiError = "";

  if (settings.source !== "dom") {
    const res = await run(tab.id, fetchItem, [
      {
        relativeRoot: probe.relativeRoot,
        apiVersion: probe.apiVersion,
        projectPath: target.projectPath,
        kind: target.kind,
        iid: target.iid,
        includeLinks: settings.includeLinks,
      },
    ]).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (res?.ok) {
      data = res;
      source = "API";
    } else {
      apiError = res?.error || "Unknown error";
    }
  }

  if (!data && settings.source !== "api") {
    const [res] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: scrapePage });
    if (res?.result?.title || res?.result?.descriptionHtml) {
      data = normalizeScrape(res.result, target);
      source = "page";
    }
  }

  if (!data) {
    return fail(
      "Could not read this item",
      apiError
        ? `${apiError}. Make sure you are signed in and can view this item, or switch the source to “page” in settings.`
        : "Could not find issue content on the page. Wait until it has fully loaded and try again.",
    );
  }

  const md = toMarkdown({ kind: target.kind, ...data }, settings);
  fileName = `${target.projectPath.split("/").pop()}-${target.kind === "merge_request" ? "mr" : "issue"}-${target.iid}.md`;

  els.output.value = md;
  els.output.hidden = false;
  els.copy.disabled = false;
  els.download.disabled = false;
  els.stats.textContent = `~${Math.ceil(md.length / 4).toLocaleString()} tokens · via ${source}`;
  els.stats.title = `${md.length.toLocaleString()} characters`;

  if (settings.autoCopy) await copy();
  else setStatus("Ready", "ok");
}

main().catch((e) => fail("Error", String(e?.message || e)));
