#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$RUNNER_TEMP/autotax-pdf-build"
rm -rf "$WORK"
mkdir -p "$WORK/npm" "$WORK/out"
cd "$WORK/npm"
npm init -y >/dev/null
npm install --no-fund --no-audit --no-save pdfjs-dist@3.11.174 pdf-lib@1.17.1 tesseract.js@5.1.1 tesseract.js-core@5.0.0
NODE="$WORK/npm/node_modules"
APP="$WORK/out/AutoTax-PDF-HTML-Offline"
mkdir -p "$APP/pdfjs" "$APP/ocr/core" "$APP/ocr/lang" "$APP/licenses"
cp "$REPO_ROOT/docs/pdf/offline.html" "$APP/index.html"
cp "$NODE/pdfjs-dist/build/pdf.min.js" "$APP/pdfjs/pdf.min.js"
cp "$NODE/pdfjs-dist/build/pdf.worker.min.js" "$APP/pdfjs/pdf.worker.min.js"
cp "$NODE/pdf-lib/dist/pdf-lib.min.js" "$APP/pdf-lib.min.js"
cp "$NODE/tesseract.js/dist/tesseract.min.js" "$APP/tesseract.min.js"
cp "$NODE/tesseract.js/dist/worker.min.js" "$APP/ocr/worker.min.js"
cp "$NODE/tesseract.js-core"/tesseract-core* "$APP/ocr/core/"
for pkg in pdfjs-dist pdf-lib tesseract.js tesseract.js-core; do
 if [ -f "$NODE/$pkg/LICENSE" ]; then cp "$NODE/$pkg/LICENSE" "$APP/licenses/$pkg-LICENSE"; fi
done
curl -fLsS --retry 3 https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz -o "$APP/ocr/lang/eng.traineddata.gz"
curl -fLsS --retry 3 https://tessdata.projectnaptha.com/4.0.0/vie.traineddata.gz -o "$APP/ocr/lang/vie.traineddata.gz"
python3 "$REPO_ROOT/tools/pdf-offline/prepare.py" "$APP/index.html"
cp "$REPO_ROOT/tools/pdf-offline/start-linux.sh" "$APP/start-linux.sh"
cp "$REPO_ROOT/tools/pdf-offline/start-windows.bat" "$APP/start-windows.bat"
cp "$REPO_ROOT/tools/pdf-offline/README-html.txt" "$APP/README.txt"
chmod +x "$APP/start-linux.sh"
python3 - "$APP" <<'PY'
import pathlib,re,sys
p=pathlib.Path(sys.argv[1])
html=(p/'index.html').read_text()
assert '<script src="./pdfjs/pdf.min.js"></script>' in html
assert "PDFJS_WORKER='./pdfjs/pdf.worker.min.js'" in html
assert "PDFLIB_URL='./pdf-lib.min.js'" in html
assert "workerPath:new URL('./ocr/worker.min.js'" in html
assert not re.search(r'<script[^>]+src=["\x27]https?://',html,re.I)
for rel in ['pdfjs/pdf.min.js','pdfjs/pdf.worker.min.js','pdf-lib.min.js','tesseract.min.js','ocr/worker.min.js','ocr/lang/eng.traineddata.gz','ocr/lang/vie.traineddata.gz']:
 f=p/rel
 assert f.is_file() and f.stat().st_size>1000,(rel,'missing')
print('Validation: offline dependency references OK, no CDN script links.')
PY
LINUX="$WORK/out/AutoTax-PDF-Linux-LAN"
cp -a "$APP" "$LINUX"
cp "$REPO_ROOT/tools/pdf-offline/start-linux.sh" "$LINUX/start.sh"
cp "$REPO_ROOT/tools/pdf-offline/README-linux.txt" "$LINUX/README.txt"
cp "$REPO_ROOT/tools/pdf-offline/autotax-pdf.service.example" "$LINUX/autotax-pdf.service.example"
chmod +x "$LINUX/start.sh"
cd "$WORK/out"
zip -q -r -9 AutoTax-PDF-HTML-Offline.zip AutoTax-PDF-HTML-Offline
zip -q -r -9 AutoTax-PDF-Linux-LAN.zip AutoTax-PDF-Linux-LAN
ls -lh *.zip
echo "BUILD_OUT=$WORK/out" >> "$GITHUB_ENV"
