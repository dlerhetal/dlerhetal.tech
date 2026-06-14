/* Proctor storage layer.
 *
 * This is the SEAM for future Google-OAuth multi-user sync. Today everything
 * persists to localStorage under a single anonymous local profile. To go
 * multi-user later, implement the same async interface against a backend
 * (e.g. a /api/state endpoint authorized by a Google ID token) and swap the
 * provider in Storage.use(). The rest of the app only talks to this interface,
 * so nothing else has to change.
 *
 * Interface (all async to stay backend-ready):
 *   await Storage.load()        -> full state object
 *   await Storage.save(state)   -> persists full state
 *   Storage.identity()          -> { mode, name } (anon today, google later)
 */
const Storage = (() => {
  const KEY = 'proctor.state.v1';

  const LocalProvider = {
    async load() {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.warn('Proctor: state load failed, starting fresh.', e);
        return null;
      }
    },
    async save(state) {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        return true;
      } catch (e) {
        console.warn('Proctor: state save failed.', e);
        return false;
      }
    }
  };

  // Placeholder for the future authenticated provider. Kept here as the
  // documented swap target so the OAuth upgrade is a known, contained change.
  // const RemoteProvider = { async load(){...}, async save(state){...} };

  let provider = LocalProvider;
  let identity = { mode: 'anon', name: 'Local profile' };

  return {
    use(p) { provider = p; },
    identity() { return identity; },
    setIdentity(id) { identity = id; },
    load() { return provider.load(); },
    save(state) { return provider.save(state); },
    exportJSON() { return localStorage.getItem(KEY) || '{}'; },
    importJSON(json) {
      try { JSON.parse(json); localStorage.setItem(KEY, json); return true; }
      catch (e) { return false; }
    }
  };
})();
