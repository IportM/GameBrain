# GameBrain

## 1. Vérifier Node.js

Dans le terminal, exécuter chaque ligne séparément :

```bash
node --version
npm --version
```

Node.js 22.12 ou plus récent est requis. Si une commande est introuvable,
installer une version LTS depuis [nodejs.org](https://nodejs.org/en/download),
puis fermer et rouvrir le terminal.

Les commandes ci-dessous utilisent pnpm 10 via `npx` : inutile d'installer pnpm
globalement, Corepack ou d'utiliser `sudo`. Internet est nécessaire.

## 2. Récupérer le projet

Si le dépôt n'est pas encore cloné (Git est requis) :

```bash
git clone --depth 1 https://github.com/IportM/GameBrain.git
cd GameBrain/web
```

Si le projet est déjà cloné, ouvrir simplement un terminal dans son dossier `web`.
Ne pas ajouter de `\` en fin de commande.

## 3. Installer les dépendances du site

```bash
npx --yes pnpm@10 install
```

Cette commande installe les bibliothèques du site, pas les bibliothèques Python.

## 4. Lancer le site sans installer Python ni ses bibliothèques

```bash
npx --yes pnpm@10 run dev --host 127.0.0.1 --port 5173
```

Garder ce terminal ouvert. Ouvrir [http://127.0.0.1:5173/](http://127.0.0.1:5173/).
Si le terminal annonce un autre port, utiliser l'adresse qu'il affiche.

Le site vérifie l'installation avant de s'ouvrir :
- Python ou bibliothèques absents : fenêtre de diagnostic avec les éléments manquants.
- Un Python compatible déjà complet est trouvé : ouverture normale du site.

Pour tester l'oubli des bibliothèques, ne pas exécuter `setup` avant cette étape.
Le site ne les installe pas automatiquement et ne modifie pas les installations existantes.

Pour arrêter le site : `Ctrl+C` dans ce terminal.

## 5. Installer les bibliothèques de calcul, puis relancer

Python 3.12 en 64 bits est requis pour les calculs.
Sur Mac, si Homebrew est déjà installé et Python 3.12 absent :

```bash
brew install python@3.12
python3.12 --version
```

Sans Homebrew : suivre son [installation officielle](https://brew.sh/), puis les deux lignes ci-dessus.
Sous Linux, installer aussi le support `venv` de Python 3.12 et OpenMP (`libgomp1` sur Debian/Ubuntu).

Une fois le site arrêté, depuis `web` :

```bash
npx --yes pnpm@10 run setup
npx --yes pnpm@10 run doctor
npx --yes pnpm@10 run dev --host 127.0.0.1 --port 5173
```

`setup` crée l'environnement Python du projet et installe ses bibliothèques.
Si une étape échoue, conserver son erreur au lieu de passer à la suivante.
La compatibilité des bibliothèques de calcul sur chaque configuration Mac reste à vérifier.
[Options pour réutiliser un autre Python](registration/README.md).

## Test volontaire : bibliothèques manquantes sur Mac

Si un Python complet existe déjà, le site peut le réutiliser. Pour forcer le cas
« bibliothèques oubliées », sans toucher à cet environnement : arrêter le site,
puis, depuis `web` avec Python 3.12 disponible :

```bash
python3.12 -m venv ../.tmp-registration/test-empty-python
GAMEBRAIN_PYTHON="$PWD/../.tmp-registration/test-empty-python/bin/python" npx --yes pnpm@10 run dev --host 127.0.0.1 --port 5173
```

La fenêtre doit lister les bibliothèques manquantes dans ce Python vide.
Le dossier de test est ignoré par Git. Ne pas y lancer `setup` pour ce test.
`Ctrl+C`, puis la commande normale de lancement suffisent pour revenir au fonctionnement habituel :
le choix de ce Python ne s'applique qu'à la commande de test.
