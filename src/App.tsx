import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { downloadBackup, restoreBackup } from './backup'
import { listDocuments, removeDocument, saveDocument } from './db'
import { extractText, kindForFile } from './extract'
import { PdfReader } from './PdfReader'
import { Turnstile } from './Turnstile'
import type { ExtractionProgress, Flashcard, GeneratedReviewer, StudyDocument } from './types'

type Panel = 'detail' | 'reviewer' | 'cards' | 'source'
type Tab = 'library' | 'progress'

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''

function Icon({ name, size = 20 }: { name: 'book' | 'plus' | 'arrow' | 'file' | 'spark' | 'cards' | 'clock' | 'download' | 'trash' | 'back' | 'check' | 'close' | 'upload'; size?: number }) {
  const paths: Record<string, ReactNode> = {
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8M8 10h8"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    file: <><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10z"/><path d="M13 3v7h7M8 14h8M8 17h8"/></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></>,
    cards: <><rect x="4" y="6" width="13" height="15" rx="2"/><path d="M8 3h10a2 2 0 0 1 2 2v12M8 11h5M8 15h5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 17v3h14v-3"/></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3"/></>,
    back: <><path d="m15 18-6-6 6-6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    upload: <><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M5 14v5h14v-5"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
}

function progressPercent(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0
}

function App() {
  const [documents, setDocuments] = useState<StudyDocument[]>([])
  const [tab, setTab] = useState<Tab>('library')
  const [panel, setPanel] = useState<Panel>('detail')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState<ExtractionProgress | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showGenerator, setShowGenerator] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [generationMessage, setGenerationMessage] = useState('')
  const [activeCardIndex, setActiveCardIndex] = useState(0)
  const [cardFlipped, setCardFlipped] = useState(false)
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null)
  const [showCardForm, setShowCardForm] = useState(false)
  const [savingBackup, setSavingBackup] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)

  const selectedDocument = useMemo(() => documents.find((document) => document.id === selectedId) ?? null, [documents, selectedId])

  const refreshDocuments = useCallback(async () => {
    try {
      setDocuments(await listDocuments())
    } catch {
      setError('Could not open study storage. Check browser storage settings and reload.')
    }
  }, [])

  useEffect(() => {
    void refreshDocuments()
  }, [refreshDocuments])

  useEffect(() => {
    if (!notice && !error) return
    const timer = window.setTimeout(() => {
      setNotice('')
      setError('')
    }, 5500)
    return () => window.clearTimeout(timer)
  }, [notice, error])

  const selectDocument = (id: string, nextPanel: Panel = 'detail') => {
    setSelectedId(id)
    setPanel(nextPanel)
    setTab('library')
    setError('')
  }

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!selectedFiles.length) return

    setImporting(true)
    setError('')
    let lastImportedId: string | null = null
    for (const [index, file] of selectedFiles.entries()) {
      const kind = kindForFile(file.name)
      if (!kind) {
        setError(`${file.name} is not supported. Choose PDF, DOCX, PPTX, TXT, JPG, or PNG.`)
        continue
      }
      try {
        setImportStatus({ message: `Preparing ${file.name}`, percent: 0 })
        const text = await extractText(file, kind, setImportStatus)
        const document: StudyDocument = {
          id: crypto.randomUUID(),
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          kind,
          createdAt: Date.now(),
          file,
          extractedText: text,
          title: '',
          summary: '',
          sections: [],
          flashcards: [],
        }
        await saveDocument(document)
        lastImportedId = document.id
        setImportStatus({ message: `Saved ${index + 1} of ${selectedFiles.length}`, percent: 100 })
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Could not read this file.'
        setError(`${file.name}: ${message}`)
      }
    }
    await refreshDocuments()
    setImporting(false)
    setImportStatus(null)
    if (lastImportedId) selectDocument(lastImportedId)
  }

  const updateDocument = async (updated: StudyDocument) => {
    await saveDocument(updated)
    setDocuments((current) => current.map((document) => document.id === updated.id ? updated : document))
  }

  const generateReviewer = async () => {
    if (!selectedDocument || !turnstileToken) return
    setGenerating(true)
    setGenerationMessage('Preparing your notes…')
    setError('')
    try {
      const response = await fetch('/api/reviewer/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          documentName: selectedDocument.name,
          extractedText: selectedDocument.extractedText,
          challengeToken: turnstileToken,
        }),
      })
      const responseText = await response.text()
      let result: GeneratedReviewer | { code?: string; error?: string }
      try {
        if (!responseText.trim()) throw new Error('empty response')
        result = JSON.parse(responseText) as GeneratedReviewer | { code?: string; error?: string }
      } catch {
        throw new Error(`AI service returned no readable JSON (HTTP ${response.status}). If running locally, use npm run dev:pages; if deployed, check the Cloudflare Pages Function logs.`)
      }
      if (!result || typeof result !== 'object') {
        throw new Error('AI service returned invalid data. Please retry.')
      }
      if (!response.ok) {
        const code = 'code' in result ? result.code : undefined
        if (code === 'FREE_DAILY_CAP' || code === 'AI_QUOTA_EXHAUSTED') {
          throw new Error('Today’s free AI limit is reached. Your files stay here. Try again tomorrow.')
        }
        if (code === 'TURNSTILE_HOSTNAME_MISMATCH') throw new Error(('error' in result && result.error) || 'Turnstile hostname mismatch. Check TURNSTILE_HOSTNAME and restart Pages dev.')
        if (code === 'TURNSTILE_SECRET_INVALID') throw new Error('Turnstile secret key is invalid or does not match the site key. Check the local test-key pair in .dev.vars and .env.local.')
        if (code === 'CHALLENGE_UNAVAILABLE') throw new Error('Could not reach Cloudflare to verify the security check. Check your connection and retry.')
        if (code === 'CHALLENGE_TOKEN_EXPIRED') throw new Error('Turnstile token expired or was already used. Complete a fresh check and submit once.')
        if (code === 'INVALID_CHALLENGE') throw new Error('Cloudflare rejected this token. Check that the site key and secret are a matching pair, then complete a fresh check.')
        if (code === 'TEXT_TOO_LONG') throw new Error('This file is too long for one free review. Split it into smaller files and try again.')
        throw new Error(('error' in result && result.error) || 'Could not make the reviewer. Please retry.')
      }

      const generated = result as GeneratedReviewer
      if (!generated.title || !generated.summary || !Array.isArray(generated.sections) || !Array.isArray(generated.flashcards)) {
        throw new Error('The AI returned an incomplete reviewer. Try again.')
      }
      const replacingReviewer = Boolean(selectedDocument.summary)
      const sectionKey = (title: string) => title.trim().toLowerCase()
      const previousSections = new Map(selectedDocument.sections.map((section) => [sectionKey(section.title), section]))
      const previousAiCards = new Map(selectedDocument.flashcards
        .filter((card) => card.origin === 'ai')
        .map((card) => [card.question.trim().toLowerCase(), card]))
      const updated: StudyDocument = {
        ...selectedDocument,
        title: generated.title,
        summary: generated.summary,
        sections: generated.sections.map((section) => {
          const previous = previousSections.get(sectionKey(section.title))
          return { ...section, id: previous?.id ?? crypto.randomUUID(), completed: previous?.completed ?? false }
        }),
        flashcards: [
          ...generated.flashcards.map((card) => {
            const previous = previousAiCards.get(card.question.trim().toLowerCase())
            return { ...card, id: previous?.id ?? crypto.randomUUID(), known: previous?.known ?? false, origin: 'ai' as const }
          }),
          ...selectedDocument.flashcards.filter((card) => card.origin === 'manual'),
        ],
      }
      await updateDocument(updated)
      setShowGenerator(false)
      setTurnstileToken('')
      setActiveCardIndex(0)
      setPanel('reviewer')
      setNotice(replacingReviewer ? 'Detailed reviewer updated. Manual cards and matching progress stayed.' : 'Reviewer ready. Give those notes a quick check as you study.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not make the reviewer. Please retry.')
      setTurnstileToken('')
      setTurnstileReset((value) => value + 1)
    } finally {
      setGenerating(false)
      setGenerationMessage('')
    }
  }

  const updateSection = async (sectionId: string, completed: boolean) => {
    if (!selectedDocument) return
    const updated = {
      ...selectedDocument,
      sections: selectedDocument.sections.map((section) => section.id === sectionId ? { ...section, completed } : section),
    }
    await updateDocument(updated)
  }

  const saveFlashcard = async (question: string, answer: string) => {
    if (!selectedDocument) return
    const normalizedQuestion = question.trim()
    const normalizedAnswer = answer.trim()
    if (!normalizedQuestion || !normalizedAnswer) return
    let flashcards: Flashcard[]
    if (editingCard) {
      flashcards = selectedDocument.flashcards.map((card) => card.id === editingCard.id
        ? { ...card, question: normalizedQuestion, answer: normalizedAnswer }
        : card)
    } else {
      flashcards = [...selectedDocument.flashcards, {
        id: crypto.randomUUID(), question: normalizedQuestion, answer: normalizedAnswer, known: false, origin: 'manual',
      }]
    }
    await updateDocument({ ...selectedDocument, flashcards })
    setShowCardForm(false)
    setEditingCard(null)
    setNotice(editingCard ? 'Card updated.' : 'Card added.')
  }

  const rateCard = async (known: boolean) => {
    if (!selectedDocument || !selectedDocument.flashcards.length) return
    const card = selectedDocument.flashcards[activeCardIndex]
    const flashcards = selectedDocument.flashcards.map((item) => item.id === card.id ? { ...item, known } : item)
    await updateDocument({ ...selectedDocument, flashcards })
    setCardFlipped(false)
    setActiveCardIndex((index) => (index + 1) % flashcards.length)
  }

  const deleteCard = async (cardId: string) => {
    if (!selectedDocument) return
    const flashcards = selectedDocument.flashcards.filter((card) => card.id !== cardId)
    await updateDocument({ ...selectedDocument, flashcards })
    setActiveCardIndex((index) => Math.min(index, Math.max(0, flashcards.length - 1)))
    setCardFlipped(false)
  }

  const handleDeleteDocument = async () => {
    if (!selectedDocument || !window.confirm(`Delete “${selectedDocument.name}” and its study data?`)) return
    await removeDocument(selectedDocument.id)
    setDocuments((current) => current.filter((document) => document.id !== selectedDocument.id))
    setSelectedId(null)
    setPanel('detail')
    setNotice('File and study data deleted from this browser.')
  }

  const handleBackup = async () => {
    try {
      setSavingBackup(true)
      await downloadBackup()
      setNotice('Backup downloaded.')
    } catch {
      setError('Could not create a backup. Check available storage and retry.')
    } finally {
      setSavingBackup(false)
    }
  }

  const handleRestore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const restored = await restoreBackup(file)
      await refreshDocuments()
      setNotice(`${restored} file${restored === 1 ? '' : 's'} restored.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open this backup.')
    }
  }

  const backFromPanel = () => {
    if (panel === 'detail') {
      setSelectedId(null)
      return
    }
    if (panel === 'cards' || panel === 'source') setPanel('detail')
    else setPanel('detail')
  }

  const completedSections = documents.reduce((total, document) => total + document.sections.filter((section) => section.completed).length, 0)
  const allSections = documents.reduce((total, document) => total + document.sections.length, 0)
  const knownCards = documents.reduce((total, document) => total + document.flashcards.filter((card) => card.known).length, 0)
  const allCards = documents.reduce((total, document) => total + document.flashcards.length, 0)

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => { setSelectedId(null); setPanel('detail'); setTab('library') }} aria-label="SimpleReviewer home">
          <span className="brand-mark">S</span>
          <span>SimpleReviewer</span>
        </button>
        <div className="top-actions">
          <button className="quiet-button backup-action" onClick={() => void handleBackup()} disabled={!documents.length || savingBackup}>
            <Icon name="download" size={17} /><span>{savingBackup ? 'Saving…' : 'Backup'}</span>
          </button>
          <button className="quiet-button restore-action" aria-label="Restore backup" onClick={() => backupInputRef.current?.click()}><Icon name="upload" size={16}/><span>Restore</span></button>
        </div>
      </header>

      <main className="main-content">
        {selectedDocument ? (
          <>
            <div className="back-row">
              <button className="back-button" onClick={backFromPanel}><Icon name="back" size={19} /> Back</button>
              <span className="crumb">{selectedDocument.name}</span>
            </div>
            {panel === 'detail' && <DocumentDetail document={selectedDocument} onGenerate={() => { setShowGenerator(true); setTurnstileToken(''); setTurnstileReset((value) => value + 1) }} onReader={() => setPanel('reviewer')} onCards={() => { setPanel('cards'); setActiveCardIndex(0) }} onSource={() => setPanel('source')} onToggleSection={updateSection} onDelete={() => void handleDeleteDocument()} onCreateCard={() => { setEditingCard(null); setShowCardForm(true) }} />}
            {panel === 'reviewer' && <ReviewerView document={selectedDocument} onToggleSection={updateSection} />}
            {panel === 'cards' && <FlashcardView document={selectedDocument} index={activeCardIndex} flipped={cardFlipped} onFlip={() => setCardFlipped((value) => !value)} onRate={rateCard} onPrevious={() => { setCardFlipped(false); setActiveCardIndex((value) => (value - 1 + selectedDocument.flashcards.length) % selectedDocument.flashcards.length) }} onNext={() => { setCardFlipped(false); setActiveCardIndex((value) => (value + 1) % selectedDocument.flashcards.length) }} onAdd={() => { setEditingCard(null); setShowCardForm(true) }} onEdit={(card) => { setEditingCard(card); setShowCardForm(true) }} onDelete={deleteCard} />}
            {panel === 'source' && <SourceView document={selectedDocument} />}
          </>
        ) : (
          <>
            <div className="welcome-row">
              <div>
                <p className="eyebrow">YOUR STUDY SPACE</p>
                <h1>{tab === 'library' ? 'Make room to learn.' : 'Small steps add up.'}</h1>
                <p className="welcome-subtitle">{tab === 'library' ? 'Turn class files into clear notes and cards.' : 'See what you’ve covered, one section at a time.'}</p>
              </div>
              {tab === 'library' && <button className="primary-button import-button" onClick={() => fileInputRef.current?.click()} disabled={importing}><Icon name="plus" size={19} /> Add file</button>}
            </div>

            {tab === 'library' ? (
              <LibraryView documents={documents} onOpen={selectDocument} onImport={() => fileInputRef.current?.click()} importing={importing} />
            ) : (
              <ProgressView documents={documents} completedSections={completedSections} allSections={allSections} knownCards={knownCards} allCards={allCards} onOpen={selectDocument} />
            )}
          </>
        )}
      </main>

      {!selectedDocument && <nav className="bottom-nav" aria-label="Main navigation">
        <button className={tab === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('library')}><Icon name="book" size={20} /><span>Library</span></button>
        <button className={tab === 'progress' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('progress')}><Icon name="clock" size={20} /><span>Progress</span></button>
      </nav>}

      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf,.docx,.pptx,.txt,.jpg,.jpeg,.png" multiple onChange={(event) => void handleFiles(event)} />
      <input ref={backupInputRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event) => void handleRestore(event)} />

      {importing && importStatus && <div className="busy-overlay"><div className="busy-card"><span className="spinner"/><strong>{importStatus.message}</strong><div className="progress-track"><span style={{ width: `${importStatus.percent}%` }} /></div><span className="muted small">File stays on this device</span></div></div>}
      {(notice || error) && <div className={error ? 'toast toast-error' : 'toast'} role="status">{error || notice}<button aria-label="Dismiss" onClick={() => { setError(''); setNotice('') }}><Icon name="close" size={16} /></button></div>}

      {showGenerator && selectedDocument && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !generating) setShowGenerator(false) }}>
        <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="generate-title">
          <button className="modal-close" aria-label="Close" onClick={() => setShowGenerator(false)} disabled={generating}><Icon name="close" size={19} /></button>
          <span className="modal-icon"><Icon name="spark" size={23} /></span>
          <p className="eyebrow">AI STUDY GUIDE</p>
          <h2 id="generate-title">Make your reviewer</h2>
          <p className="modal-copy">We’ll create a detailed reviewer with key points, terms, and flashcards from <strong>{selectedDocument.name}</strong>.</p>
          {selectedDocument.summary && <p className="small muted regeneration-note">This replaces the AI notes and cards. Manual cards stay; matching section and card progress is kept.</p>}
          <div className="privacy-note"><span className="privacy-dot"/><span>The extracted text will be sent to Cloudflare to make your reviewer. Your original file stays on this device. Study data is not saved in a cloud account.</span></div>
          {!TURNSTILE_SITE_KEY ? <div className="setup-note">Set <code>VITE_TURNSTILE_SITE_KEY</code> to enable AI generation.</div> : <div className="security-check"><span className="small muted">Quick security check</span><Turnstile siteKey={TURNSTILE_SITE_KEY} resetKey={turnstileReset} onToken={setTurnstileToken} /></div>}
          {generating && <p className="generation-status"><span className="spinner small-spinner"/>{generationMessage}</p>}
          <button className="primary-button modal-submit" onClick={() => void generateReviewer()} disabled={generating || !turnstileToken || !TURNSTILE_SITE_KEY}>
            {generating ? 'Making reviewer…' : 'Generate reviewer'}<Icon name="arrow" size={17} />
          </button>
          <p className="modal-footnote">Free AI use is shared across everyone. If today’s limit runs out, try again tomorrow.</p>
        </section>
      </div>}

      {showCardForm && selectedDocument && <CardEditor initial={editingCard} onClose={() => { setShowCardForm(false); setEditingCard(null) }} onSave={(question, answer) => void saveFlashcard(question, answer)} />}
    </div>
  )
}

function LibraryView({ documents, onOpen, onImport, importing }: { documents: StudyDocument[]; onOpen: (id: string) => void; onImport: () => void; importing: boolean }) {
  if (!documents.length) return (
    <section className="empty-state">
      <div className="empty-illustration"><div className="paper paper-back"/><div className="paper paper-front"><Icon name="file" size={30}/></div><span className="tiny-star">✦</span></div>
      <h2>Your first reviewer starts here.</h2>
      <p>Add a PDF, Word file, presentation, text file, or image. Your files stay on your phone.</p>
      <button className="primary-button" onClick={onImport} disabled={importing}><Icon name="upload" size={18}/>{importing ? 'Reading file…' : 'Choose a file'}</button>
      <div className="format-list"><span>PDF</span><span>DOCX</span><span>PPTX</span><span>TXT</span><span>JPG</span><span>PNG</span></div>
    </section>
  )

  return (
    <section className="library-section">
      <div className="section-heading"><div><p className="eyebrow">YOUR FILES</p><h2>Study library <span className="count-pill">{documents.length}</span></h2></div><button className="text-button" onClick={onImport} disabled={importing}><Icon name="plus" size={17}/> Add another</button></div>
      <div className="document-list">
        {documents.map((document) => {
          const doneSections = document.sections.filter((section) => section.completed).length
          const known = document.flashcards.filter((card) => card.known).length
          return <button className="document-card" key={document.id} onClick={() => onOpen(document.id)}>
            <div className={`file-icon file-${document.kind}`}><Icon name={document.kind === 'pdf' ? 'file' : document.kind === 'pptx' ? 'cards' : 'book'} size={19}/></div>
            <div className="document-info"><strong>{document.title || document.name}</strong><span>{document.name} · {formatDate(document.createdAt)}</span>
              {document.summary ? <span className="document-meta">{doneSections}/{document.sections.length} sections · {known}/{document.flashcards.length} cards known</span> : document.flashcards.length ? <span className="document-meta">{known}/{document.flashcards.length} cards known · reviewer not made</span> : <span className="document-meta">Text ready · reviewer not made</span>}
            </div>
            <Icon name="arrow" size={18}/>
          </button>
        })}
      </div>
      <div className="local-note"><span className="privacy-dot"/>Your library is saved in this browser on this device. Make a backup now and then.</div>
    </section>
  )
}

function ProgressView({ documents, completedSections, allSections, knownCards, allCards, onOpen }: { documents: StudyDocument[]; completedSections: number; allSections: number; knownCards: number; allCards: number; onOpen: (id: string) => void }) {
  const ready = documents.filter((document) => document.summary || document.flashcards.length)
  if (!ready.length) return <section className="empty-state progress-empty"><div className="empty-illustration progress-illustration"><Icon name="clock" size={32}/></div><h2>Progress will show here.</h2><p>Make a reviewer, study its sections, and mark cards as known to see your progress.</p></section>
  return (
    <section className="progress-page">
      <div className="progress-overview">
        <div className="overview-heading"><span className="overview-icon"><Icon name="check" size={18}/></span><div><p className="eyebrow">ALL REVIEWERS</p><h2>You’re building a habit.</h2></div></div>
        <div className="overall-metrics">
          <ProgressMetric label="Sections studied" done={completedSections} total={allSections} tint="green" />
          <ProgressMetric label="Cards known" done={knownCards} total={allCards} tint="amber" />
        </div>
      </div>
      <div className="section-heading progress-list-heading"><div><p className="eyebrow">KEEP GOING</p><h2>By reviewer</h2></div></div>
      <div className="progress-documents">
        {ready.map((document) => <button className="progress-document" key={document.id} onClick={() => onOpen(document.id)}>
          <div className="progress-doc-title"><span className="file-icon file-mini"><Icon name="book" size={17}/></span><strong>{document.title || document.name}</strong><Icon name="arrow" size={17}/></div>
          <ProgressMetric label="Sections studied" done={document.sections.filter((section) => section.completed).length} total={document.sections.length} tint="green" />
          <ProgressMetric label="Cards known" done={document.flashcards.filter((card) => card.known).length} total={document.flashcards.length} tint="amber" />
        </button>)}
      </div>
    </section>
  )
}

function ProgressMetric({ label, done, total, tint }: { label: string; done: number; total: number; tint: 'green' | 'amber' }) {
  const percent = progressPercent(done, total)
  return <div className="progress-metric"><div className="metric-label"><span>{label}</span><strong>{done}<span className="metric-total"> / {total}</span></strong></div><div className={`progress-track ${tint}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><span style={{ width: `${percent}%` }}/></div></div>
}

function DocumentDetail({ document, onGenerate, onReader, onCards, onSource, onToggleSection, onDelete, onCreateCard }: {
  document: StudyDocument
  onGenerate: () => void
  onReader: () => void
  onCards: () => void
  onSource: () => void
  onToggleSection: (id: string, completed: boolean) => void
  onDelete: () => void
  onCreateCard: () => void
}) {
  const hasReviewer = Boolean(document.summary)
  const sectionDone = document.sections.filter((section) => section.completed).length
  const cardsKnown = document.flashcards.filter((card) => card.known).length
  return (
    <section className="document-detail">
      <div className="detail-heading">
        <div className={`file-icon large-file-icon file-${document.kind}`}><Icon name={document.kind === 'pdf' ? 'file' : 'book'} size={23}/></div>
        <div className="detail-title"><p className="eyebrow">{document.kind.toUpperCase()} · ADDED {formatDate(document.createdAt).toUpperCase()}</p><h1>{document.title || document.name.replace(/\.[^.]+$/, '')}</h1><p>{document.name}</p></div>
      </div>

      {!hasReviewer ? <div className="make-reviewer-card">
        <div className="make-copy"><span className="make-icon"><Icon name="spark" size={20}/></span><div><strong>Ready to study?</strong><p>Make a clear summary, key points, terms, and flashcards.</p></div></div>
        <div className="make-actions"><button className="primary-button" onClick={onGenerate}><Icon name="spark" size={17}/> Make reviewer</button><button className="text-button" onClick={onCreateCard}><Icon name="plus" size={16}/> Create cards yourself</button></div>
      </div> : <>
        <div className="review-progress-card">
          <div className="review-progress-title"><div><p className="eyebrow">YOUR PROGRESS</p><strong>Keep your momentum.</strong></div><span className="streak-badge">{sectionDone + cardsKnown} done</span></div>
          <div className="progress-grid"><ProgressMetric label="Sections studied" done={sectionDone} total={document.sections.length} tint="green"/><ProgressMetric label="Cards known" done={cardsKnown} total={document.flashcards.length} tint="amber"/></div>
        </div>
        <div className="study-actions">
          <button className="study-action-card" onClick={onReader}><span className="action-icon green-bg"><Icon name="book" size={20}/></span><span><strong>Read reviewer</strong><small>{document.sections.length} sections · key points & terms</small></span><Icon name="arrow" size={17}/></button>
          <button className="study-action-card" onClick={onCards}><span className="action-icon amber-bg"><Icon name="cards" size={20}/></span><span><strong>Study flashcards</strong><small>{document.flashcards.length} cards · {cardsKnown} known</small></span><Icon name="arrow" size={17}/></button>
        </div>
        <div className="summary-preview"><p className="eyebrow">QUICK SUMMARY</p><p>{document.summary}</p><button className="inline-link" onClick={onReader}>Open full reviewer <Icon name="arrow" size={15}/></button></div>
        <div className="section-list-card"><div className="section-heading compact-heading"><div><p className="eyebrow">REVIEWER</p><h2>Sections</h2></div><button className="text-button" onClick={onReader}>Open <Icon name="arrow" size={15}/></button></div>
          <div className="section-checklist">{document.sections.map((section) => <label className={section.completed ? 'section-check done' : 'section-check'} key={section.id}><input type="checkbox" checked={section.completed} onChange={(event) => onToggleSection(section.id, event.target.checked)}/><span className="custom-check"><Icon name="check" size={13}/></span><span>{section.title}</span><small>{section.keyPoints.length} points</small></label>)}</div>
        </div>
      </>}

      {!hasReviewer && document.flashcards.length > 0 && <div className="study-actions standalone-cards"><button className="study-action-card" onClick={onCards}><span className="action-icon amber-bg"><Icon name="cards" size={20}/></span><span><strong>Study your flashcards</strong><small>{document.flashcards.length} cards · {cardsKnown} known</small></span><Icon name="arrow" size={17}/></button></div>}

      <div className="source-actions"><button className="quiet-button" onClick={onSource}><Icon name="file" size={16}/> View source & extracted text</button><button className="quiet-button danger-quiet" onClick={onDelete}><Icon name="trash" size={16}/> Delete file</button></div>
      {hasReviewer && <div className="manual-card-prompt"><span>Want more coverage or practice?</span><div className="manual-card-actions"><button className="text-button" onClick={onCreateCard}><Icon name="plus" size={16}/> Add a card</button><button className="text-button" onClick={onGenerate}><Icon name="spark" size={16}/> Regenerate reviewer</button></div></div>}
    </section>
  )
}

function ReviewerView({ document, onToggleSection }: { document: StudyDocument; onToggleSection: (id: string, completed: boolean) => void }) {
  return <section className="reviewer-view"><div className="reviewer-hero"><p className="eyebrow">YOUR REVIEWER</p><h1>{document.title || document.name.replace(/\.[^.]+$/, '')}</h1><p>{document.summary}</p></div>
    <div className="reviewer-sections">{document.sections.map((section, index) => <article className="reviewer-section" key={section.id}>
      <div className="reviewer-section-top"><span className="section-number">{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2><label className="complete-toggle"><input type="checkbox" checked={section.completed} onChange={(event) => onToggleSection(section.id, event.target.checked)}/><span className="custom-check"><Icon name="check" size={13}/></span><span>{section.completed ? 'Done' : 'Mark done'}</span></label></div>
      <ul className="key-points">{section.keyPoints.map((point, pointIndex) => <li key={`${section.id}-${pointIndex}`}>{point}</li>)}</ul>
      {!!section.terms.length && <div className="terms-block"><p className="eyebrow">KEY TERMS</p><dl>{section.terms.map((term, termIndex) => <div className="term-row" key={`${section.id}-term-${termIndex}`}><dt>{term.term}</dt><dd>{term.definition}</dd></div>)}</dl></div>}
    </article>)}</div>
  </section>
}

function FlashcardView({ document, index, flipped, onFlip, onRate, onPrevious, onNext, onAdd, onEdit, onDelete }: {
  document: StudyDocument
  index: number
  flipped: boolean
  onFlip: () => void
  onRate: (known: boolean) => void
  onPrevious: () => void
  onNext: () => void
  onAdd: () => void
  onEdit: (card: Flashcard) => void
  onDelete: (id: string) => void
}) {
  const card = document.flashcards[index]
  if (!card) return <section className="empty-state card-empty"><div className="empty-illustration progress-illustration"><Icon name="cards" size={32}/></div><h2>No cards yet.</h2><p>Add a card yourself or make an AI reviewer first.</p><button className="primary-button" onClick={onAdd}><Icon name="plus" size={17}/> Create flashcard</button></section>
  return <section className="flashcard-page"><div className="card-page-title"><div><p className="eyebrow">FLASHCARDS</p><h1>Recall builds memory.</h1><p>{document.title || document.name}</p></div><button className="text-button" onClick={onAdd}><Icon name="plus" size={16}/> Add card</button></div>
    <div className="deck-progress"><span>Card {index + 1} of {document.flashcards.length}</span><span>{document.flashcards.filter((item) => item.known).length} known</span></div>
    <div className="deck-track"><span style={{ width: `${progressPercent(index + 1, document.flashcards.length)}%` }}/></div>
    <button className={flipped ? 'flashcard flipped' : 'flashcard'} onClick={onFlip} aria-label={flipped ? 'Show question' : 'Show answer'}>
      <span className="card-side-label">{flipped ? 'ANSWER' : 'QUESTION'}</span><span className="flashcard-content">{flipped ? card.answer : card.question}</span><span className="flip-hint">Tap card to {flipped ? 'see question' : 'reveal answer'}</span>
    </button>
    <div className="card-controls"><button className="icon-button" aria-label="Previous card" onClick={onPrevious}>‹</button><button className="rate-button review-again" onClick={() => onRate(false)}><span>↺</span> Review again</button><button className="rate-button know-button" onClick={() => onRate(true)}><Icon name="check" size={17}/> Know it</button><button className="icon-button" aria-label="Next card" onClick={onNext}>›</button></div>
    <div className="card-management"><button className="quiet-button" onClick={() => onEdit(card)}>Edit card</button><button className="quiet-button danger-quiet" onClick={() => onDelete(card.id)}>Delete</button></div>
    <div className="deck-note">Your choices stay on this device. Marked cards can be reviewed again any time.</div>
  </section>
}

function SourceView({ document }: { document: StudyDocument }) {
  const imageUrl = useMemo(() => document.kind === 'image' ? URL.createObjectURL(document.file) : '', [document])
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])
  return <section className="source-view"><div className="source-view-heading"><p className="eyebrow">SOURCE FILE</p><h1>{document.name}</h1><p>Your original stays in local browser storage.</p></div>
    {document.kind === 'pdf' ? <PdfReader file={document.file}/> : document.kind === 'image' ? <img className="source-image" src={imageUrl} alt={document.name}/> : <div className="office-preview"><div className="office-preview-label"><Icon name={document.kind === 'pptx' ? 'cards' : 'file'} size={18}/>{document.kind === 'pptx' ? 'Slide text preview' : 'Document preview'}</div><pre>{document.extractedText}</pre></div>}
    <div className="extracted-text"><p className="eyebrow">EXTRACTED TEXT</p><pre>{document.extractedText}</pre></div>
  </section>
}

function CardEditor({ initial, onClose, onSave }: { initial: Flashcard | null; onClose: () => void; onSave: (question: string, answer: string) => void }) {
  const [question, setQuestion] = useState(initial?.question ?? '')
  const [answer, setAnswer] = useState(initial?.answer ?? '')
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="modal-card card-editor" onSubmit={(event) => { event.preventDefault(); onSave(question, answer) }}>
    <button type="button" className="modal-close" aria-label="Close" onClick={onClose}><Icon name="close" size={19}/></button><span className="modal-icon amber-bg"><Icon name="cards" size={22}/></span><p className="eyebrow">YOUR FLASHCARDS</p><h2>{initial ? 'Edit card' : 'Create a card'}</h2>
    <label className="form-label">Question<textarea autoFocus rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What do you want to remember?" required maxLength={500}/></label>
    <label className="form-label">Answer<textarea rows={4} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Write a clear, short answer…" required maxLength={1200}/></label>
    <button className="primary-button modal-submit" type="submit" disabled={!question.trim() || !answer.trim()}>{initial ? 'Save changes' : 'Add flashcard'}<Icon name="arrow" size={17}/></button>
  </form></div>
}

export default App
