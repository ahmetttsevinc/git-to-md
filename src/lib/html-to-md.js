/**
 * Minimal HTML → Markdown converter tuned for GitLab's rendered Markdown
 * (`.md` containers). Operates on DOM nodes, so it works with the browser's
 * DOMParser (inert: no scripts run) and with linkedom in tests.
 *
 * Goal is compact, faithful text — not pixel-perfect round-tripping.
 */

const SKIP = new Set(["SCRIPT", "STYLE", "BUTTON", "SVG", "svg", "COPY-CODE", "TEMPLATE", "NOSCRIPT", "TEXTAREA", "SELECT"]);
const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "UL", "OL", "PRE", "BLOCKQUOTE", "TABLE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "DETAILS", "FIGURE"]);

/** @param {Node} root */
export function htmlToMarkdown(root) {
  if (!root) return "";
  return block(root)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* Convert children of a container, separating block-level output with blank lines. */
function block(node) {
  const parts = [];
  let inline = "";
  const flushInline = () => {
    const t = inline.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
    if (t) parts.push(t);
    inline = "";
  };
  for (const child of node.childNodes) {
    if (child.nodeType === 1 && BLOCK.has(child.tagName.toUpperCase())) {
      flushInline();
      const b = element(child).trim();
      if (b) parts.push(b);
    } else {
      inline += child.nodeType === 1 ? element(child) : text(child);
    }
  }
  flushInline();
  return parts.join("\n\n");
}

function text(node) {
  if (node.nodeType !== 3) return "";
  return node.nodeValue.replace(/\s+/g, " ");
}

function inlineChildren(node) {
  let s = "";
  for (const c of node.childNodes) s += c.nodeType === 1 ? element(c) : text(c);
  return s;
}

function element(el) {
  const tag = el.tagName.toUpperCase();
  if (SKIP.has(tag) || SKIP.has(el.tagName)) return "";
  if (el.getAttribute("aria-hidden") === "true" && tag !== "IMG") return "";
  const cls = el.getAttribute("class") || "";
  if (/\b(anchor|gl-sr-only|sr-only)\b/.test(cls) && tag === "A") return "";

  switch (tag) {
    case "BR":
      return "\n";
    case "HR":
      return "---";
    case "H1": case "H2": case "H3": case "H4": case "H5": case "H6":
      return `${"#".repeat(Number(tag[1]))} ${inlineChildren(el).trim()}`;
    case "P":
    case "SECTION":
    case "ARTICLE":
    case "FIGURE":
      return block(el);
    case "DIV":
      return block(el);
    case "STRONG": case "B": {
      const t = inlineChildren(el).trim();
      return t ? `**${t}**` : "";
    }
    case "EM": case "I": {
      const t = inlineChildren(el).trim();
      return t ? `_${t}_` : "";
    }
    case "DEL": case "S": {
      const t = inlineChildren(el).trim();
      return t ? `~~${t}~~` : "";
    }
    case "CODE":
      return inlineCode(el.textContent);
    case "KBD":
      return inlineCode(el.textContent);
    case "PRE":
      return codeBlock(el);
    case "A":
      return link(el);
    case "IMG":
      return image(el);
    case "GL-EMOJI":
      return el.textContent || `:${el.getAttribute("data-name") || ""}:`;
    case "INPUT":
      return "";
    case "UL":
    case "OL":
      return listBlock(el, tag === "OL");
    case "BLOCKQUOTE":
      return block(el).split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
    case "TABLE":
      return table(el);
    case "DETAILS": {
      const summary = el.querySelector(":scope > summary");
      const title = summary ? inlineChildren(summary).trim() : "Details";
      const clone = el.cloneNode(true);
      clone.querySelector(":scope > summary")?.remove();
      return `**${title}**\n\n${block(clone)}`;
    }
    case "SUMMARY":
      return "";
    default:
      return inlineChildren(el);
  }
}

function inlineCode(s) {
  const t = String(s || "").replace(/\n/g, " ");
  if (!t) return "";
  const fence = t.includes("`") ? "``" : "`";
  return `${fence}${t}${fence}`;
}

function codeBlock(pre) {
  const lang =
    pre.getAttribute("data-canonical-lang") ||
    pre.getAttribute("lang") ||
    (pre.getAttribute("class") || "").match(/language-([\w+#.-]+)/)?.[1] ||
    "";
  const code = (pre.textContent || "").replace(/\n+$/, "");
  const fence = code.includes("```") ? "~~~" : "```";
  return `${fence}${lang === "plaintext" ? "" : lang}\n${code}\n${fence}`;
}

function link(a) {
  const label = inlineChildren(a).trim();
  const href = a.getAttribute("href") || "";
  const cls = a.getAttribute("class") || "";
  // GitLab references (@user, #12, !34, ~label, %milestone) are self-describing.
  if (/\bgfm\b/.test(cls) || !href || href.startsWith("#")) return label;
  if (!label) return "";
  if (label === href || label === decodeURI(href)) return `<${href}>`;
  return `[${label}](${href})`;
}

function image(img) {
  const src = img.getAttribute("data-src") || img.getAttribute("src") || "";
  if (!src || src.startsWith("data:")) return img.getAttribute("alt") ? `[image: ${img.getAttribute("alt")}]` : "";
  return `![${img.getAttribute("alt") || ""}](${src})`;
}

function listBlock(list, ordered) {
  let n = Number(list.getAttribute("start") || 1);
  const out = [];
  for (const li of list.children) {
    if (li.tagName.toUpperCase() !== "LI") continue;
    const box = li.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]");
    const bullet = ordered ? `${n++}.` : "-";
    const marker = box ? `${bullet} ${box.hasAttribute("checked") ? "[x]" : "[ ]"}` : bullet;
    let body = block(li);
    // Tight list item (no <p>): keep nested lists directly under the text.
    if (!li.querySelector(":scope > p")) body = body.replace(/\n\n(?=(?:[-*]|\d+\.) )/g, "\n");
    const pad = " ".repeat(bullet.length + 1);
    const lines = body.split("\n");
    out.push(`${marker} ${lines[0]}` + lines.slice(1).map((l) => (l ? `\n${pad}${l}` : "\n")).join(""));
  }
  return out.join("\n");
}

function table(t) {
  const rows = [...t.querySelectorAll("tr")].map((tr) =>
    [...tr.children].map((c) => inlineChildren(c).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()),
  );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  return [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}
