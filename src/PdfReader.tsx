import { useEffect, useRef, useState } from 'react'

interface PdfReaderProps {
  file: Blob
}

export function PdfReader({ file }: PdfReaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    let loadingTask: { destroy: () => Promise<void> } | null = null
    setLoading(true)
    setError('')

    async function renderPage() {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
        loadingTask = task
        const pdf = await task.promise
        if (!active) return
        setPageCount(pdf.numPages)
        const pageData = await pdf.getPage(page)
        const viewport = pageData.getViewport({ scale: Math.min(1.5, Math.max(0.8, window.innerWidth / 560)) })
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context) throw new Error('PDF page could not be drawn.')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await pageData.render({ canvas, viewport }).promise
        if (active) setLoading(false)
      } catch {
        if (active) {
          setError('This PDF could not be opened. Try another file copy.')
          setLoading(false)
        }
      }
    }

    void renderPage()
    return () => {
      active = false
      if (loadingTask) void loadingTask.destroy()
    }
  }, [file, page])

  return (
    <div className="pdf-reader">
      <div className="pdf-toolbar">
        <span>{pageCount ? `Page ${page} of ${pageCount}` : 'PDF preview'}</span>
        <div className="inline-actions">
          <button className="icon-button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
          <button className="icon-button" aria-label="Next page" disabled={pageCount > 0 && page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>›</button>
        </div>
      </div>
      {loading && <div className="pdf-placeholder">Opening page…</div>}
      {error && <div className="inline-error">{error}</div>}
      <canvas className="pdf-canvas" ref={canvasRef} aria-label={`PDF page ${page}`} />
    </div>
  )
}
