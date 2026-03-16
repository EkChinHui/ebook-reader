import os
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles

from .book import extract_chapters

app = FastAPI()

# In-memory book storage keyed by session id
_books: dict[str, list[tuple[str, str]]] = {}


@app.post("/api/upload")
async def upload_book(file: UploadFile):
    if not file.filename:
        raise HTTPException(400, "No file provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in (".epub", ".pdf"):
        raise HTTPException(400, "Unsupported format. Use EPUB or PDF.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        chapters = extract_chapters(tmp_path)
    finally:
        os.unlink(tmp_path)

    if not chapters:
        raise HTTPException(400, "No readable text found.")

    book_id = uuid.uuid4().hex[:8]
    _books[book_id] = chapters

    return {
        "book_id": book_id,
        "chapters": [{"index": i, "title": name} for i, (name, _) in enumerate(chapters)],
    }


@app.get("/api/books/{book_id}/chapters/{index}")
async def get_chapter(book_id: str, index: int):
    chapters = _books.get(book_id)
    if not chapters:
        raise HTTPException(404, "Book not found")
    if index < 0 or index >= len(chapters):
        raise HTTPException(404, "Chapter not found")

    name, text = chapters[index]
    return {"title": name, "text": text}


# Serve frontend static files in production
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
