/**
 * indexing.js
 *
 * Functions to parse PDFs, spreadsheets, etc. Also determines
 * file type (PDF, XLSX) by extension.
 */

// <-- This line makes sure we can use pdfjs from the global scope in our ES module:
const pdfjs = window.pdfjsLib;

/**
 * Check if a file is PDF by extension
 */
export function isPDF(filename) {
  if (!filename) return false;
  return filename.toLowerCase().endsWith('.pdf');
}

/**
 * Parse a PDF file to text using pdf.js
 */
export async function parsePDFFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const typedArray = new Uint8Array(arrayBuffer);

  // Use `pdfjs` (pointing to window.pdfjsLib)
  const loadingTask = pdfjs.getDocument({ data: typedArray });
  const pdf = await loadingTask.promise;
  let textOutput = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item) => item.str.trim().length > 0)
      .map((item) => {
        return item.hasEOL ? item.str + '\n' : item.str + ' ';
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) {
      textOutput += pageText + '\n\n';
    }
  }

  return textOutput.trim();
}

/**
 * Check if a file is a spreadsheet
 */
export function isSpreadsheet(filename) {
  if (!filename) return false;
  const spreadsheetExtensions = [
    '.xls',
    '.xlsx',
    '.xlsm',
    '.xlsb',
    '.xlt',
    '.ods',
    '.fods',
    '.numbers',
  ];
  const lower = filename.toLowerCase();
  return spreadsheetExtensions.some((ext) => lower.endsWith(ext));
}

/**
 * Parse a spreadsheet file to CSV text using SheetJS
 */
export async function parseSpreadsheetFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        let textOutput = '';

        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(worksheet);
          textOutput += `Sheet: ${sheetName}\n${csv}\n\n`;
        });

        resolve(textOutput.trim());
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}
