# GameBrain

## 1. Prérequis

- Git et [Node.js LTS](https://nodejs.org/en/download) (22.12 minimum, avec npm).
- Python **3.12 en 64 bits**. Sur Mac Intel : macOS 15 minimum.
- Internet pour l'installation et les expériences Allen.

Inutile d'installer pnpm séparément : les commandes utilisent `npx`.
Sous Linux, prévoir aussi le support `venv` de Python 3.12 et `libgomp1` (Debian/Ubuntu).

<details>
<summary>Installer Python 3.12 sur Mac s'il est absent</summary>

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv python install 3.12
python3.12 --version
```

</details>

## 2. Installation

Exécuter chaque ligne séparément et attendre sa fin. Si le projet est déjà cloné,
se placer dans `GameBrain/web` et commencer à `npx`.

```bash
git clone --depth 1 https://github.com/IportM/GameBrain.git
cd GameBrain/web
npx --yes pnpm@10 install
npx --yes pnpm@10 run setup
npx --yes pnpm@10 run doctor
```

Par défaut, `setup` crée l'environnement Python du projet et installe les bibliothèques nécessaires.
Si une commande échoue, conserver son erreur et ne pas passer à la suivante.

## 3. Lancement

Depuis `GameBrain/web` :

```bash
npx --yes pnpm@10 run dev --host 127.0.0.1 --port 5173
```

Ouvrir [http://127.0.0.1:5173/](http://127.0.0.1:5173/) (ou l'adresse annoncée par le terminal).
Garder le terminal ouvert ; **Ctrl+C** arrête le site. Pour les lancements suivants, cette étape suffit.

**Option avancée :** pour réutiliser un Python déjà complet sans `setup`, voir les [options Python](registration/README.md).
