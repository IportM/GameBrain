# GameBrain

Visualiseur web de l'Allen Mouse Brain Atlas avec une vue 3D interactive et des
coupes coronales, sagittales et axiales en 10, 25 et 50 um.

## Cloner et lancer l'application

Prérequis : Node.js 20 ou plus récent. Après avoir cloné le dépôt :

```powershell
cd GameBrain\web
corepack enable
pnpm install
pnpm run dev -- --host 127.0.0.1 --port 5173
```

Ouvrir ensuite `http://127.0.0.1:5173/` dans le navigateur.

Les coupes Allen, les annotations et les maillages 3D nécessaires à la
visualisation sont inclus dans le dépôt.

## Fonctions scientifiques locales

L'import NIfTI, l'extraction cérébrale, le recalage Allen, les modalités et les
exports régionaux utilisent Python. Depuis la racine du dépôt :

```powershell
py -3.11 -m venv .venv-registration
.\.venv-registration\Scripts\python.exe -m pip install --upgrade pip
.\.venv-registration\Scripts\python.exe -m pip install -r .\registration\requirements.txt
```

Pour extraire automatiquement un cerveau depuis une image contenant encore le
crâne, installer également :

```powershell
.\.venv-registration\Scripts\python.exe -m pip install -r .\registration\requirements-extraction.txt
```

Les gabarits Allen et les modèles d'extraction utilisés par l'application sont
présents dans `registration/resources`. Le téléchargement des expériences de
connectivité nécessite une connexion à l'API Allen.

## Sécurité

Le serveur Vite inclut une API de développement capable d'exécuter les outils
Python locaux et de gérer les résultats présents sous `registration/`. Cette
API refuse les requêtes qui ne proviennent pas de la boucle locale. Ne lancez
pas ce prototype avec une adresse réseau publique et ne déployez pas
`vite.config.ts` comme serveur de production.

Une mise en ligne publique devra utiliser un service séparé avec
authentification, limites d'envoi, stockage isolé et file de calcul. Les images
NIfTI, modèles, environnements, caches et résultats locaux sont exclus de Git.

## Données locales

Les données personnelles et les résultats de calcul ne sont jamais versionnés :

- `registration/imports` : images NIfTI importées et recalages ;
- `registration/connectivity` : expériences téléchargées et projections natives ;
- `data-source` : volumes sources servant à régénérer les ressources Allen ;
- `.venv-registration` et `.venv-brainglobe` : environnements Python locaux.

Ces emplacements restent exclus par `.gitignore`. Les scripts
`export_web_mesh.py`, `export_web_slice.py`, `export_detailed_annotations.py` et
`export_detailed_meshes.py` permettent de reconstruire les ressources web à
partir d'une copie locale de l'atlas.

## Organisation

- `web/src/App.tsx` : interface et orchestration de la vue 3D ;
- `web/src/atlas.ts` : régions, résolutions et transformations anatomiques ;
- `web/src/InteractiveSlice.tsx` : interaction avec les coupes 2D ;
- `legacy/napari` : ancien prototype de bureau conservé comme archive ;
- `registration` : pipeline local de recalage d'une image NIfTI vers Allen ;
- `PROJECT_CONTEXT.md` : historique fonctionnel et prochaines étapes.
