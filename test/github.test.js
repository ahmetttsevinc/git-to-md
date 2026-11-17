import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { scrapeGitHub, normalizeGitHub } from "../src/lib/github.js";
import { toMarkdown } from "../src/lib/format.js";
import { parseGitHubUrl } from "../src/lib/url.js";

// Structures below are trimmed copies of real github.com markup (2026-11).

const parse = (html) => parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body;

function run(html, url, opts) {
  globalThis.document = parseHTML(`<!doctype html><html><head></head><body>${html}</body></html>`).document;
  const target = parseGitHubUrl(url);
  const raw = scrapeGitHub({ iid: target.iid });
  const data = normalizeGitHub(raw, target, parse);
  return { md: toMarkdown({ kind: target.kind, ...data }, opts), data };
}

const embedded = (payload) =>
  `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload })}</script>`;

const issueNode = {
  number: 42,
  title: "Crash on save",
  state: "CLOSED",
  stateReason: "NOT_PLANNED",
  createdAt: "2026-11-01T10:00:00Z",
  author: { login: "alice" },
  repository: { nameWithOwner: "acme/app" },
  issueType: { name: "Bug" },
  assignedActors: { nodes: [{ login: "bob" }] },
  labels: { edges: [{ node: { name: "bug" } }, { node: { name: "p1" } }] },
  milestone: { title: "v2", dueOn: "2026-12-01T00:00:00Z", closed: false },
  subIssuesSummary: { total: 3, completed: 1 },
  linkedPullRequests: { nodes: [{ number: 50, title: "Fix crash", state: "MERGED", repository: { nameWithOwner: "acme/app" } }] },
  body: '### Steps\r\n\r\n1. Save\r\n\r\n<img width="800" alt="Image" src="https://github.com/user-attachments/assets/x" />',
  timelineItems: {
    totalCount: 4,
    edges: [
      { node: { __typename: "LabeledEvent", id: "e1", createdAt: "2026-11-01T10:01:00Z", actor: { login: "alice" }, label: { name: "bug" } } },
      { node: { __typename: "IssueComment", id: "c1", createdAt: "2026-11-02T09:00:00Z", author: { login: "bob" }, body: "Repro'd", isMinimized: false } },
    ],
  },
  backTimelineItems: {
    edges: [
      { node: { __typename: "IssueComment", id: "c1", createdAt: "2026-11-02T09:00:00Z", author: { login: "bob" }, body: "Repro'd", isMinimized: false } },
      { node: { __typename: "IssueComment", id: "c2", createdAt: "2026-11-02T10:00:00Z", author: { login: "spam" }, body: "buy now", isMinimized: true } },
      { node: { __typename: "ClosedEvent", id: "e2", createdAt: "2026-11-03T00:00:00Z", actor: { login: "bob" }, stateReason: "NOT_PLANNED" } },
    ],
  },
};

test("GitHub issue from embedded JSON", () => {
  const { md, data } = run(embedded({ issueViewerRoute: { data: { repository: { issue: issueNode } } } }), "https://github.com/acme/app/issues/42");
  assert.equal(
    md,
    `# Crash on save

- Ref: acme/app#42
- Type: Bug
- State: closed (not planned)
- Author: @alice
- Assignees: @bob
- Labels: bug, p1
- Milestone: v2 (due 2026-12-01)
- Sub-issues: 1/3 done
- Created: 2026-11-01
- Linked: pr acme/app#50 Fix crash (merged)

## Description

### Steps

1. Save

[image]

## Comments

**@bob** · 2026-11-02

Repro'd
`,
  );
  assert.equal(data.warning, undefined);
});

test("GitHub issue: system events opt-in, collapsed items warn", () => {
  const node = { ...issueNode, timelineItems: { ...issueNode.timelineItems, totalCount: 9 } };
  const { md, data } = run(embedded({ issueViewerRoute: { data: { repository: { issue: node } } } }), "https://github.com/acme/app/issues/42", { includeSystemNotes: true });
  assert.match(md, /- _@alice added label bug · 2026-11-01_/);
  assert.match(md, /- _@bob closed as not planned · 2026-11-03_/);
  assert.doesNotMatch(md, /buy now/);
  assert.match(data.warning, /^5 timeline items are collapsed/);
});

test("GitHub issue: stale embedded JSON for another issue falls back to DOM", () => {
  const html =
    embedded({ issueViewerRoute: { data: { repository: { issue: { ...issueNode, number: 7 } } } } }) +
    `<h1 data-testid="issue-title">Real title</h1>
     <span data-testid="header-state">Open</span>
     <a data-testid="issue-body-header-author" href="https://github.com/carol">Carol (carol)</a>
     <div data-testid="issue-body-viewer"><div data-testid="markdown-body"><p>Body with <a class="user-mention" href="https://github.com/dave">@dave</a></p></div></div>
     <div data-testid="sidebar-labels-section"><a href="https://github.com/acme/app/issues?q=state%3Aopen%20label%3A%22needs%20info%22"><span>needs info</span><span class="sr-only">Tooltip text</span></a></div>
     <div class="react-issue-comment">
       <div data-testid="comment-header"><a data-testid="avatar-link" href="/erin">Erin (erin)</a><relative-time>on Nov 16, 2026</relative-time></div>
       <div data-testid="comment-viewer-outer-box-IC_1"><div data-testid="markdown-body"><p>See <a href="https://github.com/acme/app/issues/3">#3</a></p></div></div>
     </div>`;
  const { md } = run(html, "https://github.com/acme/app/issues/8");
  assert.equal(
    md,
    `# Real title

- Ref: acme/app#8
- State: open
- Author: @carol
- Labels: needs info

## Description

Body with @dave

## Comments

**@erin** · 2026-11-16

See #3
`,
  );
});

test("GitHub pull request: embedded header + classic timeline with raw markdown", () => {
  const html =
    embedded({
      pullRequestsLayoutRoute: {
        pullRequest: {
          number: 9, title: "Fix crash", state: "MERGED", author: { login: "alice" },
          headBranch: "fix/crash", baseBranch: "main", createdTime: "2026-11-04T00:00:00Z",
          mergedTime: "2026-11-05T00:00:00Z", mergedBy: "bob",
        },
      },
    }) +
    `<div class="js-discussion">
      <div class="TimelineItem"><div class="timeline-comment-group" id="pullrequest-1">
        <a class="author" href="/alice">alice</a><relative-time datetime="2026-11-04T00:00:00Z"></relative-time>
        <clipboard-copy data-dd-action-name="comment.copy_markdown" value="Fixes #8&#10;&#10;## Notes&#10;- ok"></clipboard-copy>
        <div class="js-comment-body"><p>Fixes <a class="issue-link" href="/acme/app/issues/8">#8</a></p></div>
      </div></div>
      <div class="TimelineItem"><div class="TimelineItem-body"><a class="author" href="/bob">bob</a> requested changes</div>
        <div class="timeline-comment-group"><a class="author" href="/bob">bob</a><relative-time datetime="2026-11-04T05:00:00Z"></relative-time>
        <div class="js-comment-body"><p>Please add a <strong><strong>test</strong></strong></p></div></div>
      </div>
      <div class="js-resolvable-timeline-thread-container" data-resolved="true" data-path="src/save.js">
        <div class="review-comment"><a class="author" href="/bob">bob</a><relative-time datetime="2026-11-04T06:00:00Z"></relative-time>
          <div class="js-comment-body"><p>nit</p></div></div>
        <div class="review-comment"><a class="author" href="/alice">alice</a><relative-time datetime="2026-11-04T07:00:00Z"></relative-time>
          <div class="js-comment-body"><p>done</p></div></div>
      </div>
      <div class="TimelineItem"><div class="TimelineItem-body"><a class="author" href="/carol">carol</a> approved these changes <relative-time datetime="2026-11-05T00:00:00Z"></relative-time></div></div>
    </div>
    <div class="discussion-sidebar-item"><div class="discussion-sidebar-heading">Reviewers</div>
      <a class="no-underline" href="/apps/copilot">Copilot code review</a><a class="assignee" href="/apps/copilot">Copilot</a><a class="assignee" href="/carol">Carol (carol)</a></div>
    <div class="discussion-sidebar-item"><div class="discussion-sidebar-heading">Labels</div>
      <a class="IssueLabel" href="/acme/app/issues?q=label%3Abug"><span class="css-truncate-target">bug</span></a></div>
    <div class="discussion-sidebar-item"><div class="discussion-sidebar-heading">Milestone</div>
      <a href="/acme/app/milestone/2">v2</a></div>`;

  const { md } = run(html, "https://github.com/acme/app/pull/9/files");
  assert.equal(
    md,
    `# Fix crash

- Ref: acme/app#9
- State: merged
- Branch: fix/crash → main
- Author: @alice
- Reviewers: @Copilot, @carol
- Labels: bug
- Milestone: v2
- Created: 2026-11-04
- Merged: 2026-11-05 by @bob

## Description

Fixes #8

### Notes
- ok

## Comments

**@bob** · 2026-11-04 · changes requested

Please add a **test**

**@bob** · 2026-11-04 · \`src/save.js\` · resolved

nit

> **@alice** · 2026-11-04
>
> done

**@carol** · 2026-11-05

_approved_
`,
  );
});

test("parseGitHubUrl", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/a/b/pull/12/files"), {
    platform: "github", origin: "https://github.com", projectPath: "a/b", kind: "merge_request", iid: 12,
  });
  assert.equal(parseGitHubUrl("https://ghe.corp/a/b/issues/3#issuecomment-1").kind, "issue");
  assert.equal(parseGitHubUrl("https://github.com/a/b/issues"), null);
  assert.equal(parseGitHubUrl("https://github.com/a/b/discussions/3"), null);
});
