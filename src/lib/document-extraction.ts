import mammoth from "mammoth/mammoth.browser";

const MAX_EXTRACTED_CHARS = 12_000;
const MAX_PREVIEW_CHARS = 2_000;

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

  const arrayBuffer = await file.arrayBuffer();
  const document = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const chunks: string[] = [];

  for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
    const page = await document.getPage(pageIndex);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");

    if (pageText.trim()) {
      chunks.push(pageText.trim());
    }
  }

  return chunks.join("\n\n").slice(0, MAX_EXTRACTED_CHARS);
}

async function extractDocxText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return (result.value || "").slice(0, MAX_EXTRACTED_CHARS);
}

async function extractPlainText(file: File): Promise<string> {
  return (await file.text()).slice(0, MAX_EXTRACTED_CHARS);
}

export async function extractUploadedText(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdfText(file);
  }

  if (lowerName.endsWith(".docx") || file.type.includes("wordprocessingml")) {
    return extractDocxText(file);
  }

  if (file.type.startsWith("text/") || /\.(txt|md|markdown|csv|json|html|xml|rtf)$/i.test(file.name)) {
    return extractPlainText(file);
  }

  return "";
}

export function createTextPreview(text: string): string {
  return text.trim().slice(0, MAX_PREVIEW_CHARS);
}
