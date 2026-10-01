/** Presentation controller: row timing follows the actual responsive layout. */
export function createDashboardReveal(root) {
  const selectors = ".topbar, .sidebar, .hero, #collection-notice, #stats, .collection-panel, .collection-toolbar, #collection-grid > *, #collection-status, #detail-panel, #dashboard-footer, .page-footer";
  let animations = [];
  function reset() {
    root.classList.remove("intro-staging");
    animations.forEach(animation => animation.cancel());
    animations = [];
  }
  return {
    prepare() { root.classList.add("intro-staging"); },
    reveal() {
      const nodes = [...root.querySelectorAll(selectors)].filter(node => node.getClientRects().length);
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) { reset(); return; }
      const rows = [];
      const entries = nodes.map(node => ({ node, top: node.getBoundingClientRect().top })).sort((a,b) => a.top - b.top);
      for (const { node, top } of entries) {
        if (typeof node.animate !== "function") continue;
        let row = rows.findIndex(y => Math.abs(y - top) < 30);
        if (row < 0) { row = rows.length; rows.push(top); }
        const animation = node.animate(
          [{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 650, delay: row * 200, easing: "ease-out", fill: "both" },
        );
        animations.push(animation);
        animation.finished.then(() => { animation.cancel(); animations = animations.filter(item => item !== animation); }).catch(() => {});
      }
      root.classList.remove("intro-staging");
    },
    reset,
  };
}
