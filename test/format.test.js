import { test } from "node:test";
import assert from "node:assert/strict";
import { toMarkdown, cleanBody, DEFAULT_OPTIONS } from "../src/lib/format.js";
import { parseGitLabUrl } from "../src/lib/url.js";

const issue = {
  title: "Login  fails\non Safari",
  references: { full: "acme/web#42" },
  issue_type: "issue",
  state: "opened",
  confidential: false,
  author: { username: "alice" },
  assignees: [{ username: "bob" }, { username: "carol" }],
  labels: ["bug", "priority::high"],
  milestone: { title: "v2.3", due_date: "2026-12-01", state: "active" },
  due_date: "2026-11-30",
  weight: 3,
  time_stats: { human_time_estimate: "4h", human_total_time_spent: null },
  created_at: "2026-11-01T10:00:00.000Z",
  description:
    "<!-- template: describe the bug -->\n# Steps\n\n1. Open login\n2. Submit\n\n![screenshot](/uploads/abc/shot.png){width=800 height=600}\n\n```js\n# not a heading\n<!-- keep in code -->\n```\n\n\n\nThanks",
};

const discussions = [
  { notes: [{ system: true, body: "added ~bug label", author: { username: "alice" }, created_at: "2026-11-01T10:01:00Z" }] },
  {
    notes: [
      { body: "Repro'd on 17.1", author: { username: "bob" }, created_at: "2026-11-02T09:00:00Z", resolvable: false },
      { body: "Same here", author: { username: "carol" }, created_at: "2026-11-02T10:00:00Z", resolvable: false },
    ],
  },
  {
    notes: [
      {
        body: "Typo here",
        author: { username: "dave" },
        created_at: "2026-11-03T09:00:00Z",
        resolvable: true,
        resolved: true,
        position: { new_path: "src/login.js", new_line: 12 },
      },
    ],
  },
];

test("issue: attributes, description and comments", () => {
  const md = toMarkdown({ kind: "issue", item: issue, discussions, links: [{ references: { full: "acme/web#7" }, title: "Safari tracker", link_type: "blocks", state: "opened" }] });
  assert.equal(
    md,
    `# Login fails on Safari

- Ref: acme/web#42
- State: opened
- Author: @alice
- Assignees: @bob, @carol
- Labels: bug, priority::high
- Milestone: v2.3 (due 2026-12-01)
- Due: 2026-11-30
- Weight: 3
- Estimate: 4h
- Created: 2026-11-01
- Linked: blocks acme/web#7 Safari tracker

## Description

### Steps

1. Open login
2. Submit

[image]

\`\`\`js
# not a heading
<!-- keep in code -->
\`\`\`

Thanks

## Comments

**@bob** · 2026-11-02

Repro'd on 17.1

> **@carol** · 2026-11-02
>
> Same here

**@dave** · 2026-11-03 · \`src/login.js:12\` · resolved

Typo here
`,
  );
});

test("system notes are opt-in, resolved threads can be dropped", () => {
  const md = toMarkdown({ kind: "issue", item: issue, discussions }, { includeSystemNotes: true, includeResolved: false, includeTimestamps: false });
  assert.match(md, /- _@alice added ~bug label_/);
  assert.doesNotMatch(md, /Typo here/);
  assert.doesNotMatch(md, /2026-11-0/);
});

test("merge request attributes", () => {
  const md = toMarkdown({
    kind: "merge_request",
    item: {
      title: "Fix Safari login",
      references: { full: "acme/web!9" },
      state: "opened",
      draft: true,
      source_branch: "fix/safari",
      target_branch: "main",
      author: { username: "bob" },
      assignees: [],
      reviewers: [{ username: "alice" }],
      labels: [],
      detailed_merge_status: "mergeable",
      created_at: "2026-11-04T00:00:00Z",
      description: "",
    },
    discussions: [],
  });
  assert.equal(
    md,
    "# Fix Safari login\n\n- Ref: acme/web!9\n- State: opened (draft)\n- Branch: fix/safari → main\n- Author: @bob\n- Reviewers: @alice\n- Merge status: mergeable\n- Created: 2026-11-04\n",
  );
});

test("cleanBody respects options and unterminated fences", () => {
  assert.equal(cleanBody("![](x.png)", DEFAULT_OPTIONS), "[image]");
  assert.equal(cleanBody("![a](x.png)", { ...DEFAULT_OPTIONS, stripImages: false }), "![a](x.png)");
  assert.equal(cleanBody("```\n<!-- x -->", DEFAULT_OPTIONS), "```\n<!-- x -->");
  assert.equal(cleanBody("###### h", DEFAULT_OPTIONS), "### h");
  assert.equal(cleanBody("## h", { ...DEFAULT_OPTIONS, demoteHeadings: false }), "## h");
});

test("parseGitLabUrl", () => {
  assert.deepEqual(parseGitLabUrl("https://gitlab.example.com/a/b/c/-/issues/12#note_3"), {
    platform: "gitlab",
    origin: "https://gitlab.example.com",
    projectPath: "a/b/c",
    kind: "issue",
    iid: 12,
  });
  assert.equal(parseGitLabUrl("https://git.corp/gitlab/x/y/-/merge_requests/5/diffs", "/gitlab").projectPath, "x/y");
  assert.equal(parseGitLabUrl("https://git.corp/x/y/-/work_items/5").kind, "issue");
  assert.equal(parseGitLabUrl("https://git.corp/groups/x/-/work_items/5"), null);
  assert.equal(parseGitLabUrl("https://git.corp/x/y/-/issues"), null);
  assert.equal(parseGitLabUrl("about:blank"), null);
});

test("file-name alt text collapses to [image]", () => {
  assert.equal(cleanBody("![PXL_20260917_185012205.MP](/u/a.jpg) ![Login form](/u/b.png)"), "[image] [image: Login form]");
});

test("headings are re-levelled relative to the body's top heading", () => {
  assert.equal(
    cleanBody("## Issue\ntext\n### Expected\n#### Detail\n```\n# code\n```"),
    "### Issue\ntext\n#### Expected\n##### Detail\n```\n# code\n```",
  );
  assert.equal(cleanBody("#### Deep only\n###### deeper"), "### Deep only\n##### deeper");
  assert.equal(cleanBody("#2965 is not a heading"), "#2965 is not a heading");
});
