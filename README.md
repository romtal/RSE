# Mesure Écoconception

Outil de pilotage RGESN 2024 pour le secteur public : auto-évaluation des 78 critères
officiels, mesure d'empreinte carbone (GES, énergie, eau bleue, ressources abiotiques),
génération de déclaration d'écoconception et aide à la valorisation RSE dans les
marchés publics.

Version en ligne (Artifact Claude, fonctionnelle, avec sauvegarde des données) :
https://claude.ai/artifact/KYPYGwYBtmk3hdvP11vyie

Deux façons de faire tourner cet outil sont présentes dans ce repo : en **Artifact
Claude** (dossier racine) ou en **déploiement autonome sur Vercel** (dossier `vercel/`),
avec une vraie base Postgres à la place du stockage propriétaire de claude.ai.

## Dossier racine — code source de l'Artifact Claude

Cette application est conçue pour tourner comme **Artifact Claude** : elle utilise les
capacités `window.claude.use("db")` (stockage partagé des évaluations, mesures,
historique) et `window.claude.use("downloads")` (export de la déclaration) qui
n'existent que dans l'environnement d'exécution des Artifacts sur claude.ai.

Si vous ouvrez `index.html` directement dans un navigateur (ou via GitHub Pages), ces
capacités ne sont pas disponibles : l'application affiche un message
« stockage indisponible » et fonctionne uniquement en lecture (pas de sauvegarde des
évaluations, pas d'export). Ce dossier sert donc de **sauvegarde / versioning du code
source** de la version Artifact, pas d'hébergement de la version fonctionnelle.

Pour republier une version fonctionnelle après modification du code, republiez les
fichiers via l'outil Artifact de Claude (Claude Sonnet, Cowork).

Structure :

- `index.html` — structure de la page et styles (aucune balise `<!doctype>`/`<html>`/
  `<head>`/`<body>` : le fichier est écrit pour être injecté par l'outil Artifact, qui
  ajoute lui-même le squelette de page).
- `app.js` — logique applicative (moteur de score RGESN, modules dashboard / mesure
  technique / déclaration / marchés publics).
- `criteria-data.js` — les 78 critères RGESN 2024 (ID, thématique, libellé, priorité,
  pondération, applicabilité par défaut, moyen de test), extraits du tableur officiel
  `rgesn_2024_outil_declaration_ecoconception.ods`.
- `cctp-data.js` — table de correspondance (heuristique, non officielle) entre les
  thématiques RGESN et les familles usuelles de critères RSE des marchés publics.

## Dossier `vercel/` — déploiement autonome (Vercel + Postgres)

Version pleinement fonctionnelle, indépendante de claude.ai, déployable sur Vercel avec
une vraie persistance des données. `app.js`, `criteria-data.js` et `cctp-data.js` sont
des copies **identiques** à celles du dossier racine (aucune logique métier dupliquée ou
réécrite) ; seule la couche de stockage change.

- `index.html` — même page, mais en document HTML complet autonome (doctype/head/body),
  chargeant `vercel-polyfill.js` avant `app.js`.
- `vercel-polyfill.js` — remplace `window.claude.use("db"/"downloads")` : la même
  interface (`doc()/collection()/get()/set()/onSnapshot()/add()/orderBy()`, `save()`)
  mais adossée à `/api/db/[...path].js` (rafraîchissement par sondage léger, 4s, au lieu
  d'un vrai flux temps réel — la seule différence fonctionnelle avec la version
  Artifact) ; l'export de déclaration déclenche un vrai téléchargement navigateur.
- `api/db/[...path].js` — fonction serverless Node qui expose ce même modèle
  document/collection au-dessus d'une table Postgres unique
  (`documents(path TEXT PRIMARY KEY, data JSONB, updated_at)`), créée automatiquement
  au premier appel.
- `package.json` — dépendance unique : `pg`.
- `.env.example` — variable requise : `DATABASE_URL` (à définir dans les variables
  d'environnement du projet Vercel, jamais commitée).

Déploiement (CLI, non interactif) :

```
cd vercel
vercel --token <TOKEN> link --yes
vercel --token <TOKEN> env add DATABASE_URL production   # coller l'URL Postgres
vercel --token <TOKEN> deploy --prod
```

Une base Postgres est nécessaire (Vercel Storage → Postgres/Neon, Supabase, ou toute
base Postgres accessible publiquement) : son URL de connexion devient `DATABASE_URL`.

Validé par des tests d'intégration réels (Postgres local + Playwright) avant tout
déploiement : persistance d'une évaluation de critère et d'un relevé de mesure après
rechargement complet de la page, export de déclaration.

## Référentiel

Référentiel général de l'écoconception des services numériques (RGESN), version 2024 —
Arcep, Arcom, ADEME, DINUM, CNIL, Inria.
