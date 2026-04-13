import uuid
import os
from functools import partial
import asyncio
import boto3
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
import aiofiles

from app.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.models.attachment import Attachment
from app.schemas.attachment import AttachmentResponse
from app.config import settings
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()

UPLOAD_DIR = "uploads"
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "application/pdf", "text/plain",
    "application/zip",
}


def _get_s3_client():
    return boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None,
    )


async def _upload_to_s3(content: bytes, key: str, content_type: str) -> str:
    """Upload bytes to S3 and return the public URL."""
    loop = asyncio.get_event_loop()
    s3 = _get_s3_client()
    put = partial(
        s3.put_object,
        Bucket=settings.S3_BUCKET_ATTACHMENTS,
        Key=key,
        Body=content,
        ContentType=content_type,
    )
    await loop.run_in_executor(None, put)
    return (
        f"https://{settings.S3_BUCKET_ATTACHMENTS}.s3."
        f"{settings.AWS_REGION}.amazonaws.com/{key}"
    )


@router.post("/upload", response_model=AttachmentResponse, status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    post_id: uuid.UUID | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="File type not allowed")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    stored_filename = f"{uuid.uuid4()}_{file.filename}"

    if settings.S3_BUCKET_ATTACHMENTS:
        s3_key = f"attachments/{stored_filename}"
        try:
            url = await _upload_to_s3(content, s3_key, file.content_type)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"S3 upload failed: {e}")
    else:
        # Local fallback for development
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        file_path = os.path.join(UPLOAD_DIR, stored_filename)
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content)
        url = f"/uploads/{stored_filename}"

    attachment = Attachment(
        post_id=post_id,
        uploader_id=current_user.user_id,
        filename=file.filename,
        stored_filename=stored_filename,
        content_type=file.content_type,
        file_size=len(content),
        url=url,
    )
    db.add(attachment)
    await db.flush()
    await db.refresh(attachment)
    return attachment
