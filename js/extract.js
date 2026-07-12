// docx / pdf -> lines[]
export async function extractLines(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return extractDocx(file);
  if (name.endsWith('.pdf')) return extractPdf(file);
  if (name.endsWith('.txt') || name.endsWith('.md')) {
    const text = await file.text();
    return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  throw new Error('Unsupported file type. Upload .docx, .pdf, .txt or .md');
}

async function extractDocx(file) {
  if (!window.mammoth) throw new Error('mammoth.js not loaded yet — try again in a second');
  const buf = await file.arrayBuffer();
  const { value } = await window.mammoth.extractRawText({ arrayBuffer: buf });
  return value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

async function extractPdf(file) {
  const pdfjs = await import('../libs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../libs/pdf.worker.min.mjs', import.meta.url).href;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // group items into lines by their y coordinate
    let curY = null, cur = [];
    for (const it of content.items) {
      const y = Math.round(it.transform[5]);
      if (curY !== null && Math.abs(y - curY) > 3) {
        const t = cur.join(' ').replace(/\s{2,}/g, ' ').trim();
        if (t) lines.push(t);
        cur = [];
      }
      curY = y;
      if (it.str && it.str.trim()) cur.push(it.str.trim());
    }
    const t = cur.join(' ').replace(/\s{2,}/g, ' ').trim();
    if (t) lines.push(t);
  }
  return lines;
}
