# Privacy Policy

_Last updated: 2026-11-17_

git.to.md does not collect, store, or send any personal data or any content of your GitLab instance to the developers or to any third party.

## What the extension does

When you click the toolbar button on a GitLab issue or merge request page, the extension:

1. Runs a script in **that tab only** (granted by Firefox's `activeTab` permission at the moment of the click).
2. Depending on your settings, it either:
   - sends `GET` requests to the **same GitLab server that is already open in the tab** (`/api/v4/projects/.../issues/...`) using your existing browser session, or
   - reads the issue from the page that is already loaded, without any network requests.
3. Converts the result to Markdown and shows it in the popup. It copies the Markdown to your clipboard if you leave that setting on.

## What is stored

Only your settings (checkbox choices), in Firefox's `storage.sync`. If you use Firefox Sync, Firefox may sync them across your devices. No issue content is ever stored.

## What is not done

- No analytics, telemetry, crash reporting, or tracking
- No requests to any server other than the GitLab server you are viewing
- No remote code; all code ships in the extension package
- No access to any tab or site until you click the button

## Contact

Open an issue in the project's GitHub repository.
