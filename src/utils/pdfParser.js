// PDF Parser utility for handling CommonJS module
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function resolvePdfParseSync() {
  // Try multiple known entry points for pdf-parse across versions/builds
  const candidates = [
    () => {
      try {
        // CommonJS direct export (most common)
        const m = require('pdf-parse');
        return m && (m.default || m);
      } catch {}
      return null;
    },
    () => {
      try {
        // Explicit path to implementation used by some bundlers
        const m = require('pdf-parse/lib/pdf-parse.js');
        return m && (m.default || m);
      } catch {}
      return null;
    },
  ];

  for (const tryLoad of candidates) {
    const fn = tryLoad();
    if (typeof fn === 'function') return fn;
  }
  return null;
}

export async function parsePDF(buffer) {
  try {
    // First try pdf-parse
    let pdfFn = resolvePdfParseSync();
    if (typeof pdfFn === 'function') {
      return await pdfFn(buffer);
    }

    try {
      const ns = await import('pdf-parse');
      const fn = (ns && (ns.default || ns));
      if (typeof fn === 'function') {
        return await fn(buffer);
      }
    } catch {}

    try {
      const ns2 = await import('pdf-parse/lib/pdf-parse.js');
      const fn2 = (ns2 && (ns2.default || ns2));
      if (typeof fn2 === 'function') {
        return await fn2(buffer);
      }
    } catch {}

    // Fallback to pdfjs-dist legacy ESM build text extraction (recommended for Node)
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const getDocumentFn = pdfjsLib.getDocument || (pdfjsLib.default && pdfjsLib.default.getDocument);
    if (typeof getDocumentFn !== 'function') {
      throw new Error('pdfjs-dist getDocument not available');
    }

    // Ensure a plain Uint8Array (not a Node Buffer subtype)
    // Always copy into a fresh Uint8Array so pdfjs doesn't see a Buffer instance
    const uint8 = Uint8Array.from(buffer);
    const loadingTask = getDocumentFn({ data: uint8 });
    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const strings = content.items.map((i) => i.str);
      fullText += strings.join(' ') + '\n\n';
    }
    return { text: fullText, numpages: pdf.numPages, info: {}, version: 'pdfjs-dist' };
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
}
