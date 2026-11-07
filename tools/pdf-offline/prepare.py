#!/usr/bin/env python3
from pathlib import Path
import sys
p=Path(sys.argv[1]); html=p.read_text(encoding="utf-8")
def replace(old,new):
 global html
 if old not in html: raise SystemExit("Missing: "+repr(old))
 html=html.replace(old,new)
replace("const PDFJS_CDN='./pdf.min.mjs';const PDFJS_WORKER='./pdf.worker.min.mjs'","const PDFJS_CDN='./pdfjs/pdf.min.js';const PDFJS_WORKER='./pdfjs/pdf.worker.min.js'")
replace("workerPromise=lib.createWorker('vie+eng');", """workerPromise=lib.createWorker('vie+eng',1,{
 workerPath:new URL('./ocr/worker.min.js',document.baseURI).href,
 corePath:new URL('./ocr/core',document.baseURI).href,
 langPath:new URL('./ocr/lang',document.baseURI).href,
 workerBlobURL:false,gzip:true,cacheMethod:'none'
});""")
html=html.replace('<script src="../site-footer.js?v=118"></script>','')
html=html.replace("</head>",'<script src="./pdfjs/pdf.min.js"></script>\n<script src="./tesseract.min.js"></script>\n</head>',1)
html=html.replace("Không tải được OCR. Hãy kết nối Internet để đọc tên, hoặc nhập thủ công.","Không tải được thư viện OCR cục bộ. Hãy khởi chạy bằng start-linux.sh hoặc start-windows.bat.")
p.write_text(html,encoding="utf-8")
