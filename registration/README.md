============================================================
 Guide d'utilisation des outils de recalage Allen
============================================================

PRÉREQUIS :
------------
Avant d'exécuter les outils, placez-vous dans le dossier "Recallage_Allen".
Les images d'un même sujet doivent utiliser le même nom de sujet.
Conserver les MESE et les UNIT1 pour les cartes T1map et T2map.
Les modèles d'extraction cérébrale sont fournis dans le cache partagé
"resources/antsxnet". Aucun téléchargement individuel n'est nécessaire.

COMMANDES :
------------

▶ Recalage d'Allen sur une RARE :
----------------------------------
Utilisez la commande suivante :

    ./src/map_allen_to_rare.sh --input SUJET_RARE.nii.gz --output results/all_rares_affine/SUJET_RARE

Explication :
- SUJET_RARE.nii.gz : image RARE originale du sujet
- Le dossier de sortie recevra la RARE extraite, Allen et les labels recalés

▶ Extraction des statistiques d'une carte quantitative :
----------------------------------------------------------
Utilisez la commande suivante après le recalage de la RARE :

    ./src/map_labels_to_quantitative.sh --input CARTE.nii.gz --label LABELS.nii.gz --output DOSSIER_SORTIE

Explication :
- CARTE.nii.gz : carte T1, T2, T2*, UNIT1 ou MESE du sujet
- LABELS.nii.gz : labels Allen créés par le premier outil (dans Recallage_Allen/results/all_rares_affine/Nom de la souris/allen_labels_in_input_space.nii.gz)
- DOSSIER_SORTIE : dossier qui recevra l'image réorientée (carte T1 ou T2 ou T2*) et le fichier de statistiques TSV

En mode automatique, la RARE extraite doit rester dans le même dossier que les labels.
Ce dossier peut être déplacé et rangé librement.

Le fichier TSV contient le même nom anatomique pour les deux identifiants d'une
région bilatérale et une colonne "side" valant "left" ou "right". Par exemple,
les labels 3 et 2003 sont tous les deux nommés AAA, respectivement à gauche et
à droite. Les paires gauche/droite sont complétées même lorsque l'atlas source
ne contient qu'un côté : les cinq contreparties gauches des structures médianes
rangées dans la moitié droite sont donc ajoutées avec des valeurs "n/a". Chaque
TSV contient ainsi 669 lignes "left" et 669 lignes "right". Si une région est
absente après recalage, son nombre de voxels et ses statistiques valent "n/a".
Pour une MESE, le fichier contient une ligne par région et par écho.

Si les flips ont déjà été réalisés avec MRtrix, utilisez cete ligne de commande :

    ./src/map_labels_to_quantitative.sh --input CARTE.nii.gz --label LABELS.nii.gz --output DOSSIER_SORTIE --geometry-done

Dans ce cas, l'image n'est pas modifiée et seul le fichier de statistiques TSV est créé.

REMARQUE :
----------
Le premier outil doit être exécuté avant le second pour chaque nouvelle RARE.
Les outils refusent d'écraser une sortie existante, sauf avec l'option "--force".

INTÉGRATION GAMEBRAIN :
-----------------------
Le point d'entrée portable du projet est désormais :

    python src/map_allen_to_image.py --input SUJET_RARE.nii.gz --output results/SUJET

Il n'utilise plus de chemin d'environnement Python codé en dur. Les commandes
Le recalage utilise désormais ANTsPy directement. Il fonctionne donc dans
l'environnement Python Windows du projet sans exiger les exécutables ANTs dans
le `PATH`. L'option `--brain-extracted` permet d'ignorer ANTsXNet lorsque
l'image fournie est déjà extraite du crâne.

Le traitement complet effectue un recalage rigide, affine puis déformable SyN
de la souris vers Allen. Il conserve la transformation affine, le champ de
déformation et son inverse dans `transforms/`. Le manifeste
`registration_manifest.json` décrit les deux espaces et l'ordre des
transformations.

ENVIRONNEMENT D'EXÉCUTION :
--------------------------
Le pipeline utilise un environnement indépendant de l'environnement BrainGlobe :

```powershell
.\.venv-registration\Scripts\python.exe -m pip install -r .\registration\requirements.txt
.\.venv-registration\Scripts\python.exe .\registration\src\prepare_site_atlas.py
```

L'atlas préparé est le CCF Allen 2017 du site, ramené à 100 micromètres pour
réduire le temps de calcul. Il conserve les identifiants Allen officiels.

Pour tester une image déjà extraite du crâne :

```powershell
.\registration\run_registration_test.ps1 -InputImage "D:\donnees\souris_RARE.nii.gz"
```

Cette commande utilise le préréglage SyN rapide. Pour le calcul complet :

```powershell
.\registration\run_registration_test.ps1 -InputImage "D:\donnees\souris_RARE.nii.gz" -Full
```

En cas de nouvel essai dans un dossier existant, ajouter `-Force`. Le résultat
à regarder en premier est `registration_qc.png` : Allen apparaît en vert et la
souris recalée en magenta. Un bon alignement tend vers du blanc.

Les principales sorties sont :

- `input_in_allen_space.nii.gz` : souris recalée dans l'espace du site ;
- `allen_template_in_input_space.nii.gz` : Allen ramené dans la souris ;
- `allen_labels_in_input_space.nii.gz` : régions Allen dans la souris ;
- `transforms/` : transformations directes et inverses ;
- `registration_manifest.json` : géométrie et fichiers produits.

Pour une image qui contient encore le crâne, installer les dépendances
supplémentaires de `requirements-extraction.txt`. À terme, le serveur du site
exécutera ce même pipeline et le navigateur ne recevra que les résultats.
