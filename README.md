# grid_chrome_addon

Chrome addon pro overlay 10x5 gridu na beachvolejbalove hriste.

Aktualni stav:
- `Shift` zapne rucni upravu rohu.
- `R` vrati grid do stredu.
- `M` spusti automaticke mapovani hriste.

Automaticke mapovani:
- addon se nejdriv pokusi pouzit YOLOv8 ONNX segmentacni model `models/yolov8s-field-50.onnx`
- z masky hriste dopocita 4 dominantni cary a z jejich pruseciku rohy
- kdyz modelova inference neni dostupna, spadne zpet na jednoduchou heuristiku nad modrymi lajnami

Co jeste chybi pro plne modelove spusteni v Chrome:
- `onnxruntime-web` je instalovany jako lokalni dependency v `node_modules`
- extension nacita `node_modules/onnxruntime-web/dist/ort.all.min.js`
- WASM assety jsou vystaveny pres `web_accessible_resources`
