/*
 * Grille d'aide à la valorisation RSE / écoconception dans les marchés publics.
 *
 * Il n'existe pas de grille officielle unique : chaque CCTP / RC rédige ses
 * propres critères RSE. Cette table est une correspondance-type, construite
 * par recoupement des formulations les plus fréquemment rencontrées dans les
 * mémoires techniques et actes d'engagement RSE des marchés publics numériques
 * français, à adapter au libellé exact de chaque consultation. Elle sert de
 * point de départ pour retrouver rapidement quels critères RGESN validés
 * apportent une preuve à quelle rubrique de notation RSE — jamais une
 * citation littérale d'un CCTP réel.
 */
const CCTP_FAMILIES = [
  {
    id: "sobriete",
    label: "Sobriété numérique et écoconception de la solution",
    wording: "Ex. : « Démarche d'écoconception mise en œuvre sur la solution (conception, architecture, frontend, backend) » / « Mesures de sobriété numérique »",
    themes: [1, 2, 3, 6, 7],
  },
  {
    id: "hebergement",
    label: "Empreinte environnementale et hébergement responsable",
    wording: "Ex. : « Politique d'hébergement responsable, efficacité énergétique des datacenters, mix électrique » / « Trajectoire de réduction des émissions de GES »",
    themes: [8],
  },
  {
    id: "accessibilite",
    label: "Accessibilité, inclusion numérique et compatibilité des terminaux",
    wording: "Ex. : « Accessibilité numérique (RGAA) et allongement de la durée de vie des terminaux » / « Compatibilité avec des équipements anciens »",
    themes: [2, 4],
  },
  {
    id: "donnees",
    label: "Gestion responsable des données et protection de la vie privée",
    wording: "Ex. : « Sobriété et protection des données (RGPD) » / « Minimisation de la collecte de données »",
    themes: [1],
  },
  {
    id: "gouvernance",
    label: "Gouvernance RSE, pilotage et amélioration continue",
    wording: "Ex. : « Référent RSE / écoconception désigné » / « Trajectoire d'amélioration continue et reporting »",
    themes: [1],
  },
  {
    id: "algorithmie",
    label: "Sobriété algorithmique et IA frugale",
    wording: "Ex. : « Frugalité des traitements algorithmiques / IA » (pertinent pour les lots comportant de l'IA ou du machine learning)",
    themes: [9],
  },
];
