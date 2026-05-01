import uuid
from datetime import datetime
from pydantic import BaseModel
from app.schemas.user import UserResponse
from app.schemas.comment import CommentResponse


class AnswerCreate(BaseModel):
    body: str


class AnswerUpdate(BaseModel):
    body: str


class AnswerResponse(BaseModel):
    answer_id: uuid.UUID
    post_id: uuid.UUID
    author_id: uuid.UUID
    body: str
    is_accepted: bool
    is_pinned: bool
    vote_count: int
    created_at: datetime
    updated_at: datetime
    author: UserResponse
    comments: list[CommentResponse] = []
    user_vote: str | None = None

    model_config = {"from_attributes": True}
