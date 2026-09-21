# Mesure Écoconception

Outil de pilotage RGESN 2024 pour le secteur public : auto-évaluation des 78 critères
officiels, mesure d'empreinte carbone (GES, énergie, eau bleue, ressources abiotiques),
génération de déclaration d'écoconception et aide à la valorisation RSE dans les
marchés publics.

Version en ligne (fonctionnelle, avec sauvegarde des données) :
https://claude.ai/artifact/KYPYGwYBtmk3hdvP11vyie

## ⚠️ Important — ce repo contient le code source, pas une version déployable telle quelle

Cette application est conçue pour tourner comme **Artifact Claude** : elle utilise les
capacités `window.claude.use("db")` (stockage partagé des évaluations, mesures,
historique) et `window.claude.use("downloads")` (export de la déclaration) qui
n'existent que dans l'environnement d'exécution des Artifacts sur claude.ai.

Si vous ouvrez `index.html` directement dans un navigateur (ou via GitHub Pages), ces
capacités ne sont pas disponibles : l'application affiche un message
« stockage indisponible » et fonctionne uniquement en lecture (pas de sauvegarde des
évaluations, pas d'export). Ce repo sert donc de **sauvegarde / versioning du code
source**, pas d'hébergement de la version fonctionnelle.

Pour republier une version fonctionnelle après modification du code, republiez les
fichiers via l'outil Artifact de Claude (Claude Sonnet, Cowork).

## Structure

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

## Référentiel

Référentiel général de l'écoconception des services numériques (RGESN), version 2024 —
Arcep, Arcom, ADEME, DINUM, CNIL, Inria.
