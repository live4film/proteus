# Proteus

A procedural 3D node editor: build geometry by wiring nodes, then simulate particles, fire, water (with surface meshing and whitewater), sand, cloth, hair, voxels and Voronoi fracture with rigid debris. Includes viewport painting, animated cameras, baking and rendering to PNG / MP4.

## Importing

**File → Import…**, drag-and-drop onto the window, or a **File** node's *Import file…* button:

| Format | Notes |
| --- | --- |
| OBJ | Polygons, lines, vertex colours, groups → piece ids. Numbered files (`name.0001.obj`…) import as one animated sequence. |
| FBX | Meshes with world transforms, materials' colours, skinned and morph animation (sampled per frame). |
| Alembic `.abc` | Ogawa archives: polymeshes, subdivision meshes and points, animated transforms and deformation. |
| Maya nCache | Select the `.xml` and its `.mcc` files together (one file or one file per frame, 32- or 64-bit). Applied to the File node's input geometry. |
| PC2 | Point cache, applied to the input geometry. |
| STL | ASCII or binary. |

Imported data is kept in the browser's storage and embedded in saved scenes.

## Layout

| Path | What it is |
| --- | --- |
| `web/` | The app: `engine.js` (geometry + simulation, also runs in a Web Worker), `importers.js` (OBJ, Alembic, nCache, PC2, STL readers), `ui.js` (viewport, network editor, panels, FBX import), `shell.html`. `python web/build.py` writes the single-file app to `web/dist/index.html`. |
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
