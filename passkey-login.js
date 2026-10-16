import { SYNC_KEYS } from "./vault-sync.js";

// A UX hint only. Every login still requires a fresh, server-verified assertion.
export const AUTO_LOGIN_KEY = "carwash_passkey_auto_login_v1";

export function createPasskeyLogin({ storage, api, authenticate, connect,
  publicKeyCredential = globalThis.PublicKeyCredential, credentials = globalThis.navigator?.credentials,
}) {
  let attempted = false;
  const read = key => { try { return storage.getItem(key); } catch { return null; } };
  const write = value => { try { storage.setItem(AUTO_LOGIN_KEY, value); } catch { /* Optional hint. */ } };
  const remember = () => write("enabled");

  async function login(immediate = false) {
    const { options } = await api("/login/options", "POST", {});
    let credential;
    if (immediate) {
      const result = await credentials.get({
        publicKey: publicKeyCredential.parseRequestOptionsFromJSON(options), uiMode: "immediate",
      });
      if (!result) return;
      credential = result.toJSON();
    } else credential = await authenticate({ optionsJSON: options });
    const result = await api("/login/verify", "POST", credential);
    remember();
    await connect(result.vaultId);
  }

  return {
    remember,
    pause() { attempted = true; write("paused"); },
    manual: () => login(),
    async automatic() {
      if (attempted) return;
      attempted = true;
      const preference = read(AUTO_LOGIN_KEY);
      if (preference === "paused") return;
      // Prefer immediate mode: it does not show a QR/security-key prompt when no passkey exists.
      let immediate = false;
      try {
        immediate = !!publicKeyCredential?.parseRequestOptionsFromJSON &&
          (await publicKeyCredential?.getClientCapabilities?.())?.immediateGet === true;
      } catch { /* Older browsers can use a successful-login hint instead. */ }
      if (immediate) await login(true);
      else if (preference === "enabled" || read(SYNC_KEYS.owner)) await login();
    },
  };
}
