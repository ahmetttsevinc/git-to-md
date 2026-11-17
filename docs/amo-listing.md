# addons.mozilla.org submission notes

**Name:** git.to.md: Issue to Markdown (GitLab/GitHub) (max 45 chars)
**Summary (≤250):** Copy the GitLab or GitHub issue / pull request you are viewing as clean, minimal Markdown: content, attributes and comments only. Made for pasting into LLMs. Works with self-hosted GitLab and GitHub Enterprise.
**Categories:** Developer Tools
**License:** MIT
**Privacy policy:** paste PRIVACY.md
**Source code submission:** not required. There is no build, bundling or minification, so the package is the source.

## Notes to reviewer

- No host permissions. `activeTab` + `scripting` inject into the active tab only after the user clicks the button.
- `src/lib/inject.js` runs in the MAIN world so its `fetch` goes to the tab's own origin (the user's GitLab server) with the existing session cookie. It only sends GET requests to `/api/v4/projects/<project>/(issues|merge_requests)/<iid>[/discussions|/links]`.
- `src/lib/scrape.js` (GitLab fallback) and `src/lib/github.js` (`scrapeGitHub`) run in the isolated world and only read the DOM. On GitHub no network request is made at all.
- HTML fragments returned by the scraper are parsed in the popup with `DOMParser` (inert) and converted to text. Nothing is inserted into the DOM via innerHTML.
- No remote code, no analytics.

## Test instructions

1. Open any public issue, e.g. https://gitlab.com/gitlab-org/gitlab/-/issues/1 (sign in for comments: gitlab.com requires auth for the discussions API, and the extension falls back to page scraping otherwise).
2. Click the toolbar button. The Markdown appears in the popup and is copied to the clipboard.
3. Same on GitHub, e.g. https://github.com/microsoft/vscode/issues/348715 or any pull request.
