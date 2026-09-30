import { listDocuments, saveDocument } from './db'
import type { StudyDocument } from './types'

interface BackupManifest {
  version: 1
  documents: Array<Omit<StudyDocument, 'file'>>
}

export async function downloadBackup(): Promise<void> {
  const { default: JSZip } = await import('jszip')
  const documents = await listDocuments()
  const zip = new JSZip()
  const manifest: BackupManifest = {
    version: 1,
    documents: documents.map(({ file: _file, ...document }) => document),
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  for (const document of documents) zip.file(`files/${document.id}.source`, document.file)

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `simple-reviewer-backup-${new Date().toISOString().slice(0, 10)}.zip`
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function restoreBackup(file: File): Promise<number> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new Error('Backup file is missing its manifest.')
  const manifest = JSON.parse(await manifestFile.async('text')) as BackupManifest
  if (manifest.version !== 1 || !Array.isArray(manifest.documents)) throw new Error('This backup version is not supported.')

  let restored = 0
  for (const document of manifest.documents) {
    const source = zip.file(`files/${document.id}.source`)
    if (!source || !document.id || !document.name) continue
    const sourceBlob = await source.async('blob')
    await saveDocument({ ...document, file: sourceBlob })
    restored += 1
  }
  return restored
}
