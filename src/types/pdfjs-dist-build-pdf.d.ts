declare module "pdfjs-dist/build/pdf.mjs" {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(init: { data: ArrayBuffer }): { promise: Promise<{ numPages: number; getPage(pageNumber: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string }> }> }> }> };
}
