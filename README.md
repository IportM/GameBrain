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

## 4. Lancer le site

```bash
npx --yes pnpm@10 run dev --host 127.0.0.1 --port 5173
```

Garder ce terminal ouvert. Ouvrir [http://127.0.0.1:5173/](http://127.0.0.1:5173/).
Si le terminal annonce un autre port, utiliser l'adresse qu'il affiche.

Le site vérifie l'installation avant de s'ouvrir :
- Python ou bibliothèques absents : fenêtre de diagnostic avec les éléments manquants.
- Un Python compatible déjà complet est trouvé : ouverture normale du site.

Le site ne les installe pas automatiquement et ne modifie pas les installations existantes.
Si un Python compatible contient déjà les bibliothèques, aucun nouvel environnement
ni réinstallation n'est nécessaire.

Pour arrêter le site : `Ctrl+C` dans ce terminal.

## 5. Réutiliser un Python déjà installé

Le site recherche un Python 3.12 en 64 bits dans l'environnement du projet,
les environnements virtuels ou Conda actifs et le `PATH`. Il ne parcourt pas tout le disque.
Lancer le site depuis un terminal où votre environnement habituel est activé suffit
si ce Python contient toutes les bibliothèques requises.

Si ce Python n'est pas détecté, indiquer son chemin avant de relancer le site :

```bash
# Mac / Linux
export GAMEBRAIN_PYTHON="/chemin/vers/python"
```

```powershell
# Windows PowerShell
$env:GAMEBRAIN_PYTHON = "C:\chemin\vers\python.exe"
```

Puis exécuter la commande de lancement de l'étape 4. Ne pas lancer `setup`
si cet environnement est déjà complet. Toutes les bibliothèques doivent être
utilisables par ce même Python ; ANTs en ligne de commande seul ne suffit pas.

## 6. Installer les bibliothèques uniquement si nécessaire

Python 3.12 en 64 bits est requis pour les calculs.
Sur Mac, si Python 3.12 est absent, l'installer avec [uv](https://docs.astral.sh/uv/guides/install-python/), sans avoir besoin de Homebrew :

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv python install 3.12
python3.12 --version
```

Sous Linux, installer aussi le support `venv` de Python 3.12 et OpenMP (`libgomp1` sur Debian/Ubuntu).

Une fois le site arrêté, depuis `web` :

```bash
npx --yes pnpm@10 run setup
npx --yes pnpm@10 run doctor
npx --yes pnpm@10 run dev --host 127.0.0.1 --port 5173
```

Par défaut, `setup` crée l'environnement Python du projet et installe ses bibliothèques.
Si `GAMEBRAIN_PYTHON` est défini, `setup` installe dans ce Python à la place :
ne pas l'utiliser sur un environnement existant que vous souhaitez laisser inchangé.
Si une étape échoue, conserver son erreur au lieu de passer à la suivante.
La compatibilité des bibliothèques de calcul sur chaque configuration Mac reste à vérifier.
Sur Mac Intel avec macOS 15 ou plus récent, `setup` choisit automatiquement
TensorFlow 2.16.2 et NumPy 1.26.4. Les autres plateformes gardent leurs versions habituelles.
Le chargement et l'extraction doivent encore être validés sur la machine concernée.
[Options pour réutiliser un autre Python](registration/README.md).
