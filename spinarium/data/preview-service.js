/** Static preview only: no provider identity, network calls, or ownership writes. */
export function createPreviewAccess() {
  let session = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener(session));
  const auth = {
    configured: true,
    getSession: () => session,
    getAccessToken: () => null,
    onAuthStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async consumeAuthCallback() { return { handled: false }; },
    async signIn({ email, password }) {
      if (email.trim() !== "admin" || password !== "1234")
        throw new Error("Use the preview username and password.");
      session = { user: { id: "static-preview", email: "admin · Preview" }, flow: "preview" };
      notify();
    },
    async signOut() { session = null; notify(); },
  };
  const service = {
    getCapabilities: () => ({ authentication: false, claims: false, transfers: false, notifications: false, threeDimensionalView: false }),
    async getAdminAccess() { return false; },
    async getDashboard() {
      if (!session) throw new Error("Open the preview first.");
      return {
        schemaVersion: "1", mode: "preview",
        profile: { id: "static-preview", displayName: "Preview", memberSince: new Date().toISOString(), avatarSrc: null },
        veilings: [], series: [], editions: [], variants: [], rarities: [],
        physicalCards: [], ownerships: [], discoveries: [], achievements: [],
        userAchievements: [], collections: [], news: [], events: [],
      };
    },
  };
  return { auth, service };
}
