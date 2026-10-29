/** Shared, strictly visual fallback. Never treat this silhouette as uploaded character artwork. */
export const MYSTERY_VEILING_ARTWORK = new URL("../../assets/spinarium/mystery-veiling.svg", import.meta.url).href;

/** A real image automatically replaces the silhouette whenever artwork is supplied. */
export function veilingArtwork(src, name = "this Veiling", className = "", eager = false) {
  const img = document.createElement("img");
  img.className = className;
  img.width = 768;
  img.height = 1024;
  img.loading = eager ? "eager" : "lazy";
  img.decoding = "async";
  const fallback = () => {
    img.src = MYSTERY_VEILING_ARTWORK;
    img.alt = "Shadowy placeholder — artwork not yet available for " + name;
    img.dataset.artworkPlaceholder = "true";
  };
  if (src) {
    img.src = src;
    img.alt = "Artwork for " + name;
    // A broken uploaded image also falls back. A failed placeholder cannot loop.
    img.addEventListener("error", () => { if (!img.dataset.artworkPlaceholder) fallback(); }, { once: true });
  } else {
    fallback();
  }
  return img;
}
