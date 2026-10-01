/**
 * Public configuration only. An empty project keeps accounts safely disabled.
 * Set these two values only after deploying the Spinarium database policies.
 * A publishable key (or legacy anon key) is public; service-role/secret keys
 * must never be put here, in GitHub Pages, or anywhere else in browser code.
 */
export const spinariumConfig = Object.freeze({
  // Temporary UI preview. This is not authentication or access protection.
  previewEnabled: true,
  supabaseUrl: "",
  supabasePublishableKey: "",
});
