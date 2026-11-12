# GameBrain

## Prérequis

Git, Node.js 22.12+, pnpm 10+ et Python 3.12 (64 bits).
Sous Linux : support `venv` de Python 3.12 et OpenMP (`libgomp1` sous Debian/Ubuntu).

## Lancer le site

```bash
git clone --depth 1 https://github.com/IportM/GameBrain.git
cd GameBrain/web
pnpm install
pnpm run setup
pnpm run dev --host 127.0.0.1 --port 5173
```

Ouvrir [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

`setup` installe les bibliothèques Python une fois par machine. Internet est nécessaire pour l'installation et les expériences Allen.

En cas de problème : `pnpm run doctor`. [Options Python](registration/README.md).
