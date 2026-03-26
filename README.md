# grid_chrome_addon

Chrome extension pro overlay 10x5 gridu na beachvolejbalove hriste. Grid se zobrazuje pres video v prohlizeci a umi automaticke namapovani kurtu.

English version is available below.

---

## Jak extension nainstalovat do Chrome

Postup krok za krokem:

1. Klikni na zelene tlacitko `Code`.
2. Vyber `Download ZIP`.
3. Pockej, az se ZIP soubor stahne do pocitace.
4. ZIP soubor rozbal.
5. Otevri Google Chrome.
6. Vpravo nahore klikni na ikonu `Extensions`.
7. Ikona `Extensions` vypada jako maly dil puzzle.
8. Klikni na `Manage extensions` nebo `Spravovat rozsireni`.
9. Vpravo nahore zapni `Developer mode`.
10. Klikni na `Load unpacked` nebo `Nacist rozbalene`.
11. Vyber rozbalenou slozku repozitare.
12. Extension se nacte do Chrome jako nova lokalni extension.

Pokud se extension nacte spravne, uvidis ji v seznamu rozsireni.

Poznamka:

- Pokud budes chtit do README doplnit i screenshoty, staci je ulozit do slozky `images/` a potom je sem muzu dopsat jako obrazky.

---

## Pouziti

Vychozi klavesove zkratky:

| Zkratka | Funkce |
|---|---|
| `Alt+H` | Zobrazit nebo skryt grid |
| `Alt+M` | Automaticky namapovat kurt |
| `Alt+R` | Resetovat grid do stredu obrazovky |
| `Shift` + tazeni | Presunout roh nebo cely grid |
| `Shift` + scroll | Rotovat grid |

Popup extension umoznuje:

- zapnout nebo vypnout grid
- zmenit klavesove zkratky
- upravit seznam webu, na kterych extension funguje
- otevrit Offline Viewer pro lokalni videa

### Offline Viewer

Pokud chces pracovat se stazenym videem offline:

1. Klikni na ikonu extension.
2. Klikni na `Open Offline Viewer`.
3. V nove zalozce klikni na `Choose video`.
4. Vyber lokalni `.mp4` soubor.
5. Pouzij `Show grid`, `Auto-map` nebo klavesove zkratky stejne jako na webu.
6. Pokud chces video zvetsit, pouzij tlacitko `Fullscreen` primo ve vieweru, aby grid zustal viditelny.
7. `Space` prehrava nebo pauzne video, sipky `Left` a `Right` posouvaji video o nastaveny pocet sekund.
8. Pocet sekund pro skok sipkami lze zmenit v popupu extension v sekci `Offline Viewer`.

Poznamka:

- Pri primem otevreni `file://.../video.mp4` v Chrome se extension nechova spolehlive kvuli omezenim Chrome media vieweru.
- Offline Viewer je doporucena cesta pro lokalni videa.

---

## Chovani gridu

- Pri prvnim zobrazeni na zalozce se vytvori vychozi centrovany grid.
- `Alt+M` a `Alt+R` grid zaroven zobrazi, pokud byl skryty.
- Pozice gridu se pamatuje po dobu otevrene zalozky.

---

## Automaticke mapovani

Extension se nejdriv pokusi pouzit YOLOv8 ONNX segmentacni model `models/yolov8s-field-50.onnx`.

- Z masky hriste odhadne rohy kurtu.
- Pokud modelova inference neni dostupna, pouzije jednodussi heuristicky fallback.

---

## Technicke zavislosti

- `onnxruntime-web` je nainstalovany jako lokalni zavislost v `node_modules`
- extension nacita `node_modules/onnxruntime-web/dist/ort.all.min.js`
- WASM assety jsou vystaveny pres `web_accessible_resources`

---

## Struktura souboru

```text
manifest.json
background.js
content.js
grid.js
auto-detect.js
perspective-transform.js
popup.html
popup.js
viewer.html
viewer.js
models/
node_modules/
```

---

## English Version

Chrome extension for overlaying a 10x5 grid on a beach volleyball court. The grid is displayed over video in the browser and supports automatic court mapping.

---

## How to Install the Extension in Chrome

Step by step:

1. Click the green `Code` button.
2. Select `Download ZIP`.
3. Wait until the ZIP file is downloaded to your computer.
4. Extract the ZIP file.
5. Open Google Chrome.
6. Click the `Extensions` icon in the top-right corner.
7. The `Extensions` icon looks like a small puzzle piece.
8. Click `Manage extensions`.
9. Turn on `Developer mode` in the top-right corner.
10. Click `Load unpacked`.
11. Select the extracted repository folder.
12. The extension will be loaded into Chrome as a new local extension.

If the extension loads correctly, you will see it in the extensions list.

Note:

- If you want to add screenshots to the README later, just place them into the `images/` folder and they can be added here.

---

## Usage

Default keyboard shortcuts:

| Shortcut | Function |
|---|---|
| `Alt+H` | Show or hide the grid |
| `Alt+M` | Automatically map the court |
| `Alt+R` | Reset the grid to the center of the screen |
| `Shift` + drag | Move a corner or the whole grid |
| `Shift` + scroll | Rotate the grid |

The extension popup allows you to:

- turn the grid on or off
- change keyboard shortcuts
- edit the list of websites where the extension is active
- open the Offline Viewer for local videos

### Offline Viewer

If you want to work with a downloaded video offline:

1. Click the extension icon.
2. Click `Open Offline Viewer`.
3. In the new tab, click `Choose video`.
4. Select a local `.mp4` file.
5. Use `Show grid`, `Auto-map`, or the same keyboard shortcuts as on the web.
6. If you want to enlarge the video, use the `Fullscreen` button directly in the viewer so the grid stays visible.
7. `Space` plays or pauses the video, and `Left` and `Right` move the video by the configured number of seconds.
8. The number of seconds for arrow-key skipping can be changed in the extension popup in the `Offline Viewer` section.

Note:

- If you open `file://.../video.mp4` directly in Chrome, the extension is not fully reliable because of Chrome media viewer limitations.
- The Offline Viewer is the recommended way to work with local videos.

---

## Grid Behavior

- The first time the grid is shown on a tab, a default centered grid is created.
- `Alt+M` and `Alt+R` also show the grid if it was hidden.
- The grid position is remembered for as long as the tab stays open.

---

## Automatic Mapping

The extension first tries to use the YOLOv8 ONNX segmentation model `models/yolov8s-field-50.onnx`.

- It estimates the court corners from the detected court mask.
- If model inference is not available, it falls back to a simpler heuristic approach.

---

## Technical Dependencies

- `onnxruntime-web` is installed as a local dependency in `node_modules`
- the extension loads `node_modules/onnxruntime-web/dist/ort.all.min.js`
- WASM assets are exposed through `web_accessible_resources`

---

## File Structure

```text
manifest.json
background.js
content.js
grid.js
auto-detect.js
perspective-transform.js
popup.html
popup.js
viewer.html
viewer.js
models/
node_modules/
```
