import assert from "node:assert/strict";
import { veilingArtwork, MYSTERY_VEILING_ARTWORK } from "../spinarium/components/veiling-artwork.js";

const images = [];
globalThis.document = { createElement(tag) {
  assert.equal(tag, "img");
  const handlers = new Map();
  const img = {
    dataset: {}, className: "", src: "", alt: "", loading: "", decoding: "",
    addEventListener(type, fn) { handlers.set(type, fn); },
    dispatch(type) { handlers.get(type)?.(); },
  };
  images.push(img);
  return img;
} };

assert.match(MYSTERY_VEILING_ARTWORK, /\/assets\/spinarium\/mystery-veiling\.svg$/);
const noArt = veilingArtwork(null, "Ashenling", "card-artwork");
assert.equal(noArt.src, MYSTERY_VEILING_ARTWORK);
assert.equal(noArt.className, "card-artwork");
assert.match(noArt.alt, /not yet available for Ashenling/);
const another = veilingArtwork("", "Another Veiling");
assert.equal(another.src, noArt.src, "All missing art shares exactly one fallback");
const real = veilingArtwork("/api/artwork/some-image", "Ashenling", "", true);
assert.equal(real.src, "/api/artwork/some-image");
assert.equal(real.loading, "eager");
real.dispatch("error");
assert.equal(real.src, MYSTERY_VEILING_ARTWORK);
assert.equal(real.dataset.artworkPlaceholder, "true");
real.dispatch("error");
assert.equal(real.src, MYSTERY_VEILING_ARTWORK, "Failed fallback must not loop");
assert.equal(images.length, 3);
console.log("Universal Veiling artwork placeholder checks passed.");
