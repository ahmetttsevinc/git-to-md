import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { htmlToMarkdown } from "../src/lib/html-to-md.js";

const md = (html) => {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return htmlToMarkdown(document.body);
};

test("GitLab rendered markdown", () => {
  const html = `
    <h2 data-sourcepos="1:1"><a class="anchor" href="#steps" aria-hidden="true"></a>Steps</h2>
    <p>Hi <a class="gfm gfm-project_member" href="/bob" data-user="2">@bob</a>, see <a class="gfm gfm-issue" href="/a/b/-/issues/7">#7</a>
    and <a href="https://example.com/docs">the docs</a> <gl-emoji data-name="thumbsup">👍</gl-emoji></p>
    <ul class="task-list">
      <li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked disabled> done <strong>bold</strong></li>
      <li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> todo
        <ul><li>nested <code>x()</code></li></ul>
      </li>
    </ul>
    <div class="gl-relative markdown-code-block">
      <pre class="code highlight js-syntax-highlight language-javascript" lang="javascript" data-canonical-lang="js"><code><span class="line">const a = 1;</span>
<span class="line">a++;</span></code></pre>
      <copy-code><button>Copy</button></copy-code>
    </div>
    <blockquote><p>quoted</p></blockquote>
    <table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2 | 3</td></tr></tbody></table>
    <p><a class="no-attachment-icon" href="/uploads/x/s.png"><img alt="shot" data-src="/uploads/x/s.png" src="data:image/gif;base64,R0"></a></p>`;

  assert.equal(
    md(html),
    `## Steps

Hi @bob, see #7 and [the docs](https://example.com/docs) 👍

- [x] done **bold**
- [ ] todo
  - nested \`x()\`

\`\`\`js
const a = 1;
a++;
\`\`\`

> quoted

| A | B |
| --- | --- |
| 1 | 2 \\| 3 |

![shot](/uploads/x/s.png)`,
  );
});
