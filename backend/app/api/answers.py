import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.core.dependencies import get_current_user, get_current_user_with_claims, require_role
from app.models.user import User
from app.models.answer import Answer
from app.models.comment import Comment
from app.models.post import Post
from app.schemas.answer import AnswerCreate, AnswerUpdate, AnswerResponse
from app.services.answer_service import accept_answer
from app.services.notification_service import notify

router = APIRouter()
logger = logging.getLogger(__name__)


async def _load_answer(db: AsyncSession, answer_id: uuid.UUID) -> Answer:
    result = await db.execute(
        select(Answer)
        .options(
            selectinload(Answer.author),
            selectinload(Answer.comments).selectinload(Comment.author),
            selectinload(Answer.votes),
        )
        .where(Answer.answer_id == answer_id)
    )
    answer = result.scalar_one_or_none()
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")
    return answer


@router.post("/posts/{post_id}/answers", response_model=AnswerResponse, status_code=201)
async def submit_answer(
    post_id: uuid.UUID,
    data: AnswerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = await db.get(Post, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    answer = Answer(post_id=post_id, author_id=current_user.user_id, body=data.body)
    db.add(answer)
    post.answer_count += 1
    await db.flush()

    if post.author_id != current_user.user_id:
        try:
            await notify(
                db,
                recipient_id=post.author_id,
                type="ANSWER",
                reference_id=answer.answer_id,
                message=f"{current_user.display_name} answered your question: {post.title[:60]}",
            )
        except Exception:
            logger.exception("Failed to publish answer notification")

    return await _load_answer(db, answer.answer_id)


@router.patch("/answers/{answer_id}", response_model=AnswerResponse)
async def update_answer(
    answer_id: uuid.UUID,
    data: AnswerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    answer = await db.get(Answer, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")
    if answer.author_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    answer.body = data.body
    await db.flush()
    return await _load_answer(db, answer_id)


@router.patch("/answers/{answer_id}/accept", response_model=AnswerResponse)
async def accept_answer_endpoint(
    answer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    answer = await db.get(Answer, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")

    answer = await accept_answer(db, answer, current_user.user_id)

    if answer.author_id != current_user.user_id:
        try:
            await notify(
                db,
                recipient_id=answer.author_id,
                type="ACCEPTED",
                reference_id=answer.answer_id,
                message="Your answer was accepted!",
            )
        except Exception:
            logger.exception("Failed to publish accepted-answer notification")

    return await _load_answer(db, answer_id)


@router.patch("/answers/{answer_id}/pin", response_model=AnswerResponse)
async def pin_answer(
    answer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("TA", "ADMIN")),
):
    answer = await db.get(Answer, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")

    answer.is_pinned = not answer.is_pinned
    await db.flush()
    return await _load_answer(db, answer_id)


@router.delete("/answers/{answer_id}", status_code=204)
async def delete_answer(
    answer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_and_claims: tuple[User, dict] = Depends(get_current_user_with_claims),
):
    current_user, claims = user_and_claims
    answer = await db.get(Answer, answer_id)
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")
    user_groups = claims.get("cognito:groups", [])
    is_privileged = any(g in user_groups for g in ("TA", "ADMIN"))
    if answer.author_id != current_user.user_id and not is_privileged:
        raise HTTPException(status_code=403, detail="Not authorized")

    post = await db.get(Post, answer.post_id)
    if post:
        post.answer_count = max(0, post.answer_count - 1)

    await db.delete(answer)
    await db.flush()
