# grid_chrome_addon

Chrome addon pro overlay 10×5 gridu na beachvolejbalové hřiště. Grid je perspektivně transformovaný podle detekovaných rohů kurtu a zobrazuje se přes video v prohlížeči.

---

## Použití

Grid je na každé záložce ve výchozím stavu skrytý. Zapneš ho buď přes popup addonů (ikona v liště), nebo klávesovou zkratkou.

### Klávesové zkratky (výchozí)

| Zkratka | Funkce |
|---|---|
| `Alt+H` | Zobrazit / skrýt grid |
| `Alt+M` | Automaticky namapovat kurt |
| `Alt+R` | Resetovat grid do středu obrazovky |
| `Shift` + tažení | Přesunout roh nebo celý grid |
| `Shift` + scroll | Rotovat grid |

> Všechny zkratky lze změnit v popupu addonů.

### Popup

Kliknutím na ikonu addonů v liště se otevře popup s těmito možnostmi:

- **Přepínač ON/OFF** — zobrazí nebo skryje grid na aktuální záložce. Každá záložka má vlastní stav; vypnutí gridu na jednom videu neovlivní ostatní záložky.
- **Klávesové zkratky** — u každé akce lze kliknout na ikonu tužky a stisknout novou kombinaci kláves. Změna se uloží okamžitě.
- **Aktivní weby** — seznam URL vzorů, na kterých addon funguje. Lze přidávat a odebírat bez nutnosti restartovat prohlížeč.

---

## Chování gridu

- Při prvním zobrazení gridu na záložce (přepínačem nebo zkratkou) se automaticky vytvoří výchozí centrovaný grid — není potřeba mačkat Reset zvlášť.
- `Alt+M` a `Alt+R` grid zároveň zobrazí, pokud byl skrytý.
- Pozice gridu se pamatuje po dobu otevřené záložky. Zavřením záložky se pozice resetuje.

---

## Automatické mapování

Addon se nejdřív pokusí použít YOLOv8 ONNX segmentační model `models/yolov8s-field-50.onnx`:
- z masky hřiště dopočítá 4 dominantní čáry a z jejich průsečíků rohy
- pokud modelová inference není dostupná, spadne zpět na jednoduchou heuristiku nad modrými lajnami

---

## Technické závislosti

- `onnxruntime-web` je nainstalovaný jako lokální závislost v `node_modules`
- extension načítá `node_modules/onnxruntime-web/dist/ort.all.min.js`
- WASM assety jsou vystaveny přes `web_accessible_resources`
- Injekce content scriptů je dynamická (přes `chrome.scripting`) — umožňuje měnit seznam webů za běhu bez restartu addonů

---

## Struktura souborů

```
├── manifest.json          # MV3 konfigurace, oprávnění, service worker
├── background.js          # Service worker: dynamická injekce scriptů, výchozí nastavení
├── content.js             # Inicializace canvasu nad videem
├── grid.js                # Logika gridu, zkratky, kreslení
├── auto-detect.js         # YOLOv8 detektor + heuristický fallback
├── perspective-transform.js
├── popup.html             # UI popupu
├── popup.js               # Logika popupu
├── models/
│   └── yolov8s-field-50.onnx
└── node_modules/
    └── onnxruntime-web/
```
