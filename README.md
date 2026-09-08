# SpinDownGames

The first temporary SpinDownGames website: a single static page with a 50/50 purple and black desktop layout that stacks on mobile.

## Files

- `index.html` — semantic page content and navigation for Home, Cards, Events, Teams, and Contact.
- `styles.css` — branding, layout, and responsive styles.
- `.nojekyll` — lets GitHub Pages serve the static files directly.

No JavaScript, dependencies, build step, or backend is required. All links point to sections on the same page. Unavailable business details are marked as coming soon.

## Preview locally

Open `index.html` directly in a browser, or run this command from the repository directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then visit <http://localhost:8000>.

## Deployment

The site is intended for GitHub Pages at <https://cipherlogsplus.github.io/SpinDownGames/>.

In the repository's **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save. Updates pushed to `main` are published automatically. The page can also be served by any static web host; use the repository root as the publish directory with no build command.

## Make changes

Edit section content in `index.html`. Keep the existing section IDs (`home`, `cards`, `events`, `teams`, and `contact`) in sync with navigation links. Adjust the brand colors and spacing in the variables at the top of `styles.css`. Mobile styles are grouped at the bottom of that file.

Before publishing a change, check a desktop and a narrow mobile viewport, click each navigation link and the back-to-top link, and confirm keyboard focus is visible. Add business information only when it has been supplied or confirmed by the owner.
