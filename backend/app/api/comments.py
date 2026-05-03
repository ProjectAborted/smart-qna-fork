import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.core.dependencies import get_current_user, get_current_user_with_claims
from app.models.user import User
from app.models.comment import Comment
from app.models.post import Post
from app.models.answer import Answer
from app.schemas.comment import CommentCreate, CommentResponse
from app.services.notification_service import notify

router = APIRouter()


async def _load_comment(db: AsyncSession, comment_id: uuid.UUID) -> Comment:
    result = await db.execute(
        select(Comment)
        .options(selectinload(Comment.author))
        .where(Comment.comment_id == comment_id)
    )
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


@router.post("/posts/{post_id}/comments", response_model=CommentResponse, status_code=201)
async def comment_on_post(
    post_id: uuid.UUID,
    data: CommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = await db.get(Post, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    comment = Comment(post_id=post_id, author_id=current_user.user_id, body=data.body)
    db.add(comment)
    await db.flush()

    if post.author_id != current_user.user_id:
        await notify(
            db,
            recipient_id=post.author_id,
            type="COMMENT",
            reference_id=comment.comment_id,
            message=f"{current_user.display_name} commented on your question.",
        )

    return await _load_comment(db, comment.comment_id)


@router.post("/answers/{answer_id}/comments", response_model=CommentResponse, status_code=201)
async def comment_on_answer(
    answer_id: uuid.UUID,
    data: CommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    answer = await db.get(Answer, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")

    comment = Comment(answer_id=answer_id, author_id=current_user.user_id, body=data.body)
    db.add(comment)
    await db.flush()

    if answer.author_id != current_user.user_id:
        await notify(
            db,
            recipient_id=answer.author_id,
            type="COMMENT",
            reference_id=comment.comment_id,
            message=f"{current_user.display_name} commented on your answer.",
        )

    return await _load_comment(db, comment.comment_id)


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_and_claims: tuple[User, dict] = Depends(get_current_user_with_claims),
):
    current_user, claims = user_and_claims
    comment = await db.get(Comment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    user_groups = claims.get("cognito:groups", [])
    is_privileged = any(g in user_groups for g in ("TA", "ADMIN"))
    if comment.author_id != current_user.user_id and not is_privileged:
        raise HTTPException(status_code=403, detail="Not authorized")

    await db.delete(comment)
    await db.flush()