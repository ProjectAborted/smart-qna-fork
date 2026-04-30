"""Semantic similarity search using pgvector and Amazon Bedrock."""
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.bedrock import generate_embedding


async def find_similar_posts(
    db: AsyncSession,
    query_text: str,
    exclude_post_id: uuid.UUID | None = None,
    limit: int = 5,
    min_similarity: float = 0.75,
) -> list[dict]:
    """
    Generates an embedding for query_text and finds the top `limit`
    most semantically similar posts using cosine distance via pgvector.
    Returns an empty list if Bedrock is unavailable or no matches found.
    """
    embedding = await generate_embedding(query_text)
    if embedding is None:
        return []

    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

    if exclude_post_id:
        stmt = text("""
            SELECT post_id, title, 1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
            FROM posts
            WHERE embedding IS NOT NULL
              AND post_id != CAST(:exclude_id AS uuid)
            ORDER BY embedding <=> CAST(:embedding AS vector)
            LIMIT :limit
        """)
        params = {"embedding": embedding_str, "exclude_id": str(exclude_post_id), "limit": limit}
    else:
        stmt = text("""
            SELECT post_id, title, 1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
            FROM posts
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> CAST(:embedding AS vector)
            LIMIT :limit
        """)
        params = {"embedding": embedding_str, "limit": limit}

    result = await db.execute(stmt, params)

    return [
        {
            "post_id": row.post_id,
            "title": row.title,
            "similarity": round(float(row.similarity), 3),
        }
        for row in result.fetchall()
        if float(row.similarity) >= min_similarity
    ]
