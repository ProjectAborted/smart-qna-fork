import uuid
from datetime import datetime, timezone
from sqlalchemy import Text, Boolean, Integer, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Answer(Base):
    __tablename__ = "answers"

    answer_id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.post_id", ondelete="CASCADE"), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.user_id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    vote_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    post = relationship("Post", back_populates="answers")
    author = relationship("User", back_populates="answers")
    comments = relationship("Comment", back_populates="answer", cascade="all, delete-orphan")
    votes = relationship("Vote", back_populates="answer", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_answers_post_id", "post_id"),
        Index("idx_answers_author_id", "author_id"),
    )
