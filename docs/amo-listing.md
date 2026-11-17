# addons.mozilla.org submission notes

**Name:** git.to.md — GitLab Issue to Markdown
**Summary (≤250):** Copy the GitLab issue or merge request you are viewing as clean, minimal Markdown (content, attributes and comments only). Made for pasting into LLMs. Works with self-hosted GitLab.
**Categories:** Developer Tools
**License:** MIT
**Privacy policy:** paste PRIVACY.md
**Source code submission:** not required. There is no build, bundling or minification, so the package is the source.

## Notes to reviewer

- No host permissions. `activeTab` + `scripting` inject into the active tab only after the user clicks the button.
- `src/lib/inject.js` runs in the MAIN world so its `fetch` goes to the tab's own origin (the user's GitLab server) with the existing session cookie. It only sends GET requests to `/api/v4/projects/<project>/(issues|merge_requests)/<iid>[/discussions|/links]`.
- `src/lib/scrape.js` runs in the isolated world and reads DOM only.
- HTML fragments returned by the scraper are parsed in the popup with `DOMParser` (inert) and converted to text. Nothing is inserted into the DOM via innerHTML.
- No remote code, no analytics.

## Test instructions

1. Open any public issue, e.g. https://gitlab.com/gitlab-org/gitlab/-/issues/1 (sign in for comments: gitlab.com requires auth for the discussions API, and the extension falls back to page scraping otherwise).
2. Click the toolbar button. The Markdown appears in the popup and is copied to the clipboard.
