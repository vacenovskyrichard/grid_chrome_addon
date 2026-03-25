# grid_chrome_addon

Chrome extension pro overlay 10x5 gridu na beachvolejbalove hriste. Grid se zobrazuje pres video v prohlizeci a umi automaticke namapovani kurtu.

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
7. `Space` prehrava nebo pauzne video, sipky `←` a `→` posouvaji video o nastaveny pocet sekund.
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
