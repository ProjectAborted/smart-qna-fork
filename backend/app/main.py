import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.api import auth, posts, answers, comments, votes, tags, notifications, attachments, health, admin

# Ensure uploads directory exists before StaticFiles mounts it
os.makedirs("uploads", exist_ok=True)

app = FastAPI(title="Smart Q&A API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-Id-Token"],
)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

app.include_router(health.router,        prefix="/api/v1",               tags=["Health"])
app.include_router(auth.router,          prefix="/api/v1/auth",          tags=["Auth"])
app.include_router(posts.router,         prefix="/api/v1/posts",         tags=["Posts"])
app.include_router(answers.router,       prefix="/api/v1",               tags=["Answers"])
app.include_router(comments.router,      prefix="/api/v1",               tags=["Comments"])
app.include_router(votes.router,         prefix="/api/v1",               tags=["Votes"])
app.include_router(tags.router,          prefix="/api/v1/tags",          tags=["Tags"])
app.include_router(notifications.router, prefix="/api/v1/notifications", tags=["Notifications"])
app.include_router(attachments.router,   prefix="/api/v1/attachments",   tags=["Attachments"])
app.include_router(admin.router,         prefix="/api/v1",               tags=["Admin"])

