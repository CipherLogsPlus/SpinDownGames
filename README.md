# SpinDownGames — sideways-spinning 3D coin

This is the public, static SpinDownGames website from the supplied ZIP, with the supplied coin added above the homepage heading. The existing purple/black layout, Home/Cards/Events/Teams/Contact sections, and Instagram link are retained. This has no connection to InvoHub, Supabase, authentication, or any inventory database.

## Replacing the earlier coin version

The rotation fix is in `coin-viewer.js`. Replace the earlier file of that name in the repository root, beside `index.html`. The updated `index.html` also adds a cache-busting version to the script URL so visitors get the corrected rotation. The `styles.css`, GLB, and poster are unchanged; upload the complete package only when installing the coin for the first time.

## What is included

- `index.html` — existing page plus coin viewer markup.
- `styles.css` — existing styles plus responsive coin styles.
- `coin-viewer.js` — dependency-free WebGL rendering, rotation, mouse/touch/keyboard controls, and loading/failure handling.
- `assets/coin.glb` — optimized derivative of the supplied `coin 6.stl`.
- `assets/coin-poster.webp` — still image of the same model for loading, unavailable WebGL, or disabled JavaScript.
- `.nojekyll` — retained for GitHub Pages.
- `.gitignore` — prevents accidental commits of the large print master.
- `VERIFICATION.md` — implementation and local test notes.

There is no npm install, build command, external CDN, third-party tracking, or paid 3D service. All code, geometry, and the poster are served by the website itself.

## Review before publishing

The separately supplied `SpinDownGames-Sideways-Preview.html` is a self-contained interactive preview. Download it and open it in a browser with JavaScript/WebGL enabled; it does not require a local server. It is not a live hosted URL and does not publish anything. Do not use the preview file instead of the normal website files.

For this normal multi-file website, use a local server rather than double-clicking `index.html`:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Visit `http://localhost:8000`. Opening the normal `index.html` directly as a file may show only the still image because browsers restrict file-to-file model fetches.

## Publish to the existing public site

Back up the current public repo first. Extract the supplied ZIP. Upload the **extracted files and the assets folder** into the root of the public `SpinDownGames` repository, preserving `assets/` as a folder. The files are directly at the ZIP root. Do not upload the ZIP itself or nest an extra wrapper folder inside the repo.

At minimum, replace `index.html` and `styles.css`; add `coin-viewer.js`, `assets/coin.glb`, and `assets/coin-poster.webp`. Retain the existing `.nojekyll`. The README, verification notes, and `.gitignore` may also be included.

Use the site's existing GitHub Pages publishing branch/configuration. No hosting settings need to be changed for this addition. After its deployment completes, refresh the public site and verify the coin, navigation, and Instagram link. Do not upload these files to InvoHub.

Do not upload the original 126 MB STL. Keep it privately as the print/edit master. This package contains only the simplified display derivative.

## Display behavior

The coin automatically rotates once every 20 seconds unless the visitor requests reduced motion. It turns sideways around the vertical Y axis, showing the front, edge, then back, rather than flipping end over end; the source design itself is not redrawn. Drag horizontally to turn it; a mouse can also tilt it vertically. Vertical touch gestures remain available to scroll the page.

The visible button pauses or starts rotation. With the canvas focused, arrow keys turn it, Home resets the view, and Space toggles rotation. Changing tabs or scrolling the coin out of view pauses automatic rendering. Device-pixel ratio is capped at 1.5 and animation targets at most 30 frames per second to limit the rendering workload. Actual performance depends on the device.

The supplied STL has geometry but no color attributes. **Silver is a presentation choice**, not a color specified by the source file. Finish/lighting are defined in the fragment shader in `coin-viewer.js`. Adjust `FULL_TURN_SECONDS` to change rotation speed. The original geometry is preserved separately; this simplified GLB is intended for website viewing, not manufacturing.

## Model size

| | Original STL | Website GLB |
|---|---:|---:|
| Bytes | 126,196,134 | 3,688,160 |
| Approximate decimal MB | 126.20 | 3.69 |
| Triangles | 2,523,921 | 119,999 |

The geometry was reduced using VTK quadric decimation, then centered, oriented, and exported with weighted surface normals. The GLB is approximately 97.1% smaller. Small surface details can differ from the high-resolution print master after simplification.

The custom loader intentionally supports the one uncompressed indexed mesh in this GLB. It is not a general-purpose glTF scene/animation/texture loader. For more elaborate future models, replace the viewer with a general glTF renderer instead of assuming every GLB will load here.

Because this is a public 3D display, the website's optimized GLB is publicly downloadable by visitors. The source STL is not included or exposed.
