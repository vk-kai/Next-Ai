"""文本分块：按段落切分，超长段落按句子切分，小块再合并，带少量重叠。"""

import re


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 120) -> list[str]:
    text = re.sub(r"\r\n", "\n", (text or "")).strip()
    if not text:
        return []

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]

    pieces: list[str] = []
    for para in paragraphs:
        if len(para) <= chunk_size:
            pieces.append(para)
            continue
        # 超长段落：按中英文句末标点/换行切句
        sentences = [s for s in re.split(r"(?<=[。！？!?\n])", para) if s.strip()]
        buf = ""
        for sent in sentences:
            if len(buf) + len(sent) > chunk_size and buf:
                pieces.append(buf)
                buf = buf[-overlap:] if 0 < overlap < len(buf) else ""
            # 单句超长时硬切
            while len(sent) > chunk_size:
                pieces.append(sent[:chunk_size])
                sent = sent[chunk_size - overlap :] if overlap else sent[chunk_size:]
            buf += sent
        if buf.strip():
            pieces.append(buf)

    chunks: list[str] = []
    buf = ""
    for piece in pieces:
        if len(buf) + len(piece) + 1 <= chunk_size:
            buf = f"{buf}\n{piece}" if buf else piece
        else:
            if buf:
                chunks.append(buf)
            buf = piece if len(piece) <= chunk_size else piece[:chunk_size]
    if buf:
        chunks.append(buf)
    return [c.strip() for c in chunks if c.strip()]
