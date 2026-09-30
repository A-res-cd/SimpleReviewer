export type FileKind = 'pdf' | 'docx' | 'pptx' | 'txt' | 'image'

export interface KeyTerm {
  term: string
  definition: string
}

export interface ReviewerSection {
  id: string
  title: string
  keyPoints: string[]
  terms: KeyTerm[]
  completed: boolean
}

export interface Flashcard {
  id: string
  question: string
  answer: string
  known: boolean
  origin: 'ai' | 'manual'
}

export interface StudyDocument {
  id: string
  name: string
  mimeType: string
  kind: FileKind
  createdAt: number
  file: Blob
  extractedText: string
  title: string
  summary: string
  sections: ReviewerSection[]
  flashcards: Flashcard[]
}

export interface GeneratedReviewer {
  title: string
  summary: string
  sections: Array<{
    title: string
    keyPoints: string[]
    terms: KeyTerm[]
  }>
  flashcards: Array<{
    question: string
    answer: string
  }>
}

export interface ExtractionProgress {
  message: string
  percent: number
}
