/**
 * Public switches only. Keep preview enabled until the replacement hosting,
 * authentication and Worker permissions have been verified on the hosted site.
 * The Cloudflare API uses same-origin HttpOnly cookies, never browser keys.
 */
export const spinariumConfig = Object.freeze({
  // Temporary UI preview. This is not authentication or access protection.
  previewEnabled: true,
  backend: "cloudflare",
  authProvider: "password",
  // Enable only after hosted signup, login and session checks pass.
  signupEnabled: false,
  // Set to "/api" only after hosted verification. Empty means fail closed.
  apiBase: "",
  // Retired groundwork; the application never selects Supabase adapters.
  supabaseUrl: "",
  supabasePublishableKey: "",
});
