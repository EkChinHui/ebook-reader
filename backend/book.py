import re
from pathlib import Path

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
import fitz


def extract_epub_chapters(file_path: str) -> list[tuple[str, str]]:
    book = epub.read_epub(file_path)
    chapters = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        text = soup.get_text(separator="\n", strip=True)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if len(text) > 50:
            title = soup.find(["h1", "h2", "h3"])
            name = title.get_text(strip=True) if title else item.get_name()
            chapters.append((name, text))
    return chapters


def extract_pdf_pages(file_path: str) -> list[tuple[str, str]]:
    doc = fitz.open(file_path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text().strip()
        text = re.sub(r"\n{3,}", "\n\n", text)
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
