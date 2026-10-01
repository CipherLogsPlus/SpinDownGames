const paths = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  cube: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5m-9 5v9m-5-17 10 5"/>',
  cards:
    '<rect x="6" y="5" width="13" height="16" rx="1"/><path d="M3 17V3h12M10 9h5m-5 4h5"/>',
  trophy:
    '<path d="M7 3h10v5c0 8-10 8-10 0V3Zm0 2H3v3c0 4 4 4 5 4m9-7h4v3c0 4-4 4-5 4m-4 3v5m-4 1h8"/>',
  discovery:
    '<rect x="4" y="5" width="16" height="16" rx="1"/><path d="M9 3v4m6-4v4m-8 8 3 3 7-8"/>',
  transfer: '<path d="M3 7h17m-5-5 5 5-5 5M21 17H4m5-5-5 5 5 5"/>',
  settings:
    '<path d="m9 3 1-2h4l1 2 3 2 3 1v4l-2 2 2 2v4l-3 1-3 2-1 2h-4l-1-2-3-2-3-1v-4l2-2-2-2V6l3-1Z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4l-2 4Zm5 3h4M12 2v2"/>',
  menu: '<path d="M3 5h18M3 12h18M3 19h18"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-4-4 3-3m-6 0 3-3"/>',
  check: '<path d="m4 12 5 5L21 5"/>',
  arrow: '<path d="M3 12h18m-6-6 6 6-6 6"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"/>',
};

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = paths[name] || paths.spark; // Only developer-defined SVG markup.
  return svg;
}

export function hydrateIcons(root = document) {
  root
    .querySelectorAll("[data-icon]")
    .forEach((node) => node.replaceChildren(icon(node.dataset.icon)));
}
