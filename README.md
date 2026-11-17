# git-to-md

A Firefox extension that turns the **GitLab** or **GitHub** issue, merge request or pull request you are looking at into **minimal Markdown**: content, attributes and comments, nothing else. Built for pasting into an LLM without burning context on UI noise.

Works on gitlab.com, github.com, **self-managed / on-prem GitLab** and **GitHub Enterprise** on any domain, with no setup and no tokens.

```markdown
# Login fails on Safari

- Ref: acme/web#42
- State: opened
- Author: @alice
- Assignees: @bob, @carol
- Labels: bug, priority::high
- Milestone: v2.3 (due 2026-12-01)
- Due: 2026-11-30
- Weight: 3
- Created: 2026-11-01

## Description

### Steps

1. Open login
2. Submit

## Comments

**@bob** · 2026-11-02

Repro'd on 17.1

> **@carol** · 2026-11-02
>
> Same here

**@dave** · 2026-11-03 · `src/login.js:12` · resolved

Typo here
```

## What it drops

- Navigation, sidebars, buttons, avatars, emoji reactions, "edited by"
- System notes ("added ~bug label", "changed milestone"), unless you turn them on
- Issue-template HTML comments (`<!-- describe the bug -->`)
- Images (Markdown, `<img>`, `<picture>`, linked thumbnails) become `[image]` / `[image: alt text]`
- Hidden/minimized comments (spam, off-topic) on GitHub
- Empty attributes are not printed at all

The popup shows an approximate token count for every copy.

## Usage

1. Open an issue or MR/PR:
   - GitLab: `/-/issues/N`, `/-/work_items/N`, `/-/merge_requests/N`
   - GitHub: `/issues/N`, `/pull/N`
2. Click the toolbar button or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>.
3. The Markdown is copied to your clipboard. You can also save it as a `.md` file.

## How it reads the data

### GitLab

There are two sources. You pick one in the settings; the default is **Auto**.

| Mode | What happens |
| --- | --- |
| **Auto** | Ask the GitLab REST API on the same server, then read the page if that fails |
| **API only** | Same-origin REST API only |
| **Page only** | Read the open page's DOM only. No extra network requests at all. |

**API (preferred).** GitLab stores descriptions and comments as raw Markdown, so the API gives the cleanest output with nothing lost in conversion. The request goes to the **same GitLab server you have open** (`https://<your-gitlab>/api/v4/...`), using the session cookie your browser already has. It is the same kind of request GitLab's own frontend makes. No token is created or stored.

**Page (fallback).** Some on-prem setups block `/api` at a reverse proxy, or restrict what anonymous and session users can call. In that case the extension reads the issue straight from the rendered page and converts the HTML back to Markdown. GitLab's markup changes between versions, so this path tries several selectors for each field. If something is missing on your GitLab version, please open an issue with the version number.

### GitHub

GitHub is **always read from the open page, with no network requests at all**. (GitHub's API is on a different origin and does not accept your browser session, so private repos would need a token. We don't want your token.)

- **Issues:** the page embeds its data, including the raw Markdown of the body and comments. That is used directly. If you clicked "Load more" on a long issue, the rendered comments are used instead. If items are still collapsed, the popup tells you.
- **Pull requests:** title, branches and merge info come from the embedded data. Description and comments come from each comment's raw "Copy Markdown" text, falling back to converting the rendered HTML. Reviews ("approved", "changes requested") and inline review threads (with file path) are included.

## Privacy

- **No data leaves your browser** except the same-origin requests to your own GitLab server described above.
- No analytics, no telemetry, no remote code, no third-party servers.
- Permissions: `activeTab` (only the tab where you click the button, only at that moment), `scripting`, `clipboardWrite`, `storage` (your settings).
- No host permissions. The extension cannot read any site in the background.

On GitHub, nothing at all is requested; the open page is only read.

See [PRIVACY.md](PRIVACY.md).

## Development

There is no build step. The source is what ships.

```sh
npm install
npm test          # unit tests (formatter, URL parsers, HTML → Markdown, GitHub reader)
npm run lint      # web-ext lint (AMO validator)
npm start         # launch Firefox with the extension loaded
npm run build     # dist/*.zip, ready to upload to addons.mozilla.org
```

Or load it by hand: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → `manifest.json`.

```
manifest.json
src/
  lib/format.js       API-shaped data → Markdown (pure, tested)
  lib/html-to-md.js   GitLab rendered HTML → Markdown (pure, tested)
  lib/inject.js       Injected into the tab: GitLab/GitHub detection + GitLab same-origin API fetch
  lib/scrape.js       Injected into the tab: GitLab DOM fallback + normalisation
  lib/github.js       Injected into the tab: GitHub page reader + normalisation
  lib/url.js          Issue / MR / PR URL parsing (GitLab relative URL roots supported)
  popup/              Toolbar popup
  options/            Settings page
```

## License

[MIT](LICENSE)
