import uuid
from datetime import datetime
from pydantic import BaseModel
from app.schemas.user import UserResponse
from app.schemas.tag import TagBase
from app.schemas.answer import AnswerResponse
from app.schemas.attachment import AttachmentResponse
from app.schemas.comment import CommentResponse


class PostCreate(BaseModel):
    title: str
    body: str
    tag_ids: list[uuid.UUID] = []


class PostUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    tag_ids: list[uuid.UUID] | None = None


class PostSummary(BaseModel):
    post_id: uuid.UUID
    title: str
    status: str
    vote_count: int
    answer_count: int
    view_count: int
    is_pinned: bool
    created_at: datetime
    updated_at: datetime
    author: UserResponse
    tags: list[TagBase] = []

    model_config = {"from_attributes": True}


class PostResponse(PostSummary):
    body: str


class PostDetailResponse(PostResponse):
    answers: list[AnswerResponse] = []
    comments: list[CommentResponse] = []
    attachments: list[AttachmentResponse] = []
    user_vote: str | None = None


class PostListResponse(BaseModel):
    items: list[PostSummary]
    total: int
    page: int
    size: int
    pages: int


class SimilarPostsRequest(BaseModel):
    text: str


class SimilarPostResult(BaseModel):
    post_id: uuid.UUID
    title: str
    similarity: float

    model_config = {"from_attributes": True}


class SimilarPostsResponse(BaseModel):
    results: list[SimilarPostResult]
