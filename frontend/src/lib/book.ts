import ePub from 'epubjs'
import type { NavItem } from 'epubjs/types/navigation'
import * as pdfjsLib from 'pdfjs-dist'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString()

export interface Chapter {
  title: string
  text: string
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'li', 'tr', 'section', 'article',
])

function extractTextFromHtml(html: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  const blocks = doc.querySelectorAll(
    'p, div, h1, h2, h3, h4, h5, h6, blockquote, pre, li, tr, section, article',
  )

  if (blocks.length > 0) {
    const paragraphs: string[] = []
    for (const block of blocks) {
      // Skip blocks that contain other block elements (avoid duplicates)
      const hasNestedBlock = block.querySelector(
        'p, div, h1, h2, h3, h4, h5, h6, blockquote, pre, li, tr, section, article',
      )
      if (hasNestedBlock) continue

      const text = (block.textContent || '').replace(/\s+/g, ' ').trim()
      if (text) paragraphs.push(text)
    }
    return paragraphs.join('\n\n')
  } else {
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
  }
}

function cleanPdfText(text: string): string {
  // Normalize line endings
  text = text.replace(/\r\n?/g, '\n')
  // Collapse 3+ newlines to 2
  text = text.replace(/\n{3,}/g, '\n\n')

  const paragraphs = text.split('\n\n')
  const cleaned: string[] = []
  for (const para of paragraphs) {
    let joined = para.trim().replace(/\n/g, ' ')
    joined = joined.replace(/ {2,}/g, ' ').trim()
    if (joined) cleaned.push(joined)
  }
  return cleaned.join('\n\n')
}

function flattenNav(items: NavItem[]): { label: string; href: string }[] {
  const result: { label: string; href: string }[] = []
  for (const item of items) {
    result.push({ label: item.label.trim(), href: item.href })
    if (item.subitems && item.subitems.length > 0) {
      result.push(...flattenNav(item.subitems))
    }
  }
  return result
}

async function parseEpub(arrayBuffer: ArrayBuffer): Promise<Chapter[]> {
  const book = ePub(arrayBuffer)
  await book.ready

  const navigation = await book.loaded.navigation
  const tocEntries = flattenNav(navigation.toc)

  const chapters: Chapter[] = []

  if (tocEntries.length > 0) {
    // Use TOC for chapter titles and order
    const seen = new Set<string>()
    for (const { label, href } of tocEntries) {
      const fileName = href.split('#')[0]
      if (seen.has(fileName)) continue
      seen.add(fileName)

      const section = book.spine.get(fileName)
      if (!section) continue

      const contents = await section.load(book.load.bind(book))
      const html = contents.innerHTML || contents.outerHTML || ''
      const text = extractTextFromHtml(html)

      if (text.length > 50) {
        chapters.push({ title: label, text })
      }
    }
  } else {
    // Fallback: use spine order
    const spine = book.spine as any
    const items = spine.items || spine.spineItems || []
    for (const item of items) {
      const contents = await item.load(book.load.bind(book))
      const html = contents.innerHTML || contents.outerHTML || ''
      const text = extractTextFromHtml(html)

      if (text.length > 50) {
        // Try to find a heading for the title
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')
        const heading = doc.querySelector('h1, h2, h3')
        const title = heading?.textContent?.trim() || item.href || `Section ${chapters.length + 1}`
        chapters.push({ title, text })
      }
    }
  }

  book.destroy()
  return chapters
}

async function parsePdf(arrayBuffer: ArrayBuffer): Promise<Chapter[]> {
  const data = new Uint8Array(arrayBuffer)
  const pdf = await pdfjsLib.getDocument({ data }).promise

  const pages: Chapter[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()

    let fullText = ''
    let lastY: number | null = null

    for (const item of textContent.items) {
      if (!('str' in item)) continue
      const textItem = item as { str: string; transform: number[]; hasEOL: boolean }
      if (lastY !== null && Math.abs(textItem.transform[5] - lastY) > 5) {
        fullText += '\n'
      }
      fullText += textItem.str
      lastY = textItem.transform[5]
    }

    const cleaned = cleanPdfText(fullText.trim())
    if (cleaned.length > 20) {
      pages.push({ title: `Page ${i}`, text: cleaned })
    }
  }

  await pdf.destroy()
  return pages
}

export async function parseBook(file: File): Promise<Chapter[]> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const arrayBuffer = await file.arrayBuffer()

  if (ext === 'epub') {
    return parseEpub(arrayBuffer)
  } else if (ext === 'pdf') {
    return parsePdf(arrayBuffer)
  } else {
    throw new Error(`Unsupported format: .${ext}`)
  }
}
