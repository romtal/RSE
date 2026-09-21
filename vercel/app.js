/* =========================================================================
   Mesure Écoconception — logique applicative
   RGESN 2024 (78 critères, 9 thématiques) — voir criteria-data.js
   ========================================================================= */

(function () {
  "use strict";

  /* ---------------------------------------------------------------------
   * Constantes & helpers génériques
   * ------------------------------------------------------------------- */
  const THEMES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const THEME_LABELS = {};
  RGESN_CRITERIA.forEach((c) => { THEME_LABELS[c.themeNum] = c.theme; });

  const PRIORITE_LABEL = { prioritaire: "Prioritaire", recommande: "Recommandé", modere: "Modéré" };
  const STATUT_LABEL = { a_evaluer: "À évaluer", valide: "Validé", non_valide: "Non validé", na: "N/A" };
  const STATUT_OPTIONS = ["a_evaluer", "valide", "non_valide", "na"];

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    if (s === undefined || s === null) return "";
    return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }
  function nl2br(s) { return esc(s).replace(/\n/g, "<br>"); }
  function todayIso() { return new Date().toISOString().slice(0, 10); }
  function fmtDateFr(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  function fmtPct(x) { return x === null || x === undefined || isNaN(x) ? "—" : Math.round(x) + "%"; }
  function fmtNum(x, digits) {
    if (x === null || x === undefined || isNaN(x)) return "—";
    return Number(x).toLocaleString("fr-FR", { maximumFractionDigits: digits === undefined ? 2 : digits });
  }
  function daysBetween(iso) {
    if (!iso) return null;
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return null;
    return Math.round((d - new Date(new Date().toDateString())) / 86400000);
  }
  function uidLike() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function scoreColorClass(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return "na";
    if (pct >= 75) return "good";
    if (pct >= 40) return "warn";
    return "bad";
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._h);
    toast._h = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function copyText(str) {
    const done = () => toast("Copié dans le presse-papiers");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(done).catch(() => fallbackCopy(str, done));
    } else {
      fallbackCopy(str, done);
    }
  }
  function fallbackCopy(str, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = str;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) done();
      else toast("Impossible de copier automatiquement — sélectionnez le texte manuellement");
    } catch (e) {
      toast("Impossible de copier automatiquement — sélectionnez le texte manuellement");
    }
  }

  function ringSvg(pct, opts) {
    opts = opts || {};
    const size = opts.size || 34;
    const stroke = opts.stroke || 4;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const p = pct === null || pct === undefined || isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));
    const offset = c * (1 - p / 100);
    const cls = scoreColorClass(pct === null || pct === undefined ? null : pct);
    const colorMap = { good: "var(--accent)", warn: "var(--warn)", bad: "var(--bad)", na: "var(--na)" };
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${colorMap[cls]}" stroke-width="${stroke}"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
  }

  function modal(innerHtml, onMount) {
    const root = document.getElementById("modal-root");
    root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal">${innerHtml}</div></div>`;
    const backdrop = document.getElementById("modal-backdrop");
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
    if (onMount) onMount(root);
  }
  function closeModal() { document.getElementById("modal-root").innerHTML = ""; }

  /* ---------------------------------------------------------------------
   * État applicatif
   * ------------------------------------------------------------------- */
  const state = {
    dbCap: null,
    downloadsCap: null,
    dbReady: false,
    services: [],            // [{id, ...data}]
    currentServiceId: null,
    criteriaMap: {},         // critId -> stored state
    mesures: [],             // list, date desc
    snapshots: [],           // list, date asc
    servicesUnsub: null,
    svcUnsub: [],
  };

  const ui = {
    openThemes: new Set([1]),
    openCrit: new Set(),
    filters: { q: "", theme: "all", statut: "all", priorite: "all" },
    activeTab: "dashboard",
    pendingEvalRerender: false,
  };

  function currentService() {
    return state.services.find((s) => s.id === state.currentServiceId) || null;
  }
  function getCritState(critId) {
    return state.criteriaMap[critId] || { statut: "a_evaluer", applicabilite: "applicable" };
  }

  /* ---------------------------------------------------------------------
   * Moteur de score — formule officielle RGESN :
   * score = [ Σ(critères validés × pondération) / Σ(critères applicables × pondération) ] × 100
   * (poids : Prioritaire ×1,5 / Recommandé ×1,25 / Modéré ×1,0 ; un critère
   * marqué N/A pour ce service est exclu du numérateur ET du dénominateur)
   * ------------------------------------------------------------------- */
  function computeScores() {
    const byTheme = {};
    THEMES.forEach((t) => { byTheme[t] = { num: 0, den: 0 }; });
    let totalNum = 0, totalDen = 0;
    RGESN_CRITERIA.forEach((c) => {
      const st = getCritState(c.id);
      if (st.applicabilite === "na") return;
      byTheme[c.themeNum].den += c.poids;
      totalDen += c.poids;
      if (st.statut === "valide") {
        byTheme[c.themeNum].num += c.poids;
        totalNum += c.poids;
      }
    });
    const scoreParTheme = {};
    THEMES.forEach((t) => {
      scoreParTheme[t] = byTheme[t].den > 0 ? (byTheme[t].num / byTheme[t].den) * 100 : null;
    });
    return {
      scoreGlobal: totalDen > 0 ? (totalNum / totalDen) * 100 : null,
      scoreParTheme,
      totalNum, totalDen,
    };
  }

  function countsByStatut() {
    const c = { a_evaluer: 0, valide: 0, non_valide: 0, na: 0 };
    RGESN_CRITERIA.forEach((cr) => {
      const st = getCritState(cr.id);
      if (st.applicabilite === "na") { c.na++; return; }
      c[st.statut] = (c[st.statut] || 0) + 1;
    });
    return c;
  }

  /* ---------------------------------------------------------------------
   * Firestore-like DB helpers (wrap capability)
   * ------------------------------------------------------------------- */
  function svcDoc(id) { return state.dbCap.collection("services").doc(id); }
  function critCol(id) { return svcDoc(id).collection("criteria"); }
  function mesuresCol(id) { return svcDoc(id).collection("mesures"); }
  function snapshotsCol(id) { return svcDoc(id).collection("scoreSnapshots"); }

  function patchCriterion(critId, patch) {
    if (!state.dbCap || !state.currentServiceId) { toast("Stockage indisponible"); return; }
    const current = state.criteriaMap[critId] || {};
    const merged = Object.assign({}, current, patch, { updatedAt: new Date().toISOString() });
    state.criteriaMap[critId] = merged;
    critCol(state.currentServiceId).doc(critId).set(merged).catch((e) => toast("Erreur d'enregistrement : " + e.message));
  }

  function patchService(patch) {
    if (!state.dbCap || !state.currentServiceId) { toast("Stockage indisponible"); return; }
    const svc = currentService();
    if (svc) Object.assign(svc, patch);
    svcDoc(state.currentServiceId).set(Object.assign({}, svc, patch, { updatedAt: new Date().toISOString() }))
      .catch((e) => toast("Erreur d'enregistrement : " + e.message));
  }

  /* ---------------------------------------------------------------------
   * Boot & abonnements
   * ------------------------------------------------------------------- */
  async function boot() {
    let claude = window.claude;
    let db = null, downloads = null;
    try { db = claude && claude.use ? await claude.use("db") : null; } catch (e) { db = null; }
    try { downloads = claude && claude.use ? await claude.use("downloads") : null; } catch (e) { downloads = null; }
    state.dbCap = db;
    state.downloadsCap = downloads;

    if (!db) {
      document.getElementById("panel-dashboard").innerHTML =
        `<div class="banner warn" style="margin-bottom:16px">
          Le stockage partagé de cet artefact n'est pas disponible dans cette vue : les évaluations ne
          pourront pas être enregistrées ni partagées. Ouvrez la page publiée (pas un aperçu) pour
          utiliser l'outil normalement.
        </div>`;
      renderAllStatic();
      return;
    }
    state.dbReady = true;
    subscribeServices();
    bindGlobalUi();
  }

  function subscribeServices() {
    if (state.servicesUnsub) return; // set up exactly once
    state.servicesUnsub = state.dbCap.collection("services").onSnapshot((snap) => {
      state.services = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      state.services.sort((a, b) => (a.dateCreation || "").localeCompare(b.dateCreation || ""));
      if (state.services.length === 0) {
        seedDemoServiceIfNeeded();
        return;
      }
      renderServiceSelect();
      if (!state.currentServiceId || !state.services.find((s) => s.id === state.currentServiceId)) {
        selectService(state.services[0].id);
      } else {
        // Le service courant existe déjà (créé/renommé localement, ou par un
        // autre onglet) : on ne rappelle pas selectService (qui resouscrirait
        // inutilement critères/mesures/historique), mais currentService()
        // dépend de ce tableau — on redéclenche donc un rendu pour que le
        // tableau de bord et l'évaluation ne restent jamais bloqués sur
        // "Chargement…" en attendant un futur changement de ces sous-collections.
        onDataChanged();
      }
    }, (e) => toast("Erreur de synchronisation : " + e.message));
  }

  function renderServiceSelect() {
    const sel = document.getElementById("service-select");
    sel.innerHTML = state.services.map((s) =>
      `<option value="${esc(s.id)}">${esc(s.nom || s.id)}${s.isExample ? "  (exemple)" : ""}</option>`
    ).join("");
    if (state.currentServiceId) sel.value = state.currentServiceId;
  }

  function selectService(id) {
    if (id === state.currentServiceId && state.svcUnsub.length) return;
    state.currentServiceId = id;
    document.getElementById("service-select").value = id;
    state.svcUnsub.forEach((u) => { try { u(); } catch (e) {} });
    state.svcUnsub = [];
    state.criteriaMap = {};
    state.mesures = [];
    state.snapshots = [];
    subscribeServiceData(id);
  }

  function subscribeServiceData(id) {
    const u1 = critCol(id).onSnapshot((snap) => {
      const map = {};
      snap.docs.forEach((d) => { map[d.id] = d.data(); });
      state.criteriaMap = map;
      onDataChanged();
    }, (e) => toast("Erreur (critères) : " + e.message));

    const u2 = mesuresCol(id).orderBy("date", "desc").onSnapshot((snap) => {
      state.mesures = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      onDataChanged();
    }, (e) => toast("Erreur (mesures) : " + e.message));

    const u3 = snapshotsCol(id).orderBy("date", "asc").onSnapshot((snap) => {
      state.snapshots = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      onDataChanged();
    }, (e) => toast("Erreur (historique) : " + e.message));

    state.svcUnsub.push(u1, u2, u3);
  }

  function onDataChanged() {
    renderScorePill();
    renderDashboard();
    safeRenderEvaluation();
    renderMesure();
    renderDeclaration();
    renderMarches();
  }

  /* ---------------------------------------------------------------------
   * Seed d'un service de démonstration (premier lancement, base vide)
   * ------------------------------------------------------------------- */
  function seedDemoServiceIfNeeded() {
    if (seedDemoServiceIfNeeded._done) return;
    seedDemoServiceIfNeeded._done = true;
    const seedFlag = state.dbCap.doc("meta/seed");
    seedFlag.get().then((snap) => {
      if (snap.exists) { renderServiceSelect(); return; }
      const svcId = "demo";
      const cible = new Date(); cible.setFullYear(cible.getFullYear() + 2);
      const service = {
        nom: "Portail démarches en ligne",
        client: "Exemple pédagogique — à remplacer par un projet réel",
        dateCreation: todayIso(),
        isExample: true,
        cibleScore: 80,
        cibleDate: cible.toISOString().slice(0, 10),
        referentNom: "", referentTitre: "",
        revueFrequence: "trimestre",
        cheminsCritiques: "Parcours de dépôt d'une demande en ligne (formulaire + upload de pièces justificatives).",
      };
      const batchWrites = [svcDoc(svcId).set(service)];

      RGESN_CRITERIA.forEach((c, i) => {
        let statut = "a_evaluer", applicabilite = "applicable";
        if (c.themeNum === 9) {
          applicabilite = "na"; // service de démonstration sans composant algorithmique/IA
        } else if (c.priorite === "prioritaire") {
          statut = i % 4 === 0 ? "a_evaluer" : "valide";
        } else if (c.priorite === "recommande") {
          statut = i % 2 === 0 ? "valide" : "a_evaluer";
        } else {
          statut = i % 3 === 0 ? "valide" : (i % 3 === 1 ? "non_valide" : "a_evaluer");
        }
        const patch = { statut, applicabilite, updatedAt: new Date().toISOString() };
        if (statut === "valide") {
          patch.dateEvaluation = todayIso();
          patch.declarationNote = "";
        }
        if (statut === "non_valide") {
          patch.actions = "À qualifier avec l'équipe technique.";
          patch.quiFait = "";
          const due = new Date(); due.setDate(due.getDate() + (i % 5 === 0 ? -10 : 20));
          patch.pourQuand = due.toISOString().slice(0, 10);
          patch.difficulte = ["Faible", "Moyen", "Fort"][i % 3];
        }
        batchWrites.push(critCol(svcId).doc(c.id).set(patch));
      });

      const past = new Date(); past.setDate(past.getDate() - 60);
      batchWrites.push(mesuresCol(svcId).add({
        date: past.toISOString().slice(0, 10),
        hebergeur: "Exemple — OVHcloud (Gravelines, FR)",
        localisation: "France",
        pue: 1.3, wue: 1.1,
        renouvelablePct: 45,
        mixDocumente: "oui",
        intensiteCarbone: 56,
        intensiteSource: "Exemple — RTE éCO2mix, mix électrique France, moyenne annuelle indicative",
        energieConsommee: 1200,
        coefEnergiePrimaire: 2.3,
        empreinteFabrication: 18,
        ressourcesAbiotiques: 0.4,
        ressourcesSource: "Exemple — à établir par ACV multicritère (ADEME Base Empreinte / PEF)",
        nbUtilisateurs: 15000,
        methodologieSources: "Exemple pédagogique — remplacez ce relevé par vos mesures réelles et vos sources documentées (fournisseur d'hébergement, RTE éCO2mix, ADEME Base Empreinte…).",
        geskgco2e: (1200 * 56) / 1000 + 18,
        energiePrimaireKwh: 1200 * 2.3,
        eauBleueL: 1.1 * 1200,
        createdAt: new Date().toISOString(),
      }));

      Promise.all(batchWrites).then(() => {
        // score d'étape initial (avant les critères marqués validés ci-dessus) : ~80% du score actuel
        const scores = (function () {
          // recompute locally the same way computeScores() would, using the patches just written
          const byTheme = {}; THEMES.forEach((t) => byTheme[t] = { num: 0, den: 0 });
          let num = 0, den = 0;
          RGESN_CRITERIA.forEach((c, i) => {
            let statut = "a_evaluer", applicabilite = "applicable";
            if (c.themeNum === 9) applicabilite = "na";
            else if (c.priorite === "prioritaire") statut = i % 4 === 0 ? "a_evaluer" : "valide";
            else if (c.priorite === "recommande") statut = i % 2 === 0 ? "valide" : "a_evaluer";
            else statut = i % 3 === 0 ? "valide" : (i % 3 === 1 ? "non_valide" : "a_evaluer");
            if (applicabilite === "na") return;
            den += c.poids;
            if (statut === "valide") num += c.poids;
          });
          return den > 0 ? (num / den) * 100 : 0;
        })();
        return snapshotsCol(svcId).add({
          date: past.toISOString().slice(0, 10),
          label: "Point d'étape initial (exemple)",
          scoreGlobal: Math.round(scores * 0.78),
          scoreParTheme: {},
          createdAt: new Date().toISOString(),
        });
      }).then(() => seedFlag.set({ seededAt: new Date().toISOString() }));
    }).catch(() => {});
  }

  /* ---------------------------------------------------------------------
   * UI globale : tabs, sélecteur de service, création / paramètres
   * ------------------------------------------------------------------- */
  function bindGlobalUi() {
    document.getElementById("tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab-btn");
      if (!btn) return;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      const tab = btn.dataset.tab;
      ui.activeTab = tab;
      document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + tab));
    });

    document.getElementById("service-select").addEventListener("change", (e) => selectService(e.target.value));
    document.getElementById("btn-new-service").addEventListener("click", openNewServiceModal);
    document.getElementById("btn-service-settings").addEventListener("click", openServiceSettingsModal);

    // bound once: if a remote update was skipped while the user was typing
    // in the evaluation panel, catch up as soon as focus leaves a field.
    document.getElementById("panel-evaluation").addEventListener("focusout", () => {
      if (ui.pendingEvalRerender) setTimeout(() => { if (ui.pendingEvalRerender) renderEvaluation(); }, 30);
    });
  }

  function openNewServiceModal() {
    modal(`
      <h3>Nouveau projet évalué</h3>
      <p class="small muted">Un projet correspond à un service numérique (ou un lot de marché) que vous suivez indépendamment : ses 78 critères, ses relevés techniques et sa déclaration lui sont propres.</p>
      <div class="stack" style="margin-top:12px">
        <div class="form-field"><label>Nom du service / projet</label><input type="text" id="ns-nom" placeholder="Ex. : DGAMPA — lot Data, RUNE DILA…"></div>
        <div class="form-field"><label>Client / marché (optionnel)</label><input type="text" id="ns-client" placeholder="Ex. : DGAMPA, DILA, ADEME…"></div>
        <div class="form-field"><label>Score cible à 2 ans (%)</label><input type="number" id="ns-cible" value="80" min="0" max="100"></div>
      </div>
      <div class="actions">
        <button class="btn" id="ns-cancel">Annuler</button>
        <button class="btn btn-primary" id="ns-create">Créer le projet</button>
      </div>
    `, () => {
      document.getElementById("ns-cancel").addEventListener("click", closeModal);
      document.getElementById("ns-create").addEventListener("click", () => {
        const nom = document.getElementById("ns-nom").value.trim();
        if (!nom) { toast("Indiquez un nom de projet"); return; }
        const client = document.getElementById("ns-client").value.trim();
        const cible = Number(document.getElementById("ns-cible").value) || 80;
        const id = "svc-" + uidLike();
        const cibleDate = new Date(); cibleDate.setFullYear(cibleDate.getFullYear() + 2);
        const newService = {
          id, nom, client, dateCreation: todayIso(), isExample: false,
          cibleScore: cible, cibleDate: cibleDate.toISOString().slice(0, 10),
          referentNom: "", referentTitre: "", revueFrequence: "trimestre", cheminsCritiques: "",
        };
        svcDoc(id).set({
          nom: newService.nom, client: newService.client, dateCreation: newService.dateCreation,
          isExample: newService.isExample, cibleScore: newService.cibleScore, cibleDate: newService.cibleDate,
          referentNom: newService.referentNom, referentTitre: newService.referentTitre,
          revueFrequence: newService.revueFrequence, cheminsCritiques: newService.cheminsCritiques,
        }).then(() => {
          // On insère immédiatement le nouveau projet dans state.services au lieu
          // d'attendre le prochain sondage (jusqu'à 4s) de la collection "services" :
          // sinon selectService() bascule tout de suite currentServiceId dessus alors
          // que currentService() (qui lit state.services) ne le trouve pas encore, et
          // le tableau de bord / l'évaluation restent bloqués sur "Chargement…" tant
          // qu'aucune sous-collection (critères/mesures) ne change entre-temps.
          if (!state.services.find((s) => s.id === id)) {
            state.services.push(newService);
            state.services.sort((a, b) => (a.dateCreation || "").localeCompare(b.dateCreation || ""));
            renderServiceSelect();
          }
          closeModal(); selectService(id); toast("Projet créé");
        }).catch((e) => toast("Erreur : " + e.message));
      });
    });
  }

  function openServiceSettingsModal() {
    const svc = currentService();
    if (!svc) return;
    modal(`
      <h3>Paramètres du projet</h3>
      <div class="stack" style="margin-top:12px">
        <div class="form-field"><label>Nom du service / projet</label><input type="text" id="ss-nom" value="${esc(svc.nom || "")}"></div>
        <div class="form-field"><label>Client / marché</label><input type="text" id="ss-client" value="${esc(svc.client || "")}"></div>
        <div class="form-field"><label>Score cible (%)</label><input type="number" id="ss-cible" value="${esc(svc.cibleScore ?? 80)}" min="0" max="100"></div>
        <div class="form-field"><label>Date cible</label><input type="date" id="ss-cible-date" value="${esc(svc.cibleDate || "")}"></div>
      </div>
      <div class="actions">
        <button class="btn btn-danger" id="ss-delete">Supprimer ce projet</button>
        <button class="btn" id="ss-cancel">Fermer</button>
        <button class="btn btn-primary" id="ss-save">Enregistrer</button>
      </div>
    `, () => {
      document.getElementById("ss-cancel").addEventListener("click", closeModal);
      document.getElementById("ss-save").addEventListener("click", () => {
        patchService({
          nom: document.getElementById("ss-nom").value.trim() || svc.nom,
          client: document.getElementById("ss-client").value.trim(),
          cibleScore: Number(document.getElementById("ss-cible").value) || 0,
          cibleDate: document.getElementById("ss-cible-date").value,
        });
        closeModal(); toast("Projet mis à jour"); renderServiceSelect();
      });
      const delBtn = document.getElementById("ss-delete");
      let confirmStep = false;
      delBtn.addEventListener("click", () => {
        if (!confirmStep) { confirmStep = true; delBtn.textContent = "Confirmer la suppression ?"; return; }
        svcDoc(svc.id).delete().then(() => { closeModal(); toast("Projet supprimé"); });
      });
    });
  }

  /* ---------------------------------------------------------------------
   * Score pill (en-tête)
   * ------------------------------------------------------------------- */
  function renderScorePill() {
    const { scoreGlobal } = computeScores();
    document.getElementById("score-ring").outerHTML = ringSvg(scoreGlobal, { size: 30, stroke: 3.5 }).replace("<svg", '<svg id="score-ring"');
    document.getElementById("score-pill-val").textContent = fmtPct(scoreGlobal);
  }

  function renderAllStatic() {
    document.getElementById("panel-dashboard").innerHTML += `<div class="empty">Aucune donnée disponible sans stockage.</div>`;
  }

  /* =======================================================================
   * TAB : Vue d'ensemble
   * ===================================================================== */
  function renderDashboard() {
    const panel = document.getElementById("panel-dashboard");
    const svc = currentService();
    if (!svc) { panel.innerHTML = `<div class="empty">Chargement…</div>`; return; }
    const { scoreGlobal, scoreParTheme } = computeScores();
    const counts = countsByStatut();
    const lastMesure = state.mesures[0] || null;
    const prevSnapshot = state.snapshots.length ? state.snapshots[state.snapshots.length - 1] : null;
    const delta = prevSnapshot && scoreGlobal !== null ? scoreGlobal - prevSnapshot.scoreGlobal : null;

    const kpiScore = `
      <div class="card kpi">
        <div class="k-label">Score d'avancement RGESN</div>
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="k-value">${fmtPct(scoreGlobal)}</div>
          ${delta !== null ? `<span class="pill ${delta >= 0 ? "pill-valide" : "pill-non_valide"}">${delta >= 0 ? "+" : ""}${Math.round(delta)} pts</span>` : ""}
        </div>
        <div class="k-sub">Cible : ${fmtPct(svc.cibleScore)} au ${fmtDateFr(svc.cibleDate) || "—"}</div>
      </div>`;

    const kpiGes = lastMesure ? `
      <div class="card kpi">
        <div class="k-label">Dernier relevé — GES</div>
        <div class="k-value">${fmtNum(lastMesure.geskgco2e, 1)}<span class="k-unit"> kg CO₂e</span></div>
        <div class="k-sub">${fmtDateFr(lastMesure.date)}${lastMesure.nbUtilisateurs ? " · " + fmtNum(lastMesure.geskgco2e / lastMesure.nbUtilisateurs * 1000, 2) + " g/utilisateur" : ""}</div>
      </div>` : emptyKpi("Empreinte GES", "Aucun relevé technique");

    const kpiEnergie = lastMesure ? `
      <div class="card kpi">
        <div class="k-label">Énergie primaire</div>
        <div class="k-value">${fmtNum(lastMesure.energiePrimaireKwh, 0)}<span class="k-unit"> kWh</span></div>
        <div class="k-sub">Coef. ${fmtNum(lastMesure.coefEnergiePrimaire, 2)} · ${fmtDateFr(lastMesure.date)}</div>
      </div>` : emptyKpi("Énergie primaire", "Aucun relevé technique");

    const kpiEau = lastMesure ? `
      <div class="card kpi">
        <div class="k-label">Eau bleue</div>
        <div class="k-value">${fmtNum(lastMesure.eauBleueL, 0)}<span class="k-unit"> L</span></div>
        <div class="k-sub">WUE ${fmtNum(lastMesure.wue, 2)} L/kWh · ${fmtDateFr(lastMesure.date)}</div>
      </div>` : emptyKpi("Eau bleue", "Aucun relevé technique");

    const barChart = buildThemeBarChart(scoreParTheme);
    const lineChart = buildHistoryChart(svc, scoreGlobal);
    const actionsTable = buildActionsTable();

    panel.innerHTML = `
      ${svc.isExample ? `<div class="banner warn" style="margin-bottom:16px">Ce projet est un <strong>exemple</strong> pré-rempli pour montrer le fonctionnement de l'outil. Créez votre propre projet (bouton « + Projet ») pour évaluer un service réel.</div>` : ""}
      <div class="grid grid-kpi" style="margin-bottom:14px">${kpiScore}${kpiGes}${kpiEnergie}${kpiEau}</div>
      <div class="grid grid-2" style="margin-bottom:14px">
        <div class="card">
          <div class="card-head"><h3>Score par thématique</h3><span class="hint">pondéré selon la priorité RGESN</span></div>
          ${barChart}
        </div>
        <div class="card">
          <div class="card-head"><h3>Trajectoire</h3><span class="hint">points d'étape</span></div>
          ${lineChart}
          <button class="btn btn-sm" id="btn-snapshot" style="margin-top:10px; width:100%">Enregistrer un point d'étape aujourd'hui</button>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>Actions à mener — critères non validés</h3>
          <span class="hint">${counts.non_valide} non validé(s) · ${counts.a_evaluer} à évaluer · ${counts.na} non applicable(s)</span>
        </div>
        ${actionsTable}
      </div>
    `;

    document.getElementById("btn-snapshot").addEventListener("click", () => {
      snapshotsCol(state.currentServiceId).add({
        date: todayIso(), label: "Point d'étape du " + fmtDateFr(todayIso()),
        scoreGlobal: Math.round(scoreGlobal || 0), scoreParTheme,
        createdAt: new Date().toISOString(),
      }).then(() => toast("Point d'étape enregistré")).catch((e) => toast("Erreur : " + e.message));
    });
  }

  function emptyKpi(label, msg) {
    return `<div class="card kpi"><div class="k-label">${esc(label)}</div><div class="empty" style="padding:2px 0">${esc(msg)}</div></div>`;
  }

  function buildThemeBarChart(scoreParTheme) {
    const rows = THEMES.map((t) => ({ t, label: THEME_LABELS[t] || ("Thème " + t), score: scoreParTheme[t] }));
    const w = 560, rowH = 26, padL = 116, padR = 46, top = 6;
    const h = rows.length * rowH + top + 6;
    const barMaxW = w - padL - padR;
    const bars = rows.map((r, i) => {
      const y = top + i * rowH;
      const cls = scoreColorClass(r.score);
      const colorMap = { good: "var(--accent)", warn: "var(--warn)", bad: "var(--bad)", na: "var(--na)" };
      const pct = r.score === null ? 0 : r.score;
      const bw = Math.max(2, (pct / 100) * barMaxW);
      return `
        <text x="0" y="${y + rowH / 2 + 4}" font-size="11.5">${esc(r.label)}</text>
        <rect x="${padL}" y="${y + 5}" width="${barMaxW}" height="${rowH - 12}" rx="4" fill="var(--surface-3)"/>
        <rect x="${padL}" y="${y + 5}" width="${bw}" height="${rowH - 12}" rx="4" fill="${colorMap[cls]}"/>
        <text x="${padL + barMaxW + 8}" y="${y + rowH / 2 + 4}" font-size="11.5" font-family="var(--font-mono)" text-anchor="start">${fmtPct(r.score)}</text>
      `;
    }).join("");
    return `<div class="chart-wrap"><svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px; height:${h}px" role="img" aria-label="Score par thématique">${bars}</svg></div>`;
  }

  function buildHistoryChart(svc, liveScore) {
    const points = state.snapshots.map((s) => ({ date: s.date, score: s.scoreGlobal, label: s.label }));
    points.push({ date: todayIso(), score: liveScore, label: "Aujourd'hui", live: true });
    if (points.length < 1) return `<div class="empty">Pas encore d'historique</div>`;
    const w = 480, h = 190, padL = 30, padR = 14, padT = 14, padB = 26;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const n = points.length;
    const x = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => padT + plotH - (Math.max(0, Math.min(100, v || 0)) / 100) * plotH;
    const cible = svc.cibleScore;
    const path = points.map((p, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + "," + y(p.score).toFixed(1)).join(" ");
    const area = path + ` L${x(n - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
    const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="${p.live ? 4.5 : 3.5}" fill="${p.live ? "var(--accent-strong)" : "var(--accent)"}"><title>${esc(p.label)} — ${fmtPct(p.score)}</title></circle>`).join("");
    const grid = [0, 25, 50, 75, 100].map((g) => `<line x1="${padL}" x2="${w - padR}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" stroke="var(--border)" stroke-width="1"/><text x="${padL - 6}" y="${(y(g) + 3).toFixed(1)}" font-size="9.5" text-anchor="end">${g}</text>`).join("");
    const cibleLine = cible !== undefined && cible !== null ? `<line x1="${padL}" x2="${w - padR}" y1="${y(cible).toFixed(1)}" y2="${y(cible).toFixed(1)}" stroke="var(--info)" stroke-width="1.4" stroke-dasharray="4 3"/><text x="${w - padR}" y="${(y(cible) - 4).toFixed(1)}" font-size="9.5" fill="var(--info)" text-anchor="end">cible ${Math.round(cible)}%</text>` : "";
    return `<div class="chart-wrap"><svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px; height:${h}px" role="img" aria-label="Trajectoire du score">
      ${grid}
      <path d="${area}" fill="var(--accent-soft)" stroke="none"/>
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      ${cibleLine}
      ${dots}
    </svg></div>`;
  }

  function buildActionsTable() {
    const rows = [];
    RGESN_CRITERIA.forEach((c) => {
      const st = getCritState(c.id);
      if (st.applicabilite === "na" || st.statut === "valide") return;
      if (st.statut === "a_evaluer" && !st.pourQuand) return; // pas assez d'info pour prioriser
      rows.push({ c, st });
    });
    rows.sort((a, b) => {
      const da = a.st.pourQuand || "9999", db_ = b.st.pourQuand || "9999";
      return da.localeCompare(db_);
    });
    const top = rows.slice(0, 8);
    if (!top.length) return `<div class="empty">Aucune action avec échéance renseignée pour le moment — complétez le champ « Pour quand » dans l'auto-évaluation.</div>`;
    return `<div class="table-scroll"><table class="simple">
      <thead><tr><th>ID</th><th>Critère</th><th>Priorité</th><th>Statut</th><th>Qui</th><th>Échéance</th></tr></thead>
      <tbody>${top.map(({ c, st }) => {
        const late = st.pourQuand && daysBetween(st.pourQuand) < 0;
        return `<tr>
          <td class="mono">${c.id}</td>
          <td>${esc(c.libelle)}</td>
          <td><span class="pill pill-${c.priorite}"><span class="pill-dot"></span>${PRIORITE_LABEL[c.priorite]}</span></td>
          <td><span class="pill pill-${st.statut}">${STATUT_LABEL[st.statut]}</span></td>
          <td>${esc(st.quiFait || "—")}</td>
          <td>${st.pourQuand ? `<span class="${late ? "pill pill-non_valide" : ""}">${fmtDateFr(st.pourQuand)}${late ? " · en retard" : ""}</span>` : "—"}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  }

  /* =======================================================================
   * TAB : Auto-évaluation RGESN
   * ===================================================================== */
  function safeRenderEvaluation() {
    const panel = document.getElementById("panel-evaluation");
    const active = document.activeElement;
    if (panel.contains(active) && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
      ui.pendingEvalRerender = true;
      return;
    }
    renderEvaluation();
  }

  function renderEvaluation() {
    ui.pendingEvalRerender = false;
    const panel = document.getElementById("panel-evaluation");
    const svc = currentService();
    if (!svc) { panel.innerHTML = `<div class="empty">Chargement…</div>`; return; }
    const { scoreParTheme } = computeScores();

    const f = ui.filters;
    const q = f.q.trim().toLowerCase();
    const matches = (c) => {
      if (f.theme !== "all" && String(c.themeNum) !== f.theme) return false;
      if (f.priorite !== "all" && c.priorite !== f.priorite) return false;
      const st = getCritState(c.id);
      const effectiveStatut = st.applicabilite === "na" ? "na" : st.statut;
      if (f.statut !== "all" && effectiveStatut !== f.statut) return false;
      if (q && !(c.id.includes(q) || c.libelle.toLowerCase().includes(q))) return false;
      return true;
    };

    let totalMatch = 0;
    const groups = THEMES.map((t) => {
      const crits = RGESN_CRITERIA.filter((c) => c.themeNum === t && matches(c));
      totalMatch += crits.length;
      return { t, crits };
    }).filter((g) => g.crits.length > 0 || (f.theme === "all" && f.statut === "all" && f.priorite === "all" && !q));

    panel.innerHTML = `
      <div class="filters">
        <input type="text" id="ev-q" placeholder="Rechercher un critère (ID ou texte)…" value="${esc(f.q)}">
        <select id="ev-theme">
          <option value="all">Toutes les thématiques</option>
          ${THEMES.map((t) => `<option value="${t}" ${f.theme === String(t) ? "selected" : ""}>${t}. ${esc(THEME_LABELS[t])}</option>`).join("")}
        </select>
        <select id="ev-statut">
          <option value="all">Tous statuts</option>
          ${STATUT_OPTIONS.map((s) => `<option value="${s}" ${f.statut === s ? "selected" : ""}>${STATUT_LABEL[s]}</option>`).join("")}
        </select>
        <select id="ev-priorite">
          <option value="all">Toutes priorités</option>
          ${Object.keys(PRIORITE_LABEL).map((p) => `<option value="${p}" ${f.priorite === p ? "selected" : ""}>${PRIORITE_LABEL[p]}</option>`).join("")}
        </select>
        <span class="count">${totalMatch} / 78 critères</span>
      </div>
      ${groups.map((g) => renderThemeGroup(g, scoreParTheme[g.t])).join("")}
    `;

    document.getElementById("ev-q").addEventListener("input", debounce((e) => { ui.filters.q = e.target.value; renderEvaluation(); }, 250));
    document.getElementById("ev-theme").addEventListener("change", (e) => { ui.filters.theme = e.target.value; renderEvaluation(); });
    document.getElementById("ev-statut").addEventListener("change", (e) => { ui.filters.statut = e.target.value; renderEvaluation(); });
    document.getElementById("ev-priorite").addEventListener("change", (e) => { ui.filters.priorite = e.target.value; renderEvaluation(); });

    panel.querySelectorAll(".theme-head").forEach((h) => {
      h.addEventListener("click", () => {
        const t = Number(h.dataset.theme);
        if (ui.openThemes.has(t)) ui.openThemes.delete(t); else ui.openThemes.add(t);
        renderEvaluation();
      });
    });
    panel.querySelectorAll(".crit-row-main").forEach((r) => {
      r.addEventListener("click", (e) => {
        if (e.target.closest("select, input, textarea, button")) return;
        const id = r.closest(".crit-row").dataset.id;
        if (ui.openCrit.has(id)) ui.openCrit.delete(id); else ui.openCrit.add(id);
        renderEvaluation();
      });
    });
    bindCritControls(panel);
  }

  function renderThemeGroup(g, score) {
    const open = ui.openThemes.has(g.t);
    const pct = score === null ? 0 : score;
    return `
      <div class="theme-group ${open ? "open" : ""}">
        <div class="theme-head" data-theme="${g.t}">
          <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <h4>${g.t}. ${esc(THEME_LABELS[g.t])}</h4>
          <div class="theme-bar"><div style="width:${pct}%"></div></div>
          <div class="theme-score mono">${fmtPct(score)}</div>
        </div>
        <div class="theme-body">
          ${g.crits.map(renderCritRow).join("") || `<div class="empty" style="padding:14px 16px">Aucun critère ne correspond aux filtres dans cette thématique.</div>`}
        </div>
      </div>`;
  }

  function renderCritRow(c) {
    const st = getCritState(c.id);
    const open = ui.openCrit.has(c.id);
    const effectiveStatut = st.applicabilite === "na" ? "na" : st.statut;
    return `
      <div class="crit-row ${open ? "open" : ""}" data-id="${c.id}">
        <div class="crit-row-main">
          <div class="crit-id">${c.id}</div>
          <div class="crit-libelle">${esc(c.libelle)}</div>
          <div class="crit-controls">
            <span class="pill pill-${c.priorite}"><span class="pill-dot"></span>${PRIORITE_LABEL[c.priorite]}</span>
            <select class="st-select st-${effectiveStatut}" data-field="statut" data-id="${c.id}" ${st.applicabilite === "na" ? "disabled" : ""}>
              ${STATUT_OPTIONS.filter((s) => s !== "na").map((s) => `<option value="${s}" ${st.statut === s ? "selected" : ""}>${STATUT_LABEL[s]}</option>`).join("")}
            </select>
            <select class="st-select" data-field="applicabilite" data-id="${c.id}">
              <option value="applicable" ${st.applicabilite !== "na" ? "selected" : ""}>Applicable</option>
              <option value="na" ${st.applicabilite === "na" ? "selected" : ""}>N/A pour ce service</option>
            </select>
          </div>
          <svg class="crit-chev" width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="crit-detail">
          <div class="moyen-test"><strong>Moyen de test / contrôle :</strong> ${esc(c.moyenTest)}<br><span class="muted">Applicabilité par défaut du référentiel : ${esc(c.applicabiliteDefaut)}</span></div>
          <div class="field-row">
            <div><label>Date d'évaluation</label><input type="date" data-field="dateEvaluation" data-id="${c.id}" value="${esc(st.dateEvaluation || "")}"></div>
            <div><label>Qui fait ?</label><input type="text" data-field="quiFait" data-id="${c.id}" value="${esc(st.quiFait || "")}" placeholder="Responsable"></div>
            <div><label>Pour quand ?</label><input type="date" data-field="pourQuand" data-id="${c.id}" value="${esc(st.pourQuand || "")}"></div>
          </div>
          <label>Actions à mener</label>
          <textarea rows="2" data-field="actions" data-id="${c.id}" placeholder="Actions concrètes pour progresser sur ce critère">${esc(st.actions || "")}</textarea>
          <label>Note pour la déclaration d'écoconception</label>
          <textarea rows="3" data-field="declarationNote" data-id="${c.id}" placeholder="${esc(c.exempleDeclaration || "Décrivez comment le service répond à ce critère.")}">${esc(st.declarationNote || "")}</textarea>
        </div>
      </div>`;
  }

  function bindCritControls(panel) {
    panel.querySelectorAll("[data-field][data-id]").forEach((input) => {
      const field = input.dataset.field, id = input.dataset.id;
      const commit = () => {
        const patch = {};
        patch[field] = input.value;
        if (field === "applicabilite" && input.value === "na") patch.statut = getCritState(id).statut || "a_evaluer";
        patchCriterion(id, patch);
        if (field === "statut" || field === "applicabilite") renderEvaluation();
        else { renderScorePill(); renderDashboard(); }
      };
      if (input.tagName === "SELECT") input.addEventListener("change", (e) => { e.stopPropagation(); commit(); });
      else if (input.type === "date") input.addEventListener("change", commit);
      else input.addEventListener("blur", commit);
    });
  }

  /* =======================================================================
   * TAB : Mesure technique
   * ===================================================================== */
  function computeMesurePreview(f) {
    const energie = Number(f.energieConsommee) || 0;
    const intensite = Number(f.intensiteCarbone) || 0;
    const empreinteFab = Number(f.empreinteFabrication) || 0;
    const coefEP = Number(f.coefEnergiePrimaire) || 0;
    const wue = Number(f.wue) || 0;
    const ges = (energie * intensite) / 1000 + empreinteFab;
    const energiePrimaire = coefEP ? energie * coefEP : null;
    const eauBleue = wue ? wue * energie : null;
    return { geskgco2e: ges, energiePrimaireKwh: energiePrimaire, eauBleueL: eauBleue };
  }

  function renderMesure() {
    const panel = document.getElementById("panel-mesure");
    const svc = currentService();
    if (!svc) { panel.innerHTML = `<div class="empty">Chargement…</div>`; return; }

    panel.innerHTML = `
      <div class="banner" style="margin-bottom:16px">
        Cette couche mesure des <strong>indicateurs d'impact réels</strong> (énergie, GES, eau bleue,
        ressources abiotiques) — distincts du score d'avancement RGESN calculé dans l'onglet
        « Auto-évaluation ». Elle collecte les données d'hébergement et d'usage que vous relevez
        (export de votre hébergeur, outils de supervision…) et les convertit selon une méthodologie
        que vous documentez à chaque relevé — aucune valeur n'est estimée automatiquement sans source.
      </div>
      <div class="grid grid-2">
        <div class="card">
          <h3 style="margin-bottom:12px">Nouveau relevé</h3>
          <form id="mesure-form">
            <fieldset>
              <legend>Hébergement</legend>
              <div class="form-grid">
                <div class="form-field"><label>Date du relevé</label><input type="date" name="date" value="${todayIso()}" required></div>
                <div class="form-field"><label>Hébergeur</label><input type="text" name="hebergeur" placeholder="Ex. : OVHcloud, Scaleway, AWS eu-west-3…"></div>
                <div class="form-field"><label>Localisation (pays / ville)</label><input type="text" name="localisation" placeholder="Ex. : Gravelines, France"></div>
                <div class="form-field"><label>Part d'énergie renouvelable (%)</label><input type="number" name="renouvelablePct" min="0" max="100"></div>
                <div class="form-field"><label>PUE (réel ou <em>by design</em>)</label><input type="number" step="0.01" name="pue"></div>
                <div class="form-field"><label>WUE — L/kWh (réel ou <em>by design</em>)</label><input type="number" step="0.01" name="wue"></div>
              </div>
            </fieldset>
            <fieldset>
              <legend>Consommation mesurée sur la période</legend>
              <div class="form-grid">
                <div class="form-field"><label>Énergie consommée (kWh)</label><input type="number" step="0.01" name="energieConsommee" required></div>
                <div class="form-field">
                  <label>Coef. énergie primaire</label>
                  <input type="number" step="0.01" name="coefEnergiePrimaire">
                  <span class="help">À documenter (ex. RE2020 : 2,3 pour l'électricité en France — à vérifier selon votre méthodologie).</span>
                </div>
                <div class="form-field">
                  <label>Intensité carbone du mix (g CO₂e/kWh)</label>
                  <input type="number" step="0.1" name="intensiteCarbone" required>
                  <span class="help">Ex. source : RTE éCO2mix, AIB, ADEME Base Empreinte.</span>
                </div>
                <div class="form-field span2"><label>Source de l'intensité carbone</label><input type="text" name="intensiteSource" placeholder="Ex. : RTE éCO2mix, moyenne annuelle France 2026"></div>
                <div class="form-field"><label>Empreinte fabrication / terminaux (kg CO₂e, optionnel)</label><input type="number" step="0.01" name="empreinteFabrication"></div>
                <div class="form-field"><label>Nombre d'utilisateurs / requêtes sur la période</label><input type="number" name="nbUtilisateurs"></div>
                <div class="form-field span2"><label>Ressources abiotiques (kg eq. Sb, ou unité documentée)</label><input type="number" step="0.001" name="ressourcesAbiotiques"></div>
                <div class="form-field span2"><label>Source / méthodologie des ressources abiotiques</label><input type="text" name="ressourcesSource" placeholder="Ex. : ACV multicritère PEF, ADEME Base Empreinte"></div>
              </div>
            </fieldset>
            <fieldset>
              <legend>Méthodologie et sources (obligatoire)</legend>
              <textarea name="methodologieSources" rows="3" style="width:100%" required placeholder="Décrivez la méthodologie de mesure/conversion utilisée et les sources des facteurs d'émission — indispensable pour l'auditabilité (jamais de valeur sans source documentée)."></textarea>
            </fieldset>
            <div class="card" style="background:var(--surface-2); box-shadow:none; margin-bottom:14px">
              <div class="k-label" style="margin-bottom:8px">Aperçu du calcul</div>
              <div id="mesure-preview" class="grid" style="grid-template-columns:repeat(3,1fr); gap:10px"></div>
            </div>
            <button type="submit" class="btn btn-primary">Enregistrer le relevé</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h3>Historique des relevés</h3><span class="hint">${state.mesures.length} relevé(s)</span></div>
          ${renderMesureHistory()}
        </div>
      </div>
    `;

    const form = document.getElementById("mesure-form");
    const preview = document.getElementById("mesure-preview");
    const updatePreview = () => {
      const f = Object.fromEntries(new FormData(form).entries());
      const r = computeMesurePreview(f);
      preview.innerHTML = `
        <div><div class="k-label">GES</div><div class="mono">${fmtNum(r.geskgco2e, 2)} kg CO₂e</div></div>
        <div><div class="k-label">Énergie primaire</div><div class="mono">${r.energiePrimaireKwh === null ? "—" : fmtNum(r.energiePrimaireKwh, 0) + " kWh"}</div></div>
        <div><div class="k-label">Eau bleue</div><div class="mono">${r.eauBleueL === null ? "—" : fmtNum(r.eauBleueL, 0) + " L"}</div></div>
      `;
    };
    form.addEventListener("input", updatePreview);
    updatePreview();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form).entries());
      if (!f.methodologieSources || !f.methodologieSources.trim()) { toast("Merci de documenter la méthodologie et les sources"); return; }
      const computed = computeMesurePreview(f);
      const doc = Object.assign({}, f, computed, { createdAt: new Date().toISOString() });
      ["renouvelablePct", "pue", "wue", "energieConsommee", "coefEnergiePrimaire", "intensiteCarbone", "empreinteFabrication", "nbUtilisateurs", "ressourcesAbiotiques"].forEach((k) => {
        if (doc[k] === undefined || doc[k] === "") delete doc[k];
        else doc[k] = Number(doc[k]);
      });
      mesuresCol(state.currentServiceId).add(doc).then(() => { toast("Relevé enregistré"); form.reset(); updatePreview(); }).catch((err) => toast("Erreur : " + err.message));
    });

    bindMesureHistoryHandlers(panel);
  }

  function renderMesureHistory() {
    if (!state.mesures.length) return `<div class="empty">Aucun relevé pour l'instant — renseignez le premier ci-contre.</div>`;
    return `<div class="stack">${state.mesures.map((m) => `
      <div class="card" style="box-shadow:none; padding:12px 14px">
        <div class="row-between">
          <strong class="small">${fmtDateFr(m.date)}${m.hebergeur ? " · " + esc(m.hebergeur) : ""}</strong>
          <button class="btn btn-sm btn-ghost btn-danger" data-del="${m.id}">Supprimer</button>
        </div>
        <div class="grid" style="grid-template-columns:repeat(3,1fr); gap:8px; margin:8px 0">
          <div><div class="k-label">GES</div><div class="mono">${fmtNum(m.geskgco2e, 2)} kg</div></div>
          <div><div class="k-label">Én. primaire</div><div class="mono">${m.energiePrimaireKwh != null ? fmtNum(m.energiePrimaireKwh, 0) + " kWh" : "—"}</div></div>
          <div><div class="k-label">Eau bleue</div><div class="mono">${m.eauBleueL != null ? fmtNum(m.eauBleueL, 0) + " L" : "—"}</div></div>
        </div>
        <div class="small muted">${esc(m.methodologieSources || "")}</div>
      </div>
    `).join("")}</div>`;
  }

  function bindMesureHistoryHandlers(panel) {
    panel.querySelectorAll("[data-del]").forEach((btn) => {
      let confirmStep = false;
      btn.addEventListener("click", () => {
        if (!confirmStep) { confirmStep = true; btn.textContent = "Confirmer ?"; return; }
        mesuresCol(state.currentServiceId).doc(btn.dataset.del).delete().then(() => toast("Relevé supprimé"));
      });
    });
  }

  /* =======================================================================
   * TAB : Déclaration d'écoconception
   * ===================================================================== */
  function renderDeclaration() {
    const panel = document.getElementById("panel-declaration");
    const svc = currentService();
    if (!svc) { panel.innerHTML = `<div class="empty">Chargement…</div>`; return; }
    const { scoreGlobal } = computeScores();
    const prevSnapshot = state.snapshots.length ? state.snapshots[state.snapshots.length - 1] : null;

    panel.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin-bottom:12px">Informations de la déclaration</h3>
        <div class="form-grid">
          <div class="form-field"><label>Nom du service numérique</label><input type="text" id="d-nom" value="${esc(svc.nom || "")}"></div>
          <div class="form-field"><label>Date de réalisation</label><input type="date" id="d-date" value="${esc(svc.declDate || todayIso())}"></div>
          <div class="form-field"><label>Référent écoconception — nom</label><input type="text" id="d-ref-nom" value="${esc(svc.referentNom || "")}"></div>
          <div class="form-field"><label>Référent écoconception — titre</label><input type="text" id="d-ref-titre" value="${esc(svc.referentTitre || "")}"></div>
          <div class="form-field"><label>Fréquence des revues/audits</label><input type="text" id="d-revue" value="${esc(svc.revueFrequence || "")}" placeholder="Ex. : trimestre, semestre…"></div>
          <div class="form-field span2"><label>Chemins critiques / unités fonctionnelles évalués</label><textarea id="d-chemins" rows="2">${esc(svc.cheminsCritiques || "")}</textarea></div>
        </div>
      </div>
      <div class="row-between no-print" style="margin-bottom:12px">
        <span class="hint muted small">Généré automatiquement à partir de l'auto-évaluation — complétez les notes de déclaration critère par critère dans l'onglet précédent.</span>
        <div style="display:flex; gap:8px">
          <button class="btn btn-sm" id="btn-print">Imprimer / PDF</button>
          <button class="btn btn-sm btn-primary" id="btn-export">Exporter (.html)</button>
        </div>
      </div>
      <div class="decl-doc" id="decl-doc">${buildDeclarationContent(svc, scoreGlobal, prevSnapshot)}</div>
    `;

    ["d-nom", "d-date", "d-ref-nom", "d-ref-titre", "d-revue", "d-chemins"].forEach((id) => {
      const field = { "d-nom": "nom", "d-date": "declDate", "d-ref-nom": "referentNom", "d-ref-titre": "referentTitre", "d-revue": "revueFrequence", "d-chemins": "cheminsCritiques" }[id];
      const node = document.getElementById(id);
      const commit = () => { patchService({ [field]: node.value }); renderDeclaration(); };
      node.addEventListener(node.tagName === "TEXTAREA" || node.type === "text" ? "blur" : "change", commit);
    });

    document.getElementById("btn-print").addEventListener("click", () => window.print());
    document.getElementById("btn-export").addEventListener("click", async () => {
      if (!state.downloadsCap) { toast("Téléchargement indisponible dans cette vue"); return; }
      const html = buildStandaloneDeclarationHtml(svc, scoreGlobal, prevSnapshot);
      try {
        await state.downloadsCap.save({ filename: `declaration-ecoconception-${slug(svc.nom)}.html`, data: html });
        toast("Déclaration téléchargée");
      } catch (e) { if (e && e.code !== "declined") toast("Erreur d'export : " + (e.message || e.code)); }
    });
  }

  function slug(s) { return (s || "service").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "service"; }

  function buildDeclarationContent(svc, scoreGlobal, prevSnapshot) {
    const validés = RGESN_CRITERIA.filter((c) => getCritState(c.id).statut === "valide" && getCritState(c.id).applicabilite !== "na");
    const nonValidés = RGESN_CRITERIA.filter((c) => getCritState(c.id).statut === "non_valide" && getCritState(c.id).applicabilite !== "na");
    const byTheme = (list) => {
      const m = {}; list.forEach((c) => { (m[c.themeNum] = m[c.themeNum] || []).push(c); }); return m;
    };
    const vByT = byTheme(validés), nvByT = byTheme(nonValidés);
    const tagList = (m, cls) => THEMES.map((t) => (m[t] && m[t].length) ? `<div class="small" style="margin-bottom:4px"><strong>${t}. ${esc(THEME_LABELS[t])} :</strong> ${m[t].map((c) => `<span class="crit-tag ${cls}">${c.id}</span>`).join("")}</div>` : "").join("");

    const actionsList = nonValidés.filter((c) => getCritState(c.id).actions).map((c) => {
      const st = getCritState(c.id);
      return `<li><span class="crit-tag bad">${c.id}</span> ${esc(st.actions)}${st.quiFait ? " — <em>" + esc(st.quiFait) + "</em>" : ""}${st.pourQuand ? " (pour le " + fmtDateFr(st.pourQuand) + ")" : ""}</li>`;
    }).join("");

    const detail = THEMES.map((t) => {
      const crits = RGESN_CRITERIA.filter((c) => c.themeNum === t);
      const withNote = crits.filter((c) => getCritState(c.id).declarationNote && getCritState(c.id).declarationNote.trim());
      if (!withNote.length) return "";
      return `<h3>${t}. ${esc(THEME_LABELS[t])}</h3>` + withNote.map((c) => `<p><span class="crit-tag">${c.id}</span> ${nl2br(getCritState(c.id).declarationNote)}</p>`).join("");
    }).join("");

    return `
      <div class="decl-title-page">
        <h1>Déclaration d'écoconception</h1>
        <div class="sub">${esc(svc.nom || "[service à compléter]")} — ${fmtDateFr(svc.declDate || todayIso())}</div>
      </div>

      <h2>Résumé</h2>
      <p>Le service <strong>${esc(svc.nom || "[à compléter]")}</strong> s'inscrit dans une démarche d'écoconception visant à réduire ses impacts environnementaux. Cette déclaration a été rédigée le ${fmtDateFr(svc.declDate || todayIso())}, dans le cadre de la mise en œuvre du référentiel général de l'écoconception des services numériques (RGESN, version 2024 — Arcep, Arcom, ADEME, DINUM, CNIL, Inria).</p>
      <p>Sa mise en œuvre poursuit quatre objectifs : concevoir des services numériques plus durables et allonger la durée de vie des terminaux ; promouvoir la sobriété environnementale ; diminuer les ressources informatiques mobilisées et le trafic de données ; accroître la transparence sur l'empreinte environnementale du service.</p>

      <h2>Critères validés</h2>
      ${validés.length ? tagList(vByT, "") : `<p class="placeholder">Aucun critère validé pour le moment.</p>`}

      <h2>Critères non validés</h2>
      ${nonValidés.length ? tagList(nvByT, "bad") : `<p class="placeholder">Aucun critère non validé identifié.</p>`}

      <h2>Score d'avancement</h2>
      <p>Score d'avancement au ${fmtDateFr(todayIso())} : <strong>${fmtPct(scoreGlobal)}</strong>${prevSnapshot ? ` (score précédent : ${fmtPct(prevSnapshot.scoreGlobal)} au ${fmtDateFr(prevSnapshot.date)})` : ""}.</p>
      <p>Le service vise une amélioration de ce score pour atteindre <strong>${fmtPct(svc.cibleScore)}</strong> au ${fmtDateFr(svc.cibleDate) || "[date à compléter]"}.</p>

      <h2>Plan d'avancement</h2>
      ${actionsList ? `<ul>${actionsList}</ul>` : `<p class="placeholder">Aucune action planifiée renseignée — complétez le champ « Actions à mener » des critères non validés.</p>`}
      <p>Des revues et audits sont réalisés ${svc.revueFrequence ? "tous les " + esc(svc.revueFrequence) : "<span class=\"placeholder\">[fréquence à compléter]</span>"}.</p>

      <h2>Chemins critiques et unités fonctionnelles évalués</h2>
      <p>${svc.cheminsCritiques ? nl2br(svc.cheminsCritiques) : `<span class="placeholder">[à compléter]</span>`}</p>

      <h2>Référent en écoconception numérique</h2>
      <p>${svc.referentNom ? esc(svc.referentNom) + (svc.referentTitre ? " — " + esc(svc.referentTitre) : "") : `<span class="placeholder">[nom et titre à compléter]</span>`}</p>

      <h2>Détail du diagnostic</h2>
      ${detail || `<p class="placeholder">Complétez les « notes pour la déclaration » critère par critère dans l'onglet Auto-évaluation pour enrichir cette section.</p>`}
    `;
  }

  function buildStandaloneDeclarationHtml(svc, scoreGlobal, prevSnapshot) {
    const content = buildDeclarationContent(svc, scoreGlobal, prevSnapshot);
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Déclaration d'écoconception — ${esc(svc.nom || "")}</title>
    <style>
      body{font-family:Georgia,'Times New Roman',serif; color:#152420; max-width:780px; margin:40px auto; padding:0 24px; line-height:1.55;}
      h1{font-size:26px; text-align:center;} h2{font-size:19px; border-bottom:2px solid #1E6F52; padding-bottom:6px; margin-top:30px;} h3{font-size:15px; color:#134F39;}
      .crit-tag{font-family:'Courier New',monospace; font-size:11.5px; background:#DCEEE3; color:#134F39; padding:1px 6px; border-radius:5px; margin-right:4px; display:inline-block;}
      .crit-tag.bad{background:#F5DFDA; color:#A5392C;}
      .placeholder{color:#888; font-style:italic;}
      .sub{text-align:center; color:#555; margin-bottom:20px;}
    </style></head><body>${content}</body></html>`;
  }

  /* =======================================================================
   * TAB : Marchés publics
   * ===================================================================== */
  function renderMarches() {
    const panel = document.getElementById("panel-marches");
    const svc = currentService();
    if (!svc) { panel.innerHTML = `<div class="empty">Chargement…</div>`; return; }

    panel.innerHTML = `
      <div class="banner" style="margin-bottom:16px">
        Il n'existe pas de grille RSE unique dans les marchés publics : chaque CCTP formule ses propres
        critères. Cette table de correspondance, construite par recoupement des formulations les plus
        fréquentes, aide à retrouver rapidement quels critères RGESN validés servent de preuve pour
        quelle rubrique — à adapter au libellé exact de chaque consultation.
      </div>
      <div class="stack">
        ${CCTP_FAMILIES.map(renderCctpFamily).join("")}
      </div>
    `;

    panel.querySelectorAll("[data-copy-family]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const fam = CCTP_FAMILIES.find((f) => f.id === btn.dataset.copyFamily);
        copyText(buildCctpCopyText(fam));
      });
    });
  }

  function renderCctpFamily(fam) {
    const crits = RGESN_CRITERIA.filter((c) => fam.themes.includes(c.themeNum));
    const validés = crits.filter((c) => getCritState(c.id).statut === "valide" && getCritState(c.id).applicabilite !== "na");
    const applicables = crits.filter((c) => getCritState(c.id).applicabilite !== "na");
    const pct = applicables.length ? Math.round((validés.length / applicables.length) * 100) : 0;
    return `
      <div class="card">
        <div class="card-head">
          <h3>${esc(fam.label)}</h3>
          <span class="hint">${validés.length} / ${applicables.length} critère(s) validé(s)</span>
        </div>
        <p class="small muted" style="margin-bottom:10px">${esc(fam.wording)}</p>
        <div class="theme-bar" style="width:100%; margin-bottom:10px"><div style="width:${pct}%"></div></div>
        <div class="tag-list" style="margin-bottom:10px">
          ${validés.length ? validés.map((c) => `<span class="crit-tag" title="${esc(c.libelle)}">${c.id}</span>`).join("") : `<span class="empty" style="padding:0">Aucun critère validé dans ce périmètre pour le moment.</span>`}
        </div>
        <button class="btn btn-sm" data-copy-family="${fam.id}" ${validés.length ? "" : "disabled"}>Copier les preuves pour le mémoire technique</button>
      </div>`;
  }

  function buildCctpCopyText(fam) {
    const svc = currentService();
    const crits = RGESN_CRITERIA.filter((c) => fam.themes.includes(c.themeNum) && getCritState(c.id).statut === "valide" && getCritState(c.id).applicabilite !== "na");
    const lines = [`${fam.label} — ${svc.nom || ""}`, ""];
    crits.forEach((c) => {
      const st = getCritState(c.id);
      const preuve = (st.declarationNote && st.declarationNote.trim()) || c.moyenTest;
      lines.push(`[RGESN ${c.id}] ${c.libelle}`);
      lines.push(preuve);
      lines.push("");
    });
    return lines.join("\n");
  }

  /* ---------------------------------------------------------------------
   * Go
   * ------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();
})();
