import re
from pathlib import Path

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import fitz


BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6",
              "blockquote", "pre", "li", "tr", "section", "article"}


def _clean_pdf_text(text: str) -> str:
    """Join soft-wrapped lines in PDF text into flowing paragraphs."""
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    paragraphs = text.split("\n\n")
    cleaned = []
    for para in paragraphs:
        joined = re.sub(r"\n", " ", para.strip())
        joined = re.sub(r" {2,}", " ", joined).strip()
        if joined:
            cleaned.append(joined)
    return "\n\n".join(cleaned)


def _extract_item_text(item) -> str:
    """Extract clean paragraph text from an EpubHtml item."""
    body_content = item.get_body_content()
    if not body_content:
        return ""
    soup = BeautifulSoup(body_content, "html.parser")

    blocks = soup.find_all(BLOCK_TAGS)
    if blocks:
        paragraphs = []
        for block in blocks:
            if block.find(BLOCK_TAGS):
                continue
            text = block.get_text("", strip=False)
            text = re.sub(r"\s+", " ", text).strip()
            if text:
                paragraphs.append(text)
        return "\n\n".join(paragraphs)
    else:
        text = soup.get_text("", strip=False)
        return re.sub(r"\s+", " ", text).strip()


def _flatten_toc(toc) -> list[tuple[str, str]]:
    """Flatten nested TOC into list of (title, href) tuples."""
    entries = []
    for entry in toc:
        if isinstance(entry, epub.Link):
            entries.append((entry.title, entry.href))
        elif isinstance(entry, tuple) and len(entry) == 2:
            # (Section, [children]) — recurse into children
            _, children = entry
            entries.extend(_flatten_toc(children))
    return entries


def extract_epub_chapters(file_path: str) -> list[tuple[str, str]]:
    book = epub.read_epub(file_path)

    # Build lookup from file name to item
    items_by_name: dict[str, epub.EpubHtml] = {}
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        items_by_name[item.get_name()] = item

    # Use TOC for chapter titles and order
    toc_entries = _flatten_toc(book.toc)

    chapters = []
    if toc_entries:
        for title, href in toc_entries:
            # href may contain fragment (#section), strip it to get file name
            file_name = href.split("#")[0]
            item = items_by_name.get(file_name)
            if not item:
                continue
            text = _extract_item_text(item)
            if len(text) > 50:
                chapters.append((title, text))
    else:
        # Fallback: no TOC, use spine order
        for idref, _ in book.spine:
            item = book.get_item_with_id(idref)
            if not item or item.get_type() != ebooklib.ITEM_DOCUMENT:
                continue
            text = _extract_item_text(item)
            if len(text) > 50:
                soup = BeautifulSoup(item.get_content(), "html.parser")
                title_el = soup.find(["h1", "h2", "h3"])
                name = title_el.get_text(strip=True) if title_el else item.get_name()
                chapters.append((name, text))

    return chapters


def extract_pdf_pages(file_path: str) -> list[tuple[str, str]]:
    doc = fitz.open(file_path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text().strip()
        text = _clean_pdf_text(text)
        if len(text) > 20:
            pages.append((f"Page {i + 1}", text))
    doc.close()
    return pages


def extract_chapters(file_path: str) -> list[tuple[str, str]]:
    ext = Path(file_path).suffix.lower()
    if ext == ".epub":
        return extract_epub_chapters(file_path)
    elif ext == ".pdf":
        return extract_pdf_pages(file_path)
    else:
        raise ValueError(f"Unsupported format: {ext}")
