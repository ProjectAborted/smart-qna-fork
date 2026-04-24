import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.notification import Notification


async def notify(
    db: AsyncSession,
    recipient_id: uuid.UUID,
    type: str,
    reference_id: uuid.UUID,
    message: str,
):
    """Local: direct DB insert. In production, replace with SQS publish."""
    notification = Notification(
        user_id=recipient_id,
        type=type,
        reference_id=reference_id,
        message=message,
    )
    db.add(notification)
    await db.flush()
