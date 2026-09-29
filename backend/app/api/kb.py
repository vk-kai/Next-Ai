"""知识库管理接口：命名空间、文档列表、删除。"""

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import func

from app.db import SessionLocal
from app.learning.ingest import delete_document
from app.models import Chunk, Collection, Document

router = APIRouter()


class CollectionUpdate(BaseModel):
    description: str


@router.get("/kb/collections")
def list_collections():
    with SessionLocal() as db:
        doc_count = (
            db.query(
                Document.collection,
                func.count(Document.id),
            )
            .group_by(Document.collection)
            .all()
        )
        doc_map = {name: count for name, count in doc_count}
        chunk_count = (
            db.query(Chunk.collection, func.count(Chunk.id))
            .group_by(Chunk.collection)
            .all()
        )
        chunk_map = {name: count for name, count in chunk_count}
        digest_count = (
            db.query(Document.collection, func.count(Document.id))
            .filter(Document.doc_type == "digest")
            .group_by(Document.collection)
            .all()
        )
        digest_map = {name: count for name, count in digest_count}
        collections = db.query(Collection).order_by(Collection.name).all()
        return [
            {
                "name": c.name,
                "description": c.description,
                "documents": doc_map.get(c.name, 0),
                "chunks": chunk_map.get(c.name, 0),
                "digests": digest_map.get(c.name, 0),
            }
            for c in collections
        ]


@router.put("/kb/collections/{name}")
def update_collection(name: str, body: CollectionUpdate):
    with SessionLocal() as db:
        collection = db.get(Collection, name)
        if not collection:
            raise HTTPException(status_code=404, detail="知识库不存在")
        collection.description = body.description
        db.commit()
        return {"name": collection.name, "description": collection.description}


@router.get("/kb/documents")
def list_documents(collection: str = "default"):
    with SessionLocal() as db:
        docs = (
            db.query(Document)
            .filter(Document.collection == collection)
            .order_by(Document.created_at.desc())
            .all()
        )
        return [
            {
                "id": d.id,
                "title": d.title,
                "source_type": d.source_type,
                "doc_type": d.doc_type,
                "chunks": d.chunk_count,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in docs
        ]


@router.delete("/kb/documents/{document_id}", status_code=204)
def remove_document(document_id: str):
    with SessionLocal() as db:
        if not delete_document(db, document_id):
            raise HTTPException(status_code=404, detail="文档不存在")
        db.commit()
    return Response(status_code=204)
