/*
 * Functions injected into the GitLab tab with scripting.executeScript.
 *
 * They run in the page's MAIN world so that requests go to the same origin
 * with the user's existing GitLab session cookie. No tokens are needed or
 * stored. Each function MUST be self-contained: it is serialized and has no
 * access to module scope.
 */

/** Detect GitLab and return the info needed to parse the URL. */
export function probePage() {
  const gon = window.gon && typeof window.gon === "object" ? window.gon : null;
  const markers =
    !!gon ||
    !!document.querySelector("meta[property='og:site_name'][content='GitLab'], meta[content='GitLab'][name='application-name']") ||
    (document.body?.dataset?.page || "").startsWith("projects:");
  return {
    isGitLab: markers,
    href: location.href,
    relativeRoot: gon?.relative_url_root || "",
    apiVersion: gon?.api_version || "v4",
  };
}

/**
 * Fetch the issue / MR, its discussions and (for issues) linked items.
 * @param {{relativeRoot: string, apiVersion: string, projectPath: string, kind: string, iid: number, includeLinks: boolean}} req
 */
export async function fetchItem(req) {
  const base = `${location.origin}${req.relativeRoot}/api/${req.apiVersion}`;
  const project = `${base}/projects/${encodeURIComponent(req.projectPath)}`;
  const itemUrl = `${project}/${req.kind === "merge_request" ? "merge_requests" : "issues"}/${req.iid}`;

  async function get(url) {
    const res = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!res.ok) {
      const err = new Error(`GitLab API ${res.status} for ${url.replace(base, "")}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async function getAll(url) {
    const out = [];
    let page = "1";
    while (page) {
      const sep = url.includes("?") ? "&" : "?";
      const res = await get(`${url}${sep}per_page=100&page=${page}`);
      out.push(...(await res.json()));
      page = res.headers.get("x-next-page");
      if (out.length > 5000) break; // safety net
    }
    return out;
  }

  try {
    const [item, discussions, links] = await Promise.all([
      get(itemUrl).then((r) => r.json()),
      getAll(`${itemUrl}/discussions`),
      req.kind === "issue" && req.includeLinks
        ? getAll(`${itemUrl}/links`).catch(() => [])
        : Promise.resolve([]),
    ]);
    return { ok: true, item, discussions, links };
  } catch (e) {
    return { ok: false, status: e.status || 0, error: String(e.message || e) };
  }
}
