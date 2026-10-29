# GameBrain

Visualiseur web de l'Allen Mouse Brain Atlas avec une vue 3D interactive et des
coupes coronales, sagittales et axiales en 10, 25 et 50 um.

## Lancer l'application

Depuis le dossier `web` :

```powershell
npm install
npm run dev
```

Vite affiche ensuite l'adresse locale à ouvrir dans le navigateur.

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

Les volumes Allen sources, les environnements Python et les exports web sont
volumineux et ne sont pas versionnés. L'application attend les ressources
générées dans :

- `web/public/atlas/regions` pour les maillages 3D ;
- `web/public/atlas/slices/<resolution>` pour les images et masques 2D.

Les scripts `export_web_mesh.py` et `export_web_slice.py` servent à reconstruire
ces ressources depuis les données locales de l'atlas.

## Organisation

- `web/src/App.tsx` : interface et orchestration de la vue 3D ;
- `web/src/atlas.ts` : régions, résolutions et transformations anatomiques ;
- `web/src/InteractiveSlice.tsx` : interaction avec les coupes 2D ;
- `legacy/napari` : ancien prototype de bureau conservé comme archive ;
- `registration` : pipeline local de recalage d'une image NIfTI vers Allen ;
- `PROJECT_CONTEXT.md` : historique fonctionnel et prochaines étapes.
