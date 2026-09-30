import type { ExtractionProgress, FileKind } from './types'

const SUPPORTED_EXTENSIONS: Record<string, FileKind> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
  txt: 'txt',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
}

export function kindForFile(name: string): FileKind | null {
  const extension = name.split('.').pop()?.toLowerCase()
  return extension ? SUPPORTED_EXTENSIONS[extension] ?? null : null
}

async function createOcrWorker(onProgress: (message: string, percent: number) => void) {
  const { createWorker } = await import('tesseract.js')
  return createWorker('eng', 1, {
    logger: (event) => {
      if (event.status === 'recognizing text') {
        onProgress('Reading image text', Math.round(event.progress * 100))
      }
    },
  })
}

async function readImage(file: File, onProgress: (value: ExtractionProgress) => void): Promise<string> {
  const worker = await createOcrWorker((message, percent) => onProgress({ message, percent }))
  try {
    const result = await worker.recognize(file)
    return result.data.text.trim()
  } finally {
    await worker.terminate()
  }
}

async function readPdf(file: File, onProgress: (value: ExtractionProgress) => void): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const pdf = await loadingTask.promise
  let ocrWorker: Awaited<ReturnType<typeof createOcrWorker>> | null = null
  const pages: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress({ message: `Reading page ${pageNumber} of ${pdf.numPages}`, percent: Math.round(((pageNumber - 1) / pdf.numPages) * 100) })
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ').trim()
      if (text.length > 24) {
        pages.push(text)
      } else {
        ocrWorker ??= await createOcrWorker((message, percent) => onProgress({ message, percent }))
        const viewport = page.getViewport({ scale: 1.45 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Could not prepare a PDF page for text reading.')
        await page.render({ canvas, viewport }).promise
        const recognized = await ocrWorker.recognize(canvas)
        if (recognized.data.text.trim()) pages.push(recognized.data.text.trim())
      }
      page.cleanup()
    }
  } finally {
    if (ocrWorker) await ocrWorker.terminate()
    await loadingTask.destroy()
  }
  return pages.join('\n\n')
}

async function readPowerPoint(file: File): Promise<string> {
  const { default: JSZip } = await import('jszip')
  const archive = await JSZip.loadAsync(await file.arrayBuffer())
  const slideFiles = Object.keys(archive.files)
    .map((path) => ({ path, match: path.match(/^ppt\/slides\/slide(\d+)\.xml$/) }))
    .filter((item): item is { path: string; match: RegExpMatchArray } => Boolean(item.match))
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))

  const slides: string[] = []
  for (const [index, slide] of slideFiles.entries()) {
    const xml = await archive.file(slide.path)?.async('text')
    if (!xml) continue
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    const text = Array.from(document.getElementsByTagName('a:t')).map((node) => node.textContent ?? '').join(' ').trim()
    if (text) slides.push(`Slide ${index + 1}\n${text}`)
  }
  return slides.join('\n\n')
}

export async function extractText(
  file: File,
  kind: FileKind,
  onProgress: (value: ExtractionProgress) => void,
): Promise<string> {
  onProgress({ message: 'Preparing file', percent: 4 })
  let text = ''

  if (kind === 'pdf') text = await readPdf(file, onProgress)
  else if (kind === 'image') text = await readImage(file, onProgress)
  else if (kind === 'txt') text = await file.text()
  else if (kind === 'docx') {
    const { default: mammoth } = await import('mammoth')
    onProgress({ message: 'Reading Word document', percent: 45 })
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    text = result.value
  } else if (kind === 'pptx') {
    onProgress({ message: 'Reading presentation slides', percent: 45 })
    text = await readPowerPoint(file)
  }

  const cleaned = text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim()
  if (!cleaned) throw new Error('No readable text found. Check the file or try another copy.')
  onProgress({ message: 'File ready', percent: 100 })
  return cleaned
}
