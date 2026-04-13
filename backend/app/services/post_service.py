import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from fastapi import HTTPException

from app.models.post import Post
from app.models.answer import Answer
from app.models.attachment import Attachment
from app.models.comment import Comment
from app.models.tag import Tag
from app.schemas.post import PostCreate, PostUpdate
from app.core.bedrock import generate_embedding


async def get_post_with_relations(db: AsyncSession, post_id: uuid.UUID) -> Post:
    result = await db.execute(
        select(Post)
        .options(
            selectinload(Post.author),
            selectinload(Post.tags),
            selectinload(Post.answers).selectinload(Answer.author),
            selectinload(Post.answers).selectinload(Answer.comments).selectinload(Comment.author),
            selectinload(Post.answers).selectinload(Answer.votes),
            selectinload(Post.comments).selectinload(Comment.author),
            selectinload(Post.votes),
            selectinload(Post.attachments),
        )
        .where(Post.post_id == post_id)
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


async def create_post(db: AsyncSession, data: PostCreate, author_id: uuid.UUID) -> Post:
    post = Post(title=data.title, body=data.body, author_id=author_id)

    if data.tag_ids:
        result = await db.execute(select(Tag).where(Tag.tag_id.in_(data.tag_ids)))
        post.tags = list(result.scalars().all())

    db.add(post)
    await db.flush()
    await db.refresh(post)

    # Generate and store semantic embedding for AI similarity search
    embedding = await generate_embedding(f"{data.title}\n\n{data.body}")
    if embedding:
        post.embedding = embedding
        await db.flush()

    return post


async def update_post(db: AsyncSession, post: Post, data: PostUpdate) -> Post:
    if data.title is not None:
        post.title = data.title
    if data.body is not None:
        post.body = data.body
    if data.tag_ids is not None:
        result = await db.execute(select(Tag).where(Tag.tag_id.in_(data.tag_ids)))
        post.tags = list(result.scalars().all())

    await db.flush()
    await db.refresh(post)
    return post
