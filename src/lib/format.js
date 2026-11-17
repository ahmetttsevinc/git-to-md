/**
 * Convert GitLab REST API payloads into minimal Markdown.
 * Pure functions, no browser APIs: unit-tested under Node.
 */

export const DEFAULT_OPTIONS = Object.freeze({
  includeTimestamps: true,
  includeSystemNotes: false,
  includeResolved: true,
  includeLinks: true,
  stripImages: true,
  stripHtmlComments: true,
  demoteHeadings: true,
});

/**
 * @param {{kind: "issue"|"merge_request", item: object, discussions?: object[], links?: object[]}} data
 * @param {Partial<typeof DEFAULT_OPTIONS>} [options]
 * @returns {string}
 */
export function toMarkdown(data, options = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const { item, kind } = data;
  const out = [];

  out.push(`# ${oneLine(item.title)}`, "");

  const attrs = kind === "merge_request" ? mrAttributes(item, opt) : issueAttributes(item, opt);
  if (opt.includeLinks && Array.isArray(data.links) && data.links.length) {
    attrs.push(["Linked", formatLinks(data.links)]);
  }
  for (const [k, v] of attrs) {
    if (v !== undefined && v !== null && v !== "") out.push(`- ${k}: ${v}`);
  }

  const description = cleanBody(item.description, opt);
  if (description) out.push("", "## Description", "", description);

  const comments = formatDiscussions(Array.isArray(data.discussions) ? data.discussions : [], opt);
  if (comments) out.push("", "## Comments", "", comments);

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* ----------------------------- attributes ----------------------------- */

function issueAttributes(i, opt) {
  const a = [
    ["Ref", i.references?.full],
    ["Type", i.issue_type && i.issue_type !== "issue" ? i.issue_type : null],
    ["State", i.state],
    ["Confidential", i.confidential ? "yes" : null],
    ["Author", user(i.author)],
    ["Assignees", users(i.assignees)],
    ["Labels", list(i.labels)],
    ["Milestone", milestone(i.milestone)],
    ["Iteration", i.iteration ? i.iteration.title || `#${i.iteration.iid}` : null],
    ["Epic", i.epic ? `${i.epic.title}${i.epic.reference ? ` (${i.epic.reference})` : ""}` : null],
    ["Due", i.due_date],
    ["Weight", i.weight ?? null],
    ["Health", i.health_status],
    ["Estimate", i.time_stats?.human_time_estimate],
    ["Spent", i.time_stats?.human_total_time_spent],
  ];
  if (opt.includeTimestamps) {
    a.push(["Created", date(i.created_at)]);
    if (i.closed_at) a.push(["Closed", `${date(i.closed_at)}${i.closed_by ? ` by ${user(i.closed_by)}` : ""}`]);
  }
  return a;
}

function mrAttributes(m, opt) {
  const a = [
    ["Ref", m.references?.full],
    ["State", m.draft || m.work_in_progress ? `${m.state} (draft)` : m.state],
    ["Branch", m.source_branch ? `${m.source_branch} → ${m.target_branch}` : null],
    ["Author", user(m.author)],
    ["Assignees", users(m.assignees)],
    ["Reviewers", users(m.reviewers)],
    ["Labels", list(m.labels)],
    ["Milestone", milestone(m.milestone)],
    ["Merge status", m.state === "opened" ? m.detailed_merge_status || m.merge_status : null],
    ["Estimate", m.time_stats?.human_time_estimate],
    ["Spent", m.time_stats?.human_total_time_spent],
  ];
  if (opt.includeTimestamps) {
    a.push(["Created", date(m.created_at)]);
    if (m.merged_at) a.push(["Merged", `${date(m.merged_at)}${m.merged_by || m.merge_user ? ` by ${user(m.merge_user || m.merged_by)}` : ""}`]);
    else if (m.closed_at) a.push(["Closed", date(m.closed_at)]);
  }
  return a;
}

function formatLinks(links) {
  return links
    .map((l) => {
      const ref = l.references?.full || `#${l.iid}`;
      const rel = l.link_type && l.link_type !== "relates_to" ? `${l.link_type.replace(/_/g, " ")} ` : "";
      return `${rel}${ref} ${oneLine(l.title)}${l.state === "closed" ? " (closed)" : ""}`;
    })
    .join("; ");
}

/* ----------------------------- discussions ---------------------------- */

function formatDiscussions(discussions, opt) {
  const blocks = [];
  for (const d of discussions) {
    const notes = (d.notes || []).filter((n) => opt.includeSystemNotes || !n.system);
    if (!notes.length) continue;

    const resolvable = notes.some((n) => n.resolvable);
    const resolved = resolvable && notes.every((n) => !n.resolvable || n.resolved);
    if (resolved && !opt.includeResolved) continue;

    if (notes[0].system) {
      blocks.push(notes.map((n) => `- _${user(n.author)} ${oneLine(n.body)}${stamp(n, opt)}_`).join("\n"));
      continue;
    }

    const [first, ...replies] = notes;
    const head = [user(first.author) && `**${user(first.author)}**`, opt.includeTimestamps && date(first.created_at), position(first), resolved && "resolved"]
      .filter(Boolean)
      .join(" · ");
    const parts = [head, cleanBody(first.body, opt)];
    for (const r of replies) {
      const rh = `**${user(r.author)}**${stamp(r, opt, " · ")}`;
      const body = r.system ? `_${oneLine(r.body)}_` : cleanBody(r.body, opt);
      parts.push("", quote(`${rh}\n${body}`));
    }
    blocks.push(parts.join("\n").trim());
  }
  return blocks.join("\n\n");
}

function position(note) {
  const p = note.position;
  if (!p) return null;
  const path = p.new_path || p.old_path;
  if (!path) return null;
  const line = p.new_line ?? p.old_line ?? p.line_range?.end?.new_line;
  return `\`${path}${line ? `:${line}` : ""}\``;
}

/* ------------------------------- bodies ------------------------------- */

/**
 * Clean a Markdown body while leaving fenced code blocks untouched.
 * @param {string|null|undefined} text
 * @param {typeof DEFAULT_OPTIONS} opt
 */
export function cleanBody(text, opt = DEFAULT_OPTIONS) {
  if (!text) return "";
  const segments = splitFences(text.replace(/\r\n?/g, "\n"));
  const cleaned = segments
    .map((s) => (s.code ? s.text : cleanProse(s.text, opt)))
    .join("");
  return cleaned
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanProse(text, opt) {
  let t = text;
  if (opt.stripHtmlComments) t = t.replace(/<!--[\s\S]*?-->/g, "");
  if (opt.stripImages) {
    t = t.replace(/!\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)(\{[^}]*\})?/g, (_, alt) => {
      const a = alt.trim();
      // Alt text that is just an auto-generated file name carries no meaning.
      const fileLike = !/\s/.test(a) && (/\d{4,}/.test(a) || /[_-].*[_-]/.test(a) || /^(image|img|screenshot|pasted)/i.test(a));
      return a && !fileLike ? `[image: ${a}]` : "[image]";
    });
  }
  if (opt.demoteHeadings) {
    t = t.replace(/^(#{1,6})(?=\s)/gm, (h) => "#".repeat(Math.min(6, h.length + 2)));
  }
  return t;
}

/** Split text into prose / fenced-code segments (``` or ~~~ fences). */
function splitFences(text) {
  const lines = text.split("\n");
  const segs = [];
  let buf = [];
  let fence = null;
  const flush = (code) => {
    if (buf.length) segs.push({ code, text: buf.join("") });
    buf = [];
  };
  lines.forEach((line, idx) => {
    const nl = idx < lines.length - 1 ? "\n" : "";
    const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && m) {
      flush(false);
      fence = m[1];
      buf.push(line + nl);
    } else if (fence && m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) {
      buf.push(line + nl);
      flush(true);
      fence = null;
    } else {
      buf.push(line + nl);
    }
  });
  flush(Boolean(fence)); // unterminated fence: treat the rest as code
  return segs;
}

/* -------------------------------- utils ------------------------------- */

const user = (u) => (u?.username ? `@${u.username}` : u?.name || null);
const users = (arr) => (arr?.length ? arr.map(user).filter(Boolean).join(", ") : null);
const list = (arr) => (arr?.length ? arr.join(", ") : null);
const date = (iso) => (iso ? String(iso).slice(0, 10) : null);
const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();
const quote = (s) => s.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
const stamp = (n, opt, sep = " · ") => (opt.includeTimestamps && n.created_at ? `${sep}${date(n.created_at)}` : "");

function milestone(m) {
  if (!m) return null;
  const extra = [m.due_date && `due ${m.due_date}`, m.state === "closed" && "closed"].filter(Boolean).join(", ");
  return `${m.title}${extra ? ` (${extra})` : ""}`;
}
