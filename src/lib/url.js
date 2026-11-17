/**
 * Parse a GitLab issue / merge request URL.
 *
 * Supported shapes (with optional relative URL root, e.g. /gitlab):
 *   /group/sub/project/-/issues/123
 *   /group/sub/project/-/work_items/123
 *   /group/sub/project/-/merge_requests/123
 *
 * Returns null when the URL is not a supported page.
 *
 * @param {string} href
 * @param {string} [relativeRoot] GitLab relative URL root ("" or "/gitlab")
 * @returns {{origin: string, projectPath: string, kind: "issue"|"merge_request", iid: number} | null}
 */
export function parseGitLabUrl(href, relativeRoot = "") {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  let path = decodeURIComponent(url.pathname);
  const root = (relativeRoot || "").replace(/\/+$/, "");
  if (root && path.startsWith(root + "/")) path = path.slice(root.length);

  const m = path.match(/^\/(.+?)\/-\/(issues|work_items|merge_requests)\/(\d+)(?:[/?#]|$)/);
  if (!m) return null;

  const [, projectPath, segment, iid] = m;
  // Group-level work items (epics) live under /groups/...; not supported.
  if (projectPath.startsWith("groups/")) return null;

  return {
    origin: url.origin,
    projectPath,
    kind: segment === "merge_requests" ? "merge_request" : "issue",
    iid: Number(iid),
  };
}
