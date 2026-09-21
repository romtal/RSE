/*
 * Polyfill de window.claude.use("db"/"downloads") pour le déploiement Vercel
 * autonome (hors environnement Artifact claude.ai).
 *
 * - "db"        -> httpDb : mêmes méthodes que la capacité `db` des Artifacts
 *                  (doc/collection, get/set/update/delete, onSnapshot, add,
 *                  orderBy), mais adossées à /api/db/[...path].js + Postgres
 *                  au lieu du store en mémoire propriétaire de claude.ai.
 *                  onSnapshot n'a pas d'équivalent websocket ici : il est
 *                  simulé par un polling léger (toutes les 4s) qui ne
 *                  déclenche le callback que si les données ont changé.
 * - "downloads" -> déclenche un vrai téléchargement navigateur (Blob + <a
 *                  download>), possible ici car cette page n'est pas
 *                  exécutée dans le bac à sable Artifact qui neutralise les
 *                  liens de téléchargement.
 *
 * app.js n'est PAS modifié : il continue d'appeler window.claude.use(...)
 * exactement comme sur claude.ai.
 */
(function () {
  const API_BASE = "/api/db/";
  const POLL_MS = 4000;

  async function apiFetch(path, opts) {
    const res = await fetch(API_BASE + path.split("/").map(encodeURIComponent).join("/"), Object.assign(
      { headers: { "Content-Type": "application/json" } },
      opts
    ));
    let body = null;
    try { body = await res.json(); } catch (e) { /* réponse vide (ex: 204) */ }
    if (!res.ok) {
      throw new Error((body && body.error) || `Erreur HTTP ${res.status}`);
    }
    return body;
  }

  function lastSegment(path) {
    const parts = path.split("/");
    return parts[parts.length - 1];
  }

  function docRef(path) {
    return {
      id: lastSegment(path),
      path,
      get: async () => {
        const r = await apiFetch(path, { method: "GET" });
        return { id: lastSegment(path), exists: !!r.exists, data: () => (r.exists ? r.data : undefined) };
      },
      set: async (data) => { await apiFetch(path, { method: "PUT", body: JSON.stringify(data) }); },
      update: async (data) => { await apiFetch(path, { method: "PATCH", body: JSON.stringify(data) }); },
      delete: async () => { await apiFetch(path, { method: "DELETE" }); },
      onSnapshot: (next, error) => {
        let stopped = false;
        let lastSerialized = null;
        const tick = async () => {
          if (stopped) return;
          try {
            const r = await apiFetch(path, { method: "GET" });
            const serialized = JSON.stringify(r);
            if (serialized !== lastSerialized) {
              lastSerialized = serialized;
              next({ id: lastSegment(path), exists: !!r.exists, data: () => (r.exists ? r.data : undefined) });
            }
          } catch (e) {
            if (error) error(e);
          }
        };
        tick();
        const interval = setInterval(tick, POLL_MS);
        return () => { stopped = true; clearInterval(interval); };
      },
      collection: (sub) => colRef(path + "/" + sub),
    };
  }

  function colRef(path) {
    const orderState = { field: null, dir: "asc" };
    const api = {
      path,
      doc: (id) => docRef(path + "/" + (id || Math.random().toString(36).slice(2))),
      add: async (data) => {
        const r = await apiFetch(path, { method: "POST", body: JSON.stringify(data) });
        return docRef(path + "/" + r.id);
      },
      where: () => api, // filtres non supportés côté serveur ; app.js filtre déjà côté client
      orderBy: (field, dir) => { orderState.field = field; orderState.dir = dir || "asc"; return api; },
      limit: () => api, // pas de pagination nécessaire pour les volumes de cet outil
      get: async () => {
        const r = await apiFetch(path, { method: "GET" });
        const docs = sortDocs(r.docs || [], orderState);
        return { docs, size: docs.length, empty: docs.length === 0, docChanges: () => [] };
      },
      onSnapshot: (next, error) => {
        let stopped = false;
        let lastSerialized = null;
        const tick = async () => {
          if (stopped) return;
          try {
            const r = await apiFetch(path, { method: "GET" });
            const docs = sortDocs(r.docs || [], orderState);
            const serialized = JSON.stringify(docs.map((d) => [d.id, d._raw]));
            if (serialized !== lastSerialized) {
              lastSerialized = serialized;
              next({ docs, size: docs.length, empty: docs.length === 0, docChanges: () => [] });
            }
          } catch (e) {
            if (error) error(e);
          }
        };
        tick();
        const interval = setInterval(tick, POLL_MS);
        return () => { stopped = true; clearInterval(interval); };
      },
    };
    return api;
  }

  function sortDocs(rawDocs, orderState) {
    const docs = rawDocs.map((d) => ({ id: d.id, exists: true, data: () => d.data, _raw: d.data }));
    if (orderState.field) {
      docs.sort((a, b) => {
        const av = a._raw ? a._raw[orderState.field] : undefined;
        const bv = b._raw ? b._raw[orderState.field] : undefined;
        if (av === bv) return 0;
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        const cmp = av < bv ? -1 : 1;
        return orderState.dir === "desc" ? -cmp : cmp;
      });
    } else {
      docs.sort((a, b) => a.id.localeCompare(b.id));
    }
    return docs;
  }

  const httpDb = { doc: docRef, collection: colRef };

  const downloadsShim = {
    save: async ({ filename, data }) => {
      const blob = data instanceof Blob ? data : new Blob([data], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "export.html";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { status: "saved" };
    },
  };

  window.claude = {
    use: async (name) => {
      if (name === "db") return httpDb;
      if (name === "downloads") return downloadsShim;
      return null;
    },
  };
})();
