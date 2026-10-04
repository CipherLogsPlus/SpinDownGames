const filters = new Set(["all", "owned", "discovered", "unowned", "undiscovered"]);
export function parseRoute(hash, signedIn = false) {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const ownershipRoute = path === "ownership" || path.startsWith("ownership/");
  const showcaseRoute = path === "showcase" || path.startsWith("showcase/");
  const name = ownershipRoute ? "ownership" : showcaseRoute ? "showcase" : path || (signedIn ? "dashboard" : "signin");
  const requestedFilter = new URLSearchParams(query).get("filter");
  return {
    name,
    ...(ownershipRoute ? { ownershipId: path.slice("ownership/".length) } : {}),
    ...(showcaseRoute ? { veilingId: path.slice("showcase/".length) } : {}),
    filter: filters.has(requestedFilter) ? requestedFilter : name === "explore" ? "discovered" : "owned",
  };
}
