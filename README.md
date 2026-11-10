# Proteus

A procedural 3D node editor: build geometry by wiring nodes, then simulate particles, fire, water (with surface meshing and whitewater), sand, cloth, hair, voxels and Voronoi fracture with rigid debris. Includes viewport painting, animated cameras, baking and rendering to PNG / MP4.

## Layout

| Path | What it is |
| --- | --- |
| `web/` | The app: `engine.js` (geometry + simulation, also runs in a Web Worker), `ui.js` (viewport, network editor, panels), `shell.html`. `python web/build.py` writes the single-file app to `web/dist/index.html`. |
| `desktop/` | Electron shell for Windows: native Save dialogs, menu bar, offline copies of three.js, mp4-muxer and fonts. |
| `.github/workflows/windows.yml` | Builds the Windows installer on GitHub's Windows machines, then installs it, runs a self-test, and uninstalls it. |

## Windows installer

Every push to `main` runs the **Windows installer** workflow. Download the installer from the run's **Artifacts** (`Proteus-Setup`). The `selftest` artifact holds a screenshot taken by the installed app.

To publish a release with the installer attached, push a version tag:

```
git tag v1.0.0
git push origin v1.0.0
```

## Building locally

```
python web/build.py
cd desktop
npm install
python scripts/prepare.py
npm start                 # run the desktop app
npm run dist:win          # build the installer (on Windows)
```

The installer is not code-signed, so Windows SmartScreen will warn on first run (More info → Run anyway).
