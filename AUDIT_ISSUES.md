# Audit des problèmes et améliorations

Cette liste sert à vérifier les problèmes avant de les corriger. Les éléments marqués **à confirmer** doivent être reproduits dans un navigateur classique avant d'être considérés comme des bugs certains.

## 1. Erreur résiduelle dans le menu Connectivité

**État : confirmé**

### Reproduction

1. Ouvrir `Connectivité`.
2. Choisir `Par identifiant`.
3. Saisir `abc`, `-1` ou un identifiant beaucoup trop long.
4. Cliquer sur `Charger`.
5. Passer dans `Par région`.
6. Rechercher `VISp`.

### Observé

- Les 24 expériences VISp apparaissent correctement.
- L'ancien message « Saisissez un identifiant d'expérience Allen valide » reste affiché.
- L'état général peut également rester sur `ÉCHEC`.

### Attendu

- L'erreur de l'onglet `Par identifiant` disparaît en changeant de méthode.
- Une recherche réussie remet l'état sur `PRÊT` ou `TERMINÉ`.

## 2. Métadonnées de connectivité bloquées

**État : confirmé**

### Reproduction

1. Charger l'expérience `100140756`.
2. Afficher la carte.
3. Déplier les paramètres de connectivité.
4. Attendre quelques secondes ou recharger la page.

### Observé

- Le texte « Métadonnées anatomiques en cours de récupération… » reste affiché indéfiniment.
- La carte peut fonctionner malgré cela.

### Attendu

- Les métadonnées anatomiques sont affichées.
- En cas d'échec, un état explicite comme « Métadonnées indisponibles » remplace le chargement permanent.

## 3. Réglages d'une modalité encore visibles dans Allen

**État : confirmé**

### Prérequis

Une RARE et au moins une modalité complémentaire doivent être importées.

### Reproduction

1. Passer sur `Image importée`.
2. Sélectionner une modalité complémentaire, par exemple une T1 map.
3. Vérifier que les réglages `Min`, `Max`, `Palette` et `Inverser` sont affichés.
4. Revenir sur `Allen`.

### Observé

- Les réglages de la modalité peuvent rester visibles dans la vue Allen.
- Ils ne correspondent pas à l'image Allen affichée.

### Attendu

- Ces réglages sont uniquement visibles sur `Image importée` lorsqu'une modalité est active.

## 4. Interface trop large selon la fenêtre

**État : à confirmer dans un navigateur classique**

### Reproduction

1. Ouvrir le site dans un navigateur normal.
2. Tester approximativement en `1280 × 720`, puis `1366 × 768`.
3. Importer une image et sélectionner une modalité.
4. Activer la connectivité.
5. Déplier les réglages de connectivité.
6. Vérifier les contrôles en haut et dans le panneau droit.

### Éléments à surveiller

- Boutons `Connectivité` et `Revenir à zéro`.
- Boutons `Régions` et `Masque`.
- Onglet `Axiale`.
- Sliders d'opacité et de seuil.
- Réglages `Inverser` et `Réinitialiser`.

### Problème possible

- Certains contrôles sortent à droite, disparaissent ou compressent excessivement la coupe.
- Pendant l'audit dans le navigateur intégré, avec une T1 map active, le bouton `Masque` était tronqué sur le bord droit (`Masqu…`) à une largeur proche de 1280 px.
- Ce constat doit encore être vérifié dans un navigateur classique, car la largeur utile du navigateur intégré peut différer.

### Attendu

- Tous les contrôles restent accessibles sans défilement horizontal.
- La coupe conserve une taille utilisable.

## 5. Chargement d'une connectivité potentiellement bloqué

**État : à reproduire sur la machine de l'utilisateur**

### Reproduction

1. Partir sans connectivité active.
2. Ouvrir `Connectivité`.
3. Choisir `Par identifiant`.
4. Charger `100140756`.
5. Chronométrer le chargement.
6. Observer si l'interface reste sur le téléchargement des trois cartes.

### Observé pendant l'audit

- Le chargement est resté bloqué plus d'une minute.
- Le bouton `Fermer` masquait la fenêtre, mais il n'existait pas de véritable annulation.
- Le serveur est ensuite devenu inaccessible.

### Points à vérifier

- Le problème peut venir de l'environnement d'audit ou du réseau Allen.
- Vérifier si le site reste fonctionnel après avoir fermé la fenêtre.
- Vérifier si le chargement finit réellement en arrière-plan.

### Attendu

- Un délai maximal et un message d'erreur compréhensible sont prévus.
- Un véritable bouton d'annulation est disponible.
- Le serveur ne devient pas inaccessible.

## 6. Mauvaise description des coupes importées

**État : confirmé, priorité faible**

### Reproduction

1. Importer une RARE.
2. Passer sur `Image importée`.
3. Inspecter la description d'accessibilité de l'image avec les outils du navigateur ou un lecteur d'écran.

### Observé

- La coupe peut être décrite comme provenant de « l'atlas Allen ».
- La résolution annoncée peut être `25 µm` lorsque l'image native indique par exemple `104 µm`.
- Dans la vue Allen, la description continue d'indiquer « avec annotations » lorsque le bouton `Régions` est désactivé.

### Attendu

- La description mentionne `image importée` ou `espace natif`.
- La résolution native correcte est indiquée.
- La présence ou l'absence d'annotations décrite correspond à l'état réel du bouton `Régions`.

Ce problème n'est normalement pas visible directement à l'écran.

## 7. Chemins personnels présents dans Git

**État : confirmé**

### Fichier concerné

`registration/resources/site_allen_ccf2017_100um.json`

### Observé

- Deux chemins contiennent un dossier personnel du type `C:\Users\<utilisateur>\Desktop\...`.

### Risque

- Il ne s'agit ni de clés ni de données médicales.
- Les chemins révèlent le nom du dossier Windows de l'utilisateur.
- Ils ne fonctionneront pas sur l'ordinateur d'un collègue s'ils sont utilisés directement.

### Attendu

- Utiliser des chemins relatifs ou supprimer ces champs du fichier distribué.

## 8. Chargement initial 3D assez lourd

**État : confirmé, optimisation et non bug**

### Vérification

```bash
cd web
pnpm run build
```

### Observé

- La construction fonctionne.
- Le module principal de la scène 3D fait environ `1,04 Mo`, soit environ `288 Ko` compressé.
- Vite affiche un avertissement pour les fichiers dépassant `500 Ko`.

### Conséquence possible

- Le premier affichage peut être plus lent sur une connexion ou une machine modeste.

### Amélioration attendue

- Charger la scène 3D séparément ou découper davantage le code.

## 9. Annotations Allen visibles uniquement à 25 µm

**État : confirmé sur les trois orientations**

### Reproduction

1. Rester dans la vue `Allen`.
2. Activer l'affichage `Régions` sur la coupe.
3. Observer une coupe à la résolution `25 µm`.
4. Passer à `10 µm`, puis à `50 µm`.
5. Tester le comportement sur les coupes coronale, sagittale et axiale.

### Observé

- Les contours ou annotations des régions sont affichés à `25 µm`.
- En `25 µm`, l'activation charge bien une image provenant du dossier `detailed-outlines`.
- En `10 µm` et `50 µm`, activer ou désactiver `Régions` ne change ni l'image ni sa source.
- Le problème est présent en coronale, sagittale et axiale.

### Attendu

- Les annotations Allen sont disponibles et correctement alignées pour les trois résolutions : `10 µm`, `25 µm` et `50 µm`.
- Le changement de résolution conserve l'état du bouton `Régions`.

## 10. Une petite région redevient une grande famille quand la connectivité est chargée

**État : confirmé, régression possible**

### Reproduction

1. Charger l'expérience de connectivité `100140756`.
2. Désactiver le bouton global `Afficher` de la connectivité afin de masquer la carte.
3. Dans la recherche des régions, saisir `barrel field, layer 4`.
4. Cliquer sur `SSp-bfd4`, identifiant `1047`.
5. Lire la fiche de la région sélectionnée dans le panneau gauche.

### Observé

- La fiche affiche `Isocortex`, identifiant `315`.
- La petite région `SSp-bfd4`, identifiant `1047`, n'est donc pas conservée comme sélection active.
- Le problème se produit alors même que l'affichage de la connectivité est désactivé ; il suffit que l'expérience soit chargée.

### Attendu

- La fiche, la surbrillance 2D et la surbrillance 3D correspondent à la région exacte `SSp-bfd4`.
- Le chargement d'une expérience de connectivité ne doit pas modifier le niveau hiérarchique d'une sélection anatomique.

## 11. Le second clic sur une petite région alterne avec sa grande famille

**État : confirmé, régression**

### Reproduction

1. Charger l'expérience de connectivité `100140756` puis masquer son affichage global.
2. Dans la recherche des régions, saisir `VISp`.
3. Cliquer sur `VISp4`, identifiant `721`.
4. Cliquer une seconde fois sur exactement la même ligne.
5. Répéter plusieurs fois le clic.

### Observé

- Le premier clic sélectionne correctement `Primary visual area, layer 4` (`VISp4`, identifiant `721`).
- Le second clic ne retire pas la sélection : la fiche passe à `Isocortex`, identifiant `315`.
- Les clics suivants alternent entre `VISp4` et `Isocortex`.

### Attendu

- Cliquer une seconde fois sur la région déjà sélectionnée retire la sélection et la surbrillance.
- La sélection ne doit jamais remonter silencieusement vers une grande famille anatomique.

## 12. L'export CSV ne respecte pas la région cochée

**État : confirmé**

### Reproduction

1. Importer et recaler une RARE, puis afficher une modalité complémentaire comme `T1map`.
2. Ouvrir `Exporter les valeurs` sans région préalablement sélectionnée.
3. Cocher uniquement la première ligne `TMv — Tuberomammillary nucleus, ventral part`, identifiant `1`.
4. Vérifier que la fenêtre indique `1 région sélectionnée`.
5. Cliquer sur `Exporter le CSV` et ouvrir le fichier généré.

### Observé

- Le CSV généré ne contient pas `TMv` (ID `1`).
- Il contient `SSp-bfd4 — Primary somatosensory area, barrel field, layer 4`, identifiant `1047`.
- Le fichier testé était `gamebrain-sub-08_ses-5_T1map (3).csv`.

### Attendu

- Le CSV contient exactement les régions cochées dans la fenêtre d'export.
- La liste visuelle, le compteur et les données envoyées au serveur doivent partager la même sélection.

## 13. Les actions du menu Image n'ont pas de nom accessible

**État : confirmé, priorité faible**

### Reproduction

1. Importer une image.
2. Ouvrir le menu `Image` dans l'en-tête.
3. Parcourir ses actions avec un lecteur d'écran ou l'arbre d'accessibilité du navigateur.

### Observé

- Les quatre actions visibles sont `Changer d'image`, `Recaler avec Allen`, `Modalités` et `Supprimer l'image`.
- Elles sont exposées comme des boutons sans nom accessible.

### Attendu

- Chaque bouton est annoncé avec le même nom que son libellé visible.
- La navigation au clavier ou au lecteur d'écran permet de distinguer les quatre actions.

## 14. Les prérequis du README ne garantissent pas la présence de Corepack

**État : confirmé avec Node.js 24.22.1**

### Reproduction

1. Utiliser une installation récente de Node.js sans Corepack préinstallé.
2. Suivre le README jusqu'à la commande `corepack enable`.

### Observé

- La commande échoue avec « `corepack` n'est pas reconnu ».
- Le README demande seulement `Node.js 20 ou plus récent` et ne mentionne pas l'installation séparée de `pnpm`.
- L'installation fonctionne ensuite avec `pnpm install` lorsque pnpm est déjà installé.

### Attendu

- Les prérequis indiquent explicitement une version compatible de Node avec Corepack, ou demandent l'installation de pnpm.
- Les commandes de démarrage fonctionnent aussi avec les versions récentes de Node où Corepack n'est plus fourni.

## 15. La commande de démarrage du README ne transmet pas le port à Vite

**État : confirmé avec pnpm 11.25.0 sous Windows**

### Reproduction

1. Installer les dépendances dans une copie propre.
2. Exécuter exactement `pnpm run dev -- --host 127.0.0.1 --port 5173`.
3. Lire la commande et l'adresse affichées par Vite.

### Observé

- pnpm lance `vite "--" "--host" "127.0.0.1" "--port" "5173"`.
- Le séparateur `--` est transmis à Vite et les options suivantes ne sont pas appliquées correctement.
- La syntaxe `pnpm run dev --host 127.0.0.1 --port 5175` a correctement ouvert `http://127.0.0.1:5175/`.

### Attendu

- La commande documentée transmet effectivement l'hôte et le port demandés.
- Le README utilise une syntaxe vérifiée avec la version de pnpm recommandée.

## 16. Le dépôt est très lourd à cloner

**État : confirmé**

### Vérification

1. Cloner localement le dépôt suivi par Git, sans réutiliser le dossier de travail.
2. Exécuter `git ls-files` et mesurer la taille de la copie avant ou après installation.

### Observé

- Le dépôt suit `13 978` fichiers.
- `13 904` de ces fichiers se trouvent dans `web/public`.
- `web/public` représente environ `329 Mo` dans la copie testée.
- Les objets Git représentent environ `489 Mo` supplémentaires dans cette copie locale.
- Après installation et construction, la copie de test occupait environ `1,4 Go`.

### Conséquence

- Le premier clonage et l'installation seront longs pour un collègue ou sur une connexion modeste.
- L'historique Git conserve une quantité importante de ressources binaires.

### Amélioration attendue

- Identifier les ressources réellement nécessaires au site.
- Envisager Git LFS, des archives versionnées séparément ou un téléchargement de ressources au premier lancement.
- Nettoyer l'historique uniquement après sauvegarde et coordination avec les autres utilisateurs du dépôt.

## 17. Une interruption du recalage fait perdre l'import tout en laissant ses fichiers sur le disque

**État : confirmé**

### Reproduction

1. Partir de l'état initial et importer `sub-08_ses-1_RARE.nii.gz`.
2. Ouvrir `Image`, puis `Recaler avec Allen`.
3. Cliquer sur `Lancer le recalage` et attendre l'état `EN COURS`.
4. Recharger simplement la page : vérifier que le menu indique encore `Recalage Allen en cours`.
5. Pendant que les processus Python de recalage fonctionnent, arrêter complètement le serveur local.
6. Redémarrer le serveur et rouvrir le site.

### Observé

- Un simple rechargement de page conserve correctement l'état `Recalage Allen en cours`.
- Après une coupure complète du serveur, le site revient à l'état initial avec le bouton `Importer une image`.
- La RARE précédemment importée n'est plus accessible dans l'interface.
- Son dossier reste pourtant dans `registration/imports`.
- Le dossier du test contenait `1 446` fichiers et environ `14,7 Mo`, dont des résultats web et des transformations partielles.

### Attendu

- Après redémarrage, l'application détecte le calcul interrompu et conserve au minimum l'image native importée.
- L'état est présenté comme `Interrompu` ou `Échec`, avec la possibilité de relancer le recalage.
- Les sorties temporaires incomplètes sont supprimées ou clairement identifiées.
- Aucun dossier orphelin ne reste invisible dans l'interface.

# Optimisations techniques futures

Ces éléments ne sont pas nécessairement des bugs. Ils sont conservés ici pour organiser les prochaines phases d'optimisation.

## O1. Isoler les sessions avant une publication multi-utilisateur

**Priorité : critique avant publication**

- Le serveur conserve actuellement une image, une connectivité et un ensemble de caches globaux.
- Deux utilisateurs simultanés pourraient remplacer leurs données respectives.
- Prévoir un identifiant de session, des dossiers isolés, une file de calcul et une politique d'expiration.

## O2. Externaliser les ressources Allen volumineuses

**Priorité : haute**

- `web/public` contient environ `329 Mo` et près de `14 000` fichiers.
- Les coupes 10 µm représentent environ `195 Mo`.
- Étudier Git LFS, un stockage de ressources séparé, un CDN ou un téléchargement au premier lancement.
- Une migration de l'historique Git devra être préparée avec les collaborateurs.

## O3. Limiter la mémoire du cache des modalités

**Priorité : haute**

- Le serveur garde en mémoire chaque volume de modalité consulté.
- La mémoire peut augmenter avec chaque modalité importée.
- Utiliser un cache LRU limité en taille ou en nombre de volumes.

## O4. Mettre en cache les ressources générées

**Priorité : haute**

- Plusieurs coupes, maillages et volumes sont renvoyés avec `Cache-Control: no-store`.
- Les URL possèdent déjà une révision permettant une invalidation fiable.
- Utiliser un cache HTTP durable pour les ressources terminées et immuables.

## O5. Adapter le préchargement des coupes à la résolution

**Priorité : moyenne à haute**

- Le navigateur peut conserver jusqu'à 72 images décodées.
- En 10 µm, cela peut représenter plusieurs centaines de Mo de mémoire.
- Précharger moins de voisins en 10 µm et ajuster la limite selon la taille réelle des images.

## O6. Adapter la qualité de la connectivité 3D au GPU

**Priorité : moyenne**

- Le rendu volumique effectue actuellement 112 échantillonnages par pixel.
- Prévoir des niveaux de qualité ou un nombre d'étapes adaptatif pendant les mouvements de caméra.
- Restaurer la qualité maximale lorsque la caméra s'immobilise.

## O7. Mettre en cache les statistiques régionales

**Priorité : moyenne**

- Une sélection régionale peut relancer un processus Python pour recalculer les statistiques.
- Mettre en cache les résultats par modalité, région et version des annotations.

## O8. Découper les modules principaux

**Priorité : moyenne**

- `App.tsx` approche 3 000 lignes et `web/server/plugin.ts` dépasse 1 600 lignes.
- Séparer l'import, le recalage, la connectivité, les modalités, les exports et les états associés.
- Cette réorganisation doit être progressive et accompagnée de tests de non-régression.

## O9. Remplacer progressivement le polling

**Priorité : basse à moyenne**

- L'interface interroge les traitements toutes les 1,5 à 2 secondes.
- Des événements serveur permettraient des mises à jour immédiates avec moins de requêtes.

## O10. Verrouiller l'environnement scientifique Python

**Priorité : haute avant déploiement**

- Plusieurs dépendances scientifiques ne sont pas fixées à une version précise.
- Fournir un environnement verrouillé ou une image de conteneur reproductible.
- Enregistrer les versions utilisées avec chaque résultat scientifique.

## O11. Nettoyer les ressources redondantes

**Priorité : basse**

- Douze maillages sont identiques entre `regions` et `detailed-regions`, pour environ 6 Mo.
- Vérifier leurs usages puis conserver une seule copie lorsque cela ne modifie pas le rendu.

## O12. Automatiser les tests de non-régression

**Priorité : haute**

- Couvrir la sélection des régions, les résolutions, les changements de modalité, l'export CSV et les reprises après interruption.
- Ajouter quelques scénarios visuels représentatifs en complément des tests unitaires.

# Améliorations produit futures

## P1. Gestion de projets et historique des analyses

- Permettre de nommer un projet, retrouver une image importée et reprendre une analyse précédente.
- Afficher clairement les recalages, modalités, connectivités et exports associés au projet.

## P2. Contrôle qualité du recalage

- Proposer une vue dédiée comparant l'image native, Allen et leur superposition.
- Permettre de parcourir rapidement plusieurs coupes et de signaler un recalage jugé incorrect.
- Conserver les paramètres et indicateurs de qualité avec le projet.

## P3. Comparaison de modalités

- Comparer deux modalités côte à côte ou avec un séparateur déplaçable.
- Synchroniser orientation, coupe, zoom et région sélectionnée.

## P4. Graphiques des mesures régionales

- Transformer les valeurs déjà exportables en tableaux et graphiques simples.
- Comparer plusieurs régions ou plusieurs modalités avec médiane, dispersion et distribution.
- Garder le CSV comme source exportable de référence.

## P5. Export scientifique reproductible

- Exporter ensemble les valeurs, la version de l'atlas, les paramètres du recalage et les réglages d'affichage.
- Ajouter une capture des vues 2D/3D et un résumé de provenance des données.

## P6. Navigation par étapes

- Clarifier le parcours : import, extraction, recalage, contrôle qualité, modalités, analyse puis export.
- Réduire la densité de l'en-tête en affichant les actions selon l'étape courante.

## P7. Centre des traitements

- Regrouper les imports, recalages et projections en cours dans une même zone.
- Afficher progression, durée, erreurs, relance et annulation sans bloquer le reste de l'interface.

## P8. Validation des données importées

- Présenter avant calcul les dimensions, l'orientation, l'espacement et les avertissements détectés.
- Demander confirmation lorsqu'une image semble incompatible ou très volumineuse.

## P9. Préréglages d'affichage

- Enregistrer les réglages utiles de contraste, palette, opacité, régions et caméra.
- Proposer quelques préréglages sobres adaptés aux coupes, à la connectivité et aux mesures.

## P10. Aide contextuelle et terminologie

- Ajouter des explications courtes pour les notions scientifiques ou techniques peu évidentes.
- Conserver une interface compacte, avec l'aide accessible à la demande plutôt qu'affichée en permanence.

