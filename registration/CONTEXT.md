# Contexte : outil de projection de l'atlas Allen

## Besoin

Creer un nouvel outil simple en ligne de commande pour une collegue. L'outil doit :

- recevoir une image anatomique de cerveau de souris en entree, idealement au format NIfTI (`.nii` ou `.nii.gz`) ;
- recevoir un dossier de sortie ;
- recaler l'atlas anatomique Allen sur l'image d'entree ;
- projeter les annotations de l'atlas Allen dans l'espace natif de l'image ;
- permettre ensuite d'utiliser les identifiants et noms des regions Allen sur cette image.

L'interface visee est volontairement simple et ne doit pas imposer une organisation BIDS :

```bash
./map_allen_to_image.sh \
  --input image_souris.nii.gz \
  --output resultats/
```

## Difference avec la pipeline existante

La pipeline `Code_Mouse_Anat_Template` actuelle est concue pour traiter une etude BIDS complete. Elle realise l'extraction cerebrale, le recalage des sujets vers Allen, la creation d'un template de groupe, la projection de cartes quantitatives et l'extraction de statistiques par ROI.

Le nouvel outil repond a un usage plus restreint : une image individuelle en entree et les annotations Allen ramenees dans son espace natif. Il vaut donc mieux creer un point d'entree independant plutot que d'ajouter ce flux dans le pilote BIDS existant.

Le nouvel outil peut toutefois reutiliser les ressources et certaines logiques de la pipeline existante.

## Ressources Allen disponibles dans l'ancien depot

- `resources/100_AMBA_ref.nii.gz` : image anatomique Allen a 100 micrometres ;
- `resources/100_AMBA_LR.nii.gz` : annotations Allen avec distinction gauche/droite ;
- `resources/allen_labels_table.csv` : correspondance entre identifiants et noms des regions.

Dans le nouveau dossier, il faudra soit copier ces ressources, soit permettre de les fournir par options de ligne de commande.

## Traitement envisage

1. Verifier l'image d'entree et ses metadonnees spatiales.
2. Effectuer si necessaire une correction de biais N4 et/ou une extraction cerebrale.
3. Calculer le recalage entre l'atlas Allen et l'image cible avec ANTs, d'abord rigide/affine puis eventuellement SyN.
4. Reechantillonner l'image anatomique Allen dans l'espace de l'image d'entree.
5. Appliquer exactement les memes transformations aux annotations Allen.
6. Utiliser obligatoirement une interpolation `NearestNeighbor` pour les annotations afin de conserver les identifiants entiers des ROI.
7. Produire un controle qualite visuel du recalage.

## Sorties minimales attendues

```text
resultats/
|-- allen_template_in_input_space.nii.gz
|-- allen_labels_in_input_space.nii.gz
|-- transforms/
`-- registration_qc.png
```

Des sorties optionnelles pourront etre ajoutees : image corrigee N4, masque cerebral, table des regions presentes et statistiques par ROI.

## Decisions a prendre au debut du developpement

- confirmer le contraste et la resolution habituels des images d'entree ;
- determiner si les images sont deja extraites du crane ;
- choisir entre recalage affine seul et recalage deformable SyN par defaut ;
- decider si l'outil doit utiliser directement les executables ANTs ou ANTsPy ;
- definir si les ressources Allen sont embarquees ou passees en arguments ;
- definir les controles qualite et les tests sur une image representative.

## Point critique

Le sens des transformations doit etre teste explicitement. Le resultat final recherche est un volume d'annotations dont la grille, les dimensions, l'affine NIfTI et l'espace physique correspondent a l'image d'entree. Les labels ne doivent jamais etre interpoles avec une methode continue.

## Jeu de comparaison local

Un jeu local non versionne contient plusieurs sessions de validation, leurs
RARE extraites, les anciennes sorties SyN dans l'espace Allen et les labels
Allen ramenes dans l'espace natif. Ces donnees servent uniquement aux controles
locaux et restent ignorees par Git.

La reference historique `scr/Allen/LR/100_AMBA_ref.nii.gz` est exactement le
meme CCF Allen que `data-source/allen-multires/average_template_50.nrrd`,
sous-echantillonne a 100 micrometres. Pour retrouver l'ordre des axes du site,
il faut transposer les axes NIfTI `(1, 2, 0)`, puis retourner les deux premiers
axes. La correspondance a ete verifiee voxel par voxel.

Les annotations historiques decrivent la meme partition anatomique que le CCF
du site, mais leurs identifiants sont remappes et la variante `100_AMBA_LR`
separe les hemispheres. Pour l'integration web, utiliser les identifiants Allen
officiels de `annotation_50.nrrd`; pour comparer avec les anciennes sorties,
construire une table de correspondance entre les identifiants historiques et
officiels.

Le recalage complet de reference utilise la RARE extraite comme image mobile et
Allen comme image fixe. Il produit une RARE dans l'espace Allen et doit aussi
conserver les transformations inverses afin de projeter les annotations Allen
dans l'espace natif avec une interpolation `NearestNeighbor`.

Le pipeline portable utilise maintenant ANTsPy sous Windows. Le préréglage
normal est `antsRegistrationSyN[s]` (rigide, affine et SyN) et l'option
`--quick` sélectionne `antsRegistrationSyNQuick[s]`. `prepare_site_atlas.py`
génère à la fois les NIfTI dans l'ordre d'axes du site et une paire dédiée au
recalage. Cette dernière reprend exactement la grille RAS `(114, 132, 80)` de
`100_AMBA_ref` tout en conservant les identifiants Allen officiels. Le gabarit
de recalage obtenu a été vérifié voxel par voxel contre la référence FC3R.

## Demande pour la prochaine conversation

Travailler dans le nouveau dossier choisi par l'utilisateur, examiner son contenu, puis implementer cet outil de bout en bout avec une CLI documentee, une gestion claire des erreurs, des sorties reproductibles et un test sur une image reelle si elle est disponible.
