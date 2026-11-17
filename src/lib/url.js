/**
 * @typedef {{platform: "gitlab"|"github", origin: string, projectPath: string, kind: "issue"|"merge_request", iid: number}} Target
 */

/**
 * Parse a GitLab issue / merge request URL.
 *
 * Supported shapes (with optional relative URL root, e.g. /gitlab):
 *   /group/sub/project/-/issues/123
 *   /group/sub/project/-/work_items/123
 *   /group/sub/project/-/merge_requests/123
 *
 * @param {string} href
 * @param {string} [relativeRoot] GitLab relative URL root ("" or "/gitlab")
 * @returns {Target | null}
 */
export function parseGitLabUrl(href, relativeRoot = "") {
  const url = toUrl(href);
  if (!url) return null;

  let path = decodeURIComponent(url.pathname);
  const root = (relativeRoot || "").replace(/\/+$/, "");
  if (root && path.startsWith(root + "/")) path = path.slice(root.length);

  const m = path.match(/^\/(.+?)\/-\/(issues|work_items|merge_requests)\/(\d+)(?:[/?#]|$)/);
  if (!m) return null;

  const [, projectPath, segment, iid] = m;
  // Group-level work items (epics) live under /groups/...; not supported.
  if (projectPath.startsWith("groups/")) return null;

  return {
    platform: "gitlab",
    origin: url.origin,
    projectPath,
    kind: segment === "merge_requests" ? "merge_request" : "issue",
    iid: Number(iid),
  };
}

/**
 * Parse a GitHub / GitHub Enterprise issue or pull request URL.
 *   /owner/repo/issues/123
 *   /owner/repo/pull/123[/files|/commits|...]
 *
 * @param {string} href
 * @returns {Target | null}
 */
export function parseGitHubUrl(href) {
  const url = toUrl(href);
  if (!url) return null;
  const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)(?:[/?#]|$)/);
  if (!m) return null;
  const [, owner, repo, segment, iid] = m;
  return {
    platform: "github",
    origin: url.origin,
    projectPath: `${owner}/${repo}`,
    kind: segment === "pull" ? "merge_request" : "issue",
    iid: Number(iid),
  };
}

function toUrl(href) {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
