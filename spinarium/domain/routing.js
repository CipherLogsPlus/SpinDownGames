const filters = new Set(["all", "owned", "discovered", "unowned", "undiscovered"]);
export function parseRoute(hash, signedIn = false) {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const name = path || (signedIn ? "dashboard" : "signin");
  const requestedFilter = new URLSearchParams(query).get("filter");
  return {
    name,
    filter: filters.has(requestedFilter) ? requestedFilter : name === "explore" ? "discovered" : "owned",
  };
}
