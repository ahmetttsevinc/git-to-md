/*
 * GitHub (github.com and GitHub Enterprise Server) support.
 *
 * GitHub's REST API lives on a different origin and does not accept the
 * browser session, so private repos would need a token. Instead we read only
 * what is already in the open page — no network requests at all:
 *
 *  - Issues: the React issue viewer embeds its GraphQL data, including the
 *    raw Markdown of the body and comments, in
 *    <script type="application/json" data-target="react-app.embeddedData">.
 *  - Pull requests: title/branches/merge info come from the same embedded
 *    JSON; description, comments, reviews and the sidebar are server-rendered
 *    HTML, which we convert back to Markdown.
 *  - Anything missing falls back to DOM scraping (also covers older GHES).
 *
 * `scrapeGitHub` is injected into the tab and MUST be self-contained.
 * `normalizeGitHub` runs in the popup and returns the GitLab-API-shaped data
 * that `toMarkdown` understands.
 */

import { htmlToMarkdown } from "./html-to-md.js";

export function scrapeGitHub(expected) {
  const q = (sels, root = document) => {
    for (const s of sels) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const loginFromHref = (a) => {
    const href = a?.getAttribute("href") || "";
    if (/\/apps\//.test(href)) return txt(a).replace(/\s*\(.*\)$/, "") || null;
    const m = href.match(/^(?:https?:\/\/[^/]+)?\/([^/?#]+)\/?$/);
    return m ? m[1] : null;
  };
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  // Classic pages keep each comment's raw Markdown for the "Copy Markdown" menu.
  const rawMarkdown = (box) =>
    box?.querySelector("clipboard-copy[data-dd-action-name='comment.copy_markdown'][value]")?.getAttribute("value") ?? null;
  let descriptionMarkdown = null;
  // <relative-time> has a datetime attribute on classic pages, only text
  // ("on Nov 16, 2026") in React SSR. Build the date from local parts so the
  // day does not shift with the time zone.
  const when = (root) => {
    const el = root?.querySelector("relative-time[datetime], [datetime]");
    if (el) return el.getAttribute("datetime");
    const t = txt(root?.querySelector("relative-time")).replace(/^on\s+/i, "");
    const d = t ? new Date(t) : null;
    if (!d || isNaN(d)) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const labelName = (a) => {
    const href = a.getAttribute("href") || "";
    let m = href.match(/\/labels\/([^/?#]+)/);
    if (m) return decodeURIComponent(m[1]);
    try {
      m = decodeURIComponent(href).match(/label:(?:"([^"]+)"|([^\s&]+))/);
      if (m) return m[1] || m[2];
    } catch {
      /* malformed URI */
    }
    const clone = a.cloneNode(true);
    clone.querySelectorAll(".sr-only, [role='tooltip']").forEach((e) => e.remove());
    return txt(clone.querySelector(".css-truncate-target") || clone);
  };

  // ---- embedded JSON -------------------------------------------------------
  let issue = null;
  let pr = null;
  for (const s of document.querySelectorAll('script[type="application/json"][data-target="react-app.embeddedData"]')) {
    try {
      const p = JSON.parse(s.textContent).payload || {};
      const i = p.issueViewerRoute?.data?.repository?.issue;
      if (i && Number(i.number) === expected.iid) issue = i;
      const r = p.pullRequestsLayoutRoute?.pullRequest;
      if (r && Number(r.number) === expected.iid) pr = r;
    } catch {
      /* not JSON we understand */
    }
  }

  // ---- DOM -----------------------------------------------------------------
  const title = txt(q(["[data-testid='issue-title']", ".js-issue-title", ".gh-header-title .markdown-title", "h1 bdi", "h1"]));
  const stateEl = q(["[data-testid='header-state']", ".gh-header-meta .State", "#partial-discussion-header .State", ".State"]);
  const state = txt(stateEl).toLowerCase() || null;
  const isDraft = !!document.querySelector(".State--draft") || /draft/.test(state || "");
  const baseRef = txt(q([".commit-ref.base-ref", ".base-ref"]));
  const headRef = txt(q([".commit-ref.head-ref", ".head-ref"]));

  // React issue viewer
  let descriptionHtml = q(["[data-testid='issue-body-viewer'] [data-testid='markdown-body']", "[data-testid='issue-body'] .markdown-body"])?.innerHTML || "";
  const comments = [];
  for (const box of document.querySelectorAll("[data-testid^='comment-viewer-outer-box-']")) {
    const body = box.querySelector("[data-testid='markdown-body'], .markdown-body");
    if (!body) continue;
    const layout = box.closest(".react-issue-comment") || box.parentElement;
    const header = layout?.querySelector("[data-testid='comment-header']");
    comments.push({
      login: loginFromHref(header?.querySelector("[data-testid='avatar-link'], a[href^='/']")) || loginFromHref(layout?.querySelector("[data-testid='avatar-link']")),
      datetime: when(header || layout),
      html: body.innerHTML,
    });
  }

  // Classic timeline (pull requests, older GitHub Enterprise issues)
  const threads = new Map();
  const seen = new Set();
  for (const body of document.querySelectorAll(".js-comment-body")) {
    const box = body.closest(".review-comment, .timeline-comment-group, .timeline-comment, .js-comment");
    if (!box || seen.has(box)) continue;
    seen.add(box);
    const id = box.id || box.closest("[id]")?.id || "";
    if (!descriptionHtml && /^(pullrequest|issue)-\d+$/.test(id)) {
      descriptionHtml = body.innerHTML;
      descriptionMarkdown = rawMarkdown(box);
      continue;
    }
    const item = box.closest(".TimelineItem, .js-timeline-item");
    const headText = txt(item?.querySelector(".TimelineItem-body") || item);
    const thread = box.closest(".js-resolvable-timeline-thread-container, .review-thread-component, [data-path]");
    const file =
      thread?.getAttribute("data-path") ||
      txt(thread?.querySelector("summary a.text-mono, summary .Link--primary, .file-info a, a.Link--primary.text-mono")) ||
      null;
    const note = {
      login: loginFromHref(box.querySelector("a.author")) || txt(box.querySelector("a.author")) || null,
      datetime: when(box) || when(item),
      html: body.innerHTML,
      markdown: rawMarkdown(box),
      review: !thread && /approved these changes/i.test(headText) ? "approved" : !thread && /requested changes/i.test(headText) ? "changes requested" : null,
      file,
      resolved: thread?.getAttribute("data-resolved") === "true" || /\bresolved\b/i.test(txt(thread?.querySelector(".js-resolvable-thread-toggler, summary"))),
    };
    const key = thread || box;
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key).push(note);
  }
  // Reviews without a body ("approved these changes")
  for (const item of document.querySelectorAll(".TimelineItem")) {
    if (item.querySelector(".js-comment-body")) continue;
    const t = txt(item.querySelector(".TimelineItem-body"));
    const review = /approved these changes/i.test(t) ? "approved" : /requested changes/i.test(t) ? "changes requested" : null;
    if (!review) continue;
    threads.set(item, [{
      login: loginFromHref(item.querySelector("a.author")) || txt(item.querySelector("a.author")) || null,
      datetime: when(item),
      html: "",
      review,
    }]);
  }

  // Sidebar
  const section = (testid, heading) => {
    const el = document.querySelector(`[data-testid='${testid}']`);
    if (el) return el;
    for (const item of document.querySelectorAll(".discussion-sidebar-item")) {
      if (txt(item.querySelector(".discussion-sidebar-heading") || item).toLowerCase().startsWith(heading)) return item;
    }
    return null;
  };
  const people = (root) => {
    if (!root) return [];
    const classic = root.querySelectorAll("a.assignee");
    const links = classic.length ? classic : root.querySelectorAll("[data-testid='avatar-link'], a[data-hovercard-type='user'], a[href^='/']");
    return uniq([...links].map(loginFromHref));
  };
  const labelsRoot = section("sidebar-labels-section", "labels");
  const labels = labelsRoot
    ? uniq([...labelsRoot.querySelectorAll("a.IssueLabel, a[href*='/labels/'], a[href*='label%3A']")].map(labelName))
    : [];
  const author = loginFromHref(q(["[data-testid='issue-body-header-author']", ".gh-header-meta a.author", "#partial-discussion-header a.author"]));
  const milestone = txt(section("sidebar-milestones-section", "milestone")?.querySelector("a[href*='/milestone/']")) || null;

  return {
    issue,
    pr,
    dom: {
      title,
      state,
      author,
      isDraft,
      baseRef,
      headRef,
      descriptionHtml,
      descriptionMarkdown,
      comments,
      threads: [...threads.values()],
      assignees: people(section("sidebar-assignees-section", "assignees")),
      reviewers: people(section("sidebar-reviewers-section", "reviewers")),
      labels,
      milestone,
    },
  };
}

/* ------------------------------------------------------------------------ */

/**
 * @returns {{item: object, discussions: object[], links: object[], warning?: string}}
 */
export function normalizeGitHub(raw, target, parse = defaultParse) {
  const md = (html) => (html ? htmlToMarkdown(parse(html)) : "");
  const u = (login) => (login ? { username: login } : null);
  const ref = `${target.projectPath}#${target.iid}`;
  const { dom } = raw;

  const domThreads = () =>
    dom.threads.map((t) => ({
      notes: t.map((n, i) => ({
        author: u(n.login),
        created_at: n.datetime,
        body: n.markdown ?? (n.html ? md(n.html) : n.review ? `_${n.review}_` : ""),
        review: n.html ? n.review : null,
        resolvable: !!n.file,
        resolved: !!n.resolved,
        position: i === 0 && n.file ? { new_path: n.file } : null,
      })),
    }));

  if (target.kind === "merge_request") {
    const p = raw.pr || {};
    const state = p.state ? p.state.toLowerCase() : normalizeState(dom.state);
    return {
      item: {
        title: p.title || dom.title || "(untitled)",
        references: { full: ref },
        state,
        draft: dom.isDraft && state === "open",
        source_branch: p.headBranch || dom.headRef || null,
        target_branch: p.baseBranch || dom.baseRef || null,
        author: u(p.author?.login || dom.author),
        assignees: dom.assignees.map(u),
        reviewers: dom.reviewers.map(u),
        labels: dom.labels,
        milestone: dom.milestone ? { title: dom.milestone } : null,
        created_at: p.createdTime || null,
        merged_at: p.mergedTime || null,
        merge_user: u(p.mergedBy),
        closed_at: p.closedTime || null,
        description: dom.descriptionMarkdown ?? md(dom.descriptionHtml),
      },
      discussions: domThreads(),
      links: [],
    };
  }

  const i = raw.issue;
  if (!i) {
    // DOM-only issue (stale embedded data or older GitHub Enterprise)
    const notes = dom.comments.length
      ? dom.comments.map((c) => ({ notes: [{ author: u(c.login), created_at: c.datetime, body: md(c.html) }] }))
      : domThreads();
    return {
      item: {
        title: dom.title || "(untitled)",
        references: { full: ref },
        state: normalizeState(dom.state),
        author: u(dom.author),
        assignees: dom.assignees.map(u),
        labels: dom.labels,
        milestone: dom.milestone ? { title: dom.milestone } : null,
        description: dom.descriptionMarkdown ?? md(dom.descriptionHtml),
      },
      discussions: notes,
      links: [],
    };
  }

  const nodes = new Map();
  for (const e of [...(i.timelineItems?.edges || []), ...(i.backTimelineItems?.edges || [])]) {
    if (e?.node?.id) nodes.set(e.node.id, e.node);
  }
  const timeline = [...nodes.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  let discussions = timeline
    .filter((n) => !(n.__typename === "IssueComment" && (n.isMinimized || n.isHidden)))
    .map((n) =>
      n.__typename === "IssueComment"
        ? { notes: [{ author: u(n.author?.login), created_at: n.createdAt, body: n.body || "" }] }
        : { notes: [{ system: true, author: u(n.actor?.login), created_at: n.createdAt, body: describeEvent(n) }] },
    );

  const jsonComments = timeline.filter((n) => n.__typename === "IssueComment").length;
  let warning;
  if (dom.comments.length > jsonComments) {
    // The user expanded hidden items after load: the DOM is more complete.
    discussions = dom.comments.map((c) => ({ notes: [{ author: u(c.login), created_at: c.datetime, body: md(c.html) }] }));
  } else if ((i.timelineItems?.totalCount || 0) > nodes.size) {
    warning = `${i.timelineItems.totalCount - nodes.size} timeline items are collapsed on the page. Click “Load more” and copy again to include them.`;
  }

  const stateReason = i.stateReason && i.state === "CLOSED" && i.stateReason !== "COMPLETED" ? ` (${i.stateReason.toLowerCase().replace(/_/g, " ")})` : "";
  const sub = i.subIssuesSummary?.total ? `${i.subIssuesSummary.completed}/${i.subIssuesSummary.total} done` : null;
  const parent = i.parent ? `${i.parent.repository?.nameWithOwner ? i.parent.repository.nameWithOwner : ""}#${i.parent.number}${i.parent.title ? ` ${i.parent.title}` : ""}` : null;

  return {
    item: {
      title: i.title,
      references: { full: i.repository?.nameWithOwner ? `${i.repository.nameWithOwner}#${i.number}` : ref },
      issue_type: i.issueType?.name || null,
      state: `${String(i.state || "").toLowerCase()}${stateReason}`,
      author: u(i.author?.login),
      assignees: (i.assignedActors?.nodes || i.assignees?.nodes || []).map((a) => u(a.login)),
      labels: (i.labels?.edges || []).map((e) => e.node?.name).filter(Boolean),
      milestone: i.milestone
        ? { title: i.milestone.title, due_date: i.milestone.dueOn ? i.milestone.dueOn.slice(0, 10) : null, state: i.milestone.closed ? "closed" : "active" }
        : null,
      parent,
      sub_issues: sub,
      created_at: i.createdAt,
      description: i.body || "",
    },
    discussions,
    links: (i.linkedPullRequests?.nodes || []).map((p) => ({
      references: { full: p.repository?.nameWithOwner ? `${p.repository.nameWithOwner}#${p.number}` : `#${p.number}` },
      title: p.title,
      state: p.state ? p.state.toLowerCase() : null,
      link_type: "pr",
    })),
    warning,
  };
}

function describeEvent(n) {
  const who = (x) => (x?.login ? `@${x.login}` : x?.name || "");
  switch (n.__typename) {
    case "LabeledEvent": return `added label ${n.label?.name || ""}`;
    case "UnlabeledEvent": return `removed label ${n.label?.name || ""}`;
    case "AssignedEvent": return `assigned ${who(n.assignee)}`;
    case "UnassignedEvent": return `unassigned ${who(n.assignee)}`;
    case "MilestonedEvent": return `added to milestone ${n.milestoneTitle || n.milestone?.title || ""}`;
    case "DemilestonedEvent": return `removed milestone ${n.milestoneTitle || ""}`;
    case "ClosedEvent": return `closed${n.stateReason && n.stateReason !== "COMPLETED" ? ` as ${n.stateReason.toLowerCase().replace(/_/g, " ")}` : ""}`;
    case "ReopenedEvent": return "reopened";
    case "RenamedTitleEvent": return `renamed from "${n.previousTitle || ""}"`;
    case "CrossReferencedEvent": {
      const s = n.source;
      return s?.number ? `mentioned in ${s.repository?.nameWithOwner || ""}#${s.number}` : "cross-referenced";
    }
    case "ReferencedEvent": return "referenced in a commit";
    default:
      return n.__typename.replace(/Event$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }
}

function normalizeState(s) {
  if (!s) return null;
  if (/merged/.test(s)) return "merged";
  if (/draft/.test(s)) return "open";
  if (/closed/.test(s)) return s.replace(/^closed\s*/, "closed ").trim();
  if (/open/.test(s)) return "open";
  return s;
}

function defaultParse(html) {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
}
