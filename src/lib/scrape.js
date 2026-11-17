/*
 * DOM scraping fallback.
 *
 * `scrapePage` is injected into the tab (isolated world) and returns only the
 * relevant HTML fragments + attributes. It must be self-contained.
 * `normalizeScrape` runs in the popup: it parses the fragments with an inert
 * DOMParser, converts them to Markdown and reshapes everything into the same
 * structure the REST API returns, so one formatter serves both sources.
 *
 * GitLab's markup changes between versions, so every field tries several
 * selectors (legacy issue page, work items UI, merge request page).
 */

import { htmlToMarkdown } from "./html-to-md.js";

export function scrapePage() {
  const q = (sels, root = document) => {
    for (const s of sels) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  const qa = (sels, root = document) => {
    for (const s of sels) {
      const els = root.querySelectorAll(s);
      if (els.length) return [...els];
    }
    return [];
  };
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const usernames = (root) => {
    if (!root) return [];
    const seen = new Set();
    for (const a of root.querySelectorAll("[data-username], a[href^='/'][data-user-id], a.author-link, a[data-testid*='user']")) {
      const u = a.getAttribute("data-username") || (a.getAttribute("href") || "").split("/").filter(Boolean).pop();
      if (u) seen.add(u.replace(/^@/, ""));
    }
    return [...seen];
  };

  const title = txt(q(["[data-testid='work-item-title']", "[data-testid='issue-title']", "[data-testid='title-content']", "h1.title", ".detail-page-header h1", "h1"]));

  const stateEl = q(["[data-testid='work-item-state-badge']", "[data-testid='issuable-status-badge']", ".issuable-status-badge", ".status-box", ".detail-page-header .badge"]);
  const state = txt(stateEl).toLowerCase() || null;

  const authorRoot = q(["[data-testid='work-item-created']", ".detail-page-header-body", ".issuable-meta", ".detail-page-header"]);
  const author = usernames(authorRoot)[0] || null;
  const createdAt = authorRoot?.querySelector("time[datetime]")?.getAttribute("datetime") || null;

  const descEl = q([
    "[data-testid='work-item-description'] .md",
    ".detail-page-description .description .md",
    ".detail-page-description .md",
    ".description .md",
    ".merge-request-details .description .md",
  ]);

  const sidebar = q(["[data-testid='work-item-attributes-wrapper']", "aside.right-sidebar", ".issuable-sidebar", "aside"]) || document;
  const block = (sels) => q(sels, sidebar);

  const assignees = usernames(block(["[data-testid='work-item-assignees']", ".block.assignee", "[data-testid='assignee-block']"]));
  const reviewers = usernames(block([".block.reviewer", "[data-testid='reviewer-block']"]));
  const labels = [...new Set(
    qa([".gl-label-text-scoped", ".gl-label-text", ".gl-label .gl-link"], block(["[data-testid='work-item-labels']", ".block.labels", "[data-testid='sidebar-labels']", ".labels"]) || sidebar)
      .map((el) => (el.closest(".gl-label")?.querySelector(".gl-label-text") ? txt(el.closest(".gl-label")) : txt(el)))
      .filter(Boolean),
  )];
  const valueOf = (sels) => {
    const b = block(sels);
    if (!b) return null;
    const v = q(["[data-testid='sidebar-milestone-value']", "[data-testid*='value']", ".value", "a", "span.gl-font-bold", "span"], b);
    const t = txt(v || b);
    return t && !/^none$/i.test(t) ? t : null;
  };
  const milestone = valueOf(["[data-testid='work-item-milestone']", ".block.milestone", "[data-testid='sidebar-milestones']"]);
  const dueDate = valueOf(["[data-testid='work-item-due-dates']", ".block.due_date", "[data-testid='sidebar-due-date']"]);
  const weight = valueOf(["[data-testid='work-item-weight']", ".block.weight", "[data-testid='sidebar-weight']"]);

  // Comments / discussions
  const entries = qa([
    "[data-testid='work-item-notes'] > li",
    "#notes-list > li",
    "ul.main-notes-list > li",
    ".notes > li.timeline-entry",
  ]);
  const threads = [];
  for (const entry of entries) {
    const notes = entry.matches("li.note") && !entry.querySelector("li.note") ? [entry] : [...entry.querySelectorAll("li.note, li.timeline-entry.note")];
    const list = (notes.length ? notes : [entry]).map((n) => {
      const system = n.classList.contains("system-note") || n.matches("[data-testid='system-note']") || !!n.querySelector(".system-note-message");
      const body = n.querySelector(".note-text.md, .note-text, .note-body .md, .system-note-message, .timeline-content .md");
      const authorA = n.querySelector(".note-header-info a[data-username], a.author-name-link, .note-header-author-name, a[data-username]");
      return {
        username: authorA?.getAttribute("data-username") || txt(n.querySelector(".note-header-author-name, .author-username")).replace(/^@/, "") || null,
        datetime: n.querySelector("time[datetime]")?.getAttribute("datetime") || null,
        html: body ? body.innerHTML : "",
        system,
      };
    }).filter((n) => n.html);
    const resolved = !!entry.querySelector(".discussion-resolved, [data-testid='resolved-discussion']") ||
      /resolved/i.test(txt(entry.querySelector(".discussion-headline-light, .discussion-toggle-button")) || "");
    const file = txt(entry.querySelector(".file-title-name, .diff-file .file-title a, [data-testid='file-name-content']")) || null;
    if (list.length) threads.push({ notes: list, resolved, file });
  }

  return {
    isGitLab: true,
    title,
    state,
    author,
    createdAt,
    assignees,
    reviewers,
    labels,
    milestone,
    dueDate,
    weight,
    descriptionHtml: descEl ? descEl.innerHTML : "",
    threads,
  };
}

/** Convert scraped fragments into the REST API shape used by toMarkdown. */
export function normalizeScrape(s, { kind, projectPath, iid }) {
  const parser = new DOMParser();
  const md = (html) => (html ? htmlToMarkdown(parser.parseFromString(`<body>${html}</body>`, "text/html").body) : "");
  const u = (username) => (username ? { username } : null);

  const item = {
    title: s.title || "(untitled)",
    state: normalizeState(s.state),
    references: { full: `${projectPath}${kind === "merge_request" ? "!" : "#"}${iid}` },
    author: u(s.author),
    assignees: s.assignees.map(u),
    reviewers: s.reviewers.map(u),
    labels: s.labels,
    milestone: s.milestone ? { title: s.milestone } : null,
    due_date: s.dueDate,
    weight: s.weight,
    created_at: s.createdAt,
    description: md(s.descriptionHtml),
  };

  const discussions = s.threads.map((t) => ({
    notes: t.notes.map((n, i) => ({
      author: u(n.username),
      created_at: n.datetime,
      system: n.system,
      body: n.system ? md(n.html).replace(/\s+/g, " ") : md(n.html),
      resolvable: t.resolved,
      resolved: t.resolved,
      position: i === 0 && t.file ? { new_path: t.file } : null,
    })),
  }));

  return { item, discussions, links: [] };
}

function normalizeState(s) {
  if (!s) return null;
  if (/open/.test(s)) return "opened";
  if (/merged/.test(s)) return "merged";
  if (/closed/.test(s)) return "closed";
  return s;
}
