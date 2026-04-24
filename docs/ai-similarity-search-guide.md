# AI Similarity Search — Complete Implementation Guide

**Project:** Smart Q&A  
**Feature:** Semantic duplicate question detection using Amazon Bedrock + pgvector  
**Stack:** FastAPI · PostgreSQL · pgvector · Amazon Bedrock (Titan Embeddings) · React 18

---

## Table of Contents

1. [What We Built](#1-what-we-built)
2. [How It Works — The Concept](#2-how-it-works--the-concept)
3. [What Are Embeddings?](#3-what-are-embeddings)
4. [What Is pgvector?](#4-what-is-pgvector)
5. [What Is Amazon Bedrock?](#5-what-is-amazon-bedrock)
6. [Architecture of the Feature](#6-architecture-of-the-feature)
7. [Step-by-Step Implementation](#7-step-by-step-implementation)
   - [Step 1 — Install Dependencies](#step-1--install-dependencies)
   - [Step 2 — Configure Settings](#step-2--configure-settings)
   - [Step 3 — Enable pgvector + Add Embedding Column](#step-3--enable-pgvector--add-embedding-column)
   - [Step 4 — Update the Post Model](#step-4--update-the-post-model)
   - [Step 5 — Create the Bedrock Client](#step-5--create-the-bedrock-client)
   - [Step 6 — Create the Similarity Service](#step-6--create-the-similarity-service)
   - [Step 7 — Add API Schemas](#step-7--add-api-schemas)
   - [Step 8 — Store Embeddings on Post Creation](#step-8--store-embeddings-on-post-creation)
   - [Step 9 — Add the API Endpoint](#step-9--add-the-api-endpoint)
   - [Step 10 — Connect the Frontend](#step-10--connect-the-frontend)
8. [AWS Setup Requirements](#8-aws-setup-requirements)
9. [Local Development Setup](#9-local-development-setup)
10. [How the Vector Search Query Works](#10-how-the-vector-search-query-works)
11. [Bugs We Hit and How We Fixed Them](#11-bugs-we-hit-and-how-we-fixed-them)
12. [Tuning and Configuration](#12-tuning-and-configuration)
13. [How to Extend This Feature](#13-how-to-extend-this-feature)

---

## 1. What We Built

When a user starts typing a new question on the "Ask a Question" page, the app automatically detects if semantically similar questions already exist and shows them in a panel before the user submits.

**Example:**
- Existing post: *"How do I sort a list in Python?"*
- User types: *"What is the best way to order elements in a Python array?"*
- Result: The panel appears showing the existing post with a **91% match** score

This works even though the two questions share almost no keywords — it matches by *meaning*, not by words.

---

## 2. How It Works — The Concept

Traditional text search (like the PostgreSQL full-text search already in this project) matches **keywords**. If you search for "order elements Python", it finds posts containing those exact words.

Semantic search matches **meaning**. It converts text into a mathematical representation (a vector) and finds other texts whose vectors are close in multi-dimensional space.

```
"How do I sort a list in Python?"
          │
          ▼ Amazon Bedrock Titan Embeddings
          │
[0.269, -0.411, 0.094, ..., 0.358]  ← 1536 numbers representing the meaning
          │
          ▼ pgvector cosine distance search
          │
Find all posts whose vectors are within 0.25 cosine distance of this vector
          │
          ▼
Return top 5 matches with similarity scores
```

The key insight: words with similar meanings produce vectors that are mathematically close to each other. "Sort", "order", and "arrange" all produce vectors that cluster near each other in the 1536-dimensional space.

---

## 3. What Are Embeddings?

An **embedding** is a list of floating-point numbers that represents the semantic meaning of a piece of text. The Amazon Bedrock Titan Embeddings model produces vectors of **1536 dimensions** — meaning each text is converted into a list of 1536 numbers.

```python
"How do I sort a list in Python?"
→ [-0.2695, -0.3691, 0.0937, -0.2460, -0.4257, ..., 0.3554]
   # 1536 numbers total
```

Two texts with similar meanings will have similar vectors. Two texts with unrelated meanings will have very different vectors. This is measured using **cosine distance** — a value between 0 and 1 where:

| Cosine Distance | Cosine Similarity | Meaning |
|---|---|---|
| 0.0 | 1.0 (100%) | Identical meaning |
| 0.1 | 0.9 (90%) | Very similar |
| 0.25 | 0.75 (75%) | Meaningfully similar |
| 0.5 | 0.5 (50%) | Weakly related |
| 1.0 | 0.0 (0%) | Completely unrelated |

In this project, we show results with **≥ 75% similarity** (cosine distance ≤ 0.25).

---

## 4. What Is pgvector?

**pgvector** is a PostgreSQL extension that adds:

1. A `vector(n)` column type for storing float arrays of fixed dimension
2. Operators for computing distances between vectors:
   - `<=>` — cosine distance (used in this project)
   - `<->` — L2 (Euclidean) distance
   - `<#>` — negative inner product
3. Index types for fast approximate nearest-neighbor search:
   - **IVFFlat** — good for most use cases, used here
   - **HNSW** — faster queries but more memory

Without pgvector, you would have to load all vectors into Python memory and compute distances manually — extremely slow at scale. With pgvector, the distance computation happens inside PostgreSQL in optimized C code.

**IVFFlat Index:**
```sql
CREATE INDEX idx_posts_embedding
ON posts
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

`lists = 100` means the index divides the vector space into 100 clusters. Queries search the nearest clusters first. More lists = faster queries but slower index build. A good rule: `lists = rows / 1000`, minimum 100.

---

## 5. What Is Amazon Bedrock?

**Amazon Bedrock** is AWS's fully managed service for accessing foundation AI models via API. You don't manage any servers or GPU instances — you just call an API and pay per request.

For this project, we use **Amazon Titan Embeddings G1 - Text**, which:
- Accepts text input (up to 8192 tokens)
- Returns a 1536-dimension embedding vector
- Costs approximately $0.0001 per 1000 input tokens (very cheap)
- Is available in `us-east-1` and other regions

The API is called via the **Bedrock Runtime** client in boto3:

```python
client = boto3.client("bedrock-runtime", region_name="us-east-1")
response = client.invoke_model(
    modelId="amazon.titan-embed-text-v1",
    contentType="application/json",
    accept="application/json",
    body=json.dumps({"inputText": "your text here"})
)
result = json.loads(response["body"].read())
embedding = result["embedding"]  # list of 1536 floats
```

**Important:** Unlike other Bedrock models (like Claude or Llama), the Embeddings model does not generate text — it only converts text to vectors. It has no conversational capability.

---

## 6. Architecture of the Feature

```
USER BROWSER
│
│  Types in "Ask a Question" title field
│  After 600ms pause (debounce)
│
▼
POST /api/v1/posts/similar
Body: { "text": "How do I order elements in Python?" }
│
▼
FastAPI (EC2) — similarity_service.find_similar_posts()
│
├──── 1. Call generate_embedding(text)
│           │
│           ▼
│     Amazon Bedrock Runtime API
│     Model: amazon.titan-embed-text-v1
│     Input: question text (max 8000 chars)
│           │
│           ▼
│     Returns: [−0.269, −0.411, 0.094, ...] (1536 floats)
│
├──── 2. Format vector as PostgreSQL string: "[−0.269,−0.411,...]"
│
├──── 3. Execute pgvector similarity query on RDS
│     SELECT post_id, title,
│            1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
│     FROM posts
│     WHERE embedding IS NOT NULL
│     ORDER BY embedding <=> CAST(:embedding AS vector)
│     LIMIT 5
│           │
│           ▼ Uses IVFFlat index for fast approximate search
│     Returns rows ordered by cosine similarity
│
├──── 4. Filter results with similarity >= 0.75
│
▼
Response: { "results": [
  { "post_id": "...", "title": "...", "similarity": 0.91 },
  { "post_id": "...", "title": "...", "similarity": 0.83 }
]}
│
▼
React Frontend
Shows amber warning panel with clickable links to existing questions
```

---

## 7. Step-by-Step Implementation

### Step 1 — Install Dependencies

Add to `backend/requirements.txt`:

```
pgvector==0.3.5    # SQLAlchemy type integration for vector columns
boto3==1.35.0      # AWS SDK — already present for SQS/S3
```

`pgvector` provides the `Vector` SQLAlchemy type. `boto3` is the AWS SDK used to call Bedrock.

---

### Step 2 — Configure Settings

Add Bedrock settings to `backend/app/config.py` inside the `Settings` class:

```python
# AWS / Bedrock
AWS_REGION: str = "us-east-1"
BEDROCK_MODEL_ID: str = "amazon.titan-embed-text-v1"
```

Add to `backend/.env`:
```
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=amazon.titan-embed-text-v1
```

The `BEDROCK_MODEL_ID` is kept in config so you can swap to a different model (e.g. Cohere Embed) without changing code.

---

### Step 3 — Enable pgvector + Add Embedding Column

Create `backend/alembic/versions/004_add_embedding_column.py`:

```python
"""Add embedding vector column to posts for AI similarity search

Revision ID: 004
Revises: 003
Create Date: 2026-03-10
"""
from alembic import op

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable the pgvector PostgreSQL extension (idempotent)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Add embedding column — nullable so existing posts aren't broken
    op.execute("ALTER TABLE posts ADD COLUMN IF NOT EXISTS embedding vector(1536)")

    # IVFFlat index for fast cosine similarity search
    # lists=100 is appropriate for up to ~100k rows
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_posts_embedding
        ON posts
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_posts_embedding")
    op.execute("ALTER TABLE posts DROP COLUMN IF EXISTS embedding")
```

**Key decisions:**
- `nullable=True` (via `ADD COLUMN IF NOT EXISTS` without `NOT NULL`) — existing posts won't have embeddings, and the app handles this gracefully
- `vector(1536)` — must match the output dimension of the Titan model exactly
- `vector_cosine_ops` — tells the index to optimize for cosine distance (`<=>` operator)

Run the migration:
```bash
docker compose exec backend alembic upgrade head
```

---

### Step 4 — Update the Post Model

Add the `Vector` type import and column to `backend/app/models/post.py`:

```python
from pgvector.sqlalchemy import Vector

class Post(Base):
    # ... existing columns ...
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
```

The `nullable=True` is critical — posts created before this migration have no embedding. The similarity query filters them out with `WHERE embedding IS NOT NULL`.

---

### Step 5 — Create the Bedrock Client

Create `backend/app/core/bedrock.py`:

```python
"""Amazon Bedrock client — generates text embeddings via Titan Embeddings."""
import json
import boto3
from app.config import settings

_bedrock_client = None


def get_bedrock_client():
    global _bedrock_client
    if not _bedrock_client:
        _bedrock_client = boto3.client(
            "bedrock-runtime",
            region_name=settings.AWS_REGION,
        )
    return _bedrock_client


async def generate_embedding(text: str) -> list[float] | None:
    """
    Calls Bedrock Titan Embeddings and returns a 1536-dim vector.
    Returns None if Bedrock is unavailable (e.g. local dev without AWS credentials).
    """
    try:
        client = get_bedrock_client()
        body = json.dumps({"inputText": text[:8000]})  # Titan max input is 8192 tokens
        response = client.invoke_model(
            modelId=settings.BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=body,
        )
        result = json.loads(response["body"].read())
        return result["embedding"]  # list of 1536 floats
    except Exception:
        return None  # graceful fallback — app works without Bedrock
```

**Design decisions explained:**

- **Singleton client (`_bedrock_client`)** — boto3 clients are thread-safe and expensive to create. We create one and reuse it for the lifetime of the process, exactly like the JWKS cache in `cognito.py`.
- **`text[:8000]`** — Titan Embeddings accepts up to 8192 tokens. We truncate at 8000 characters (conservative, since tokens ≠ characters) to avoid API errors on very long inputs.
- **`try/except` returning `None`** — if AWS credentials are missing, Bedrock is in sandbox, or there's a network error, the function returns `None` silently. The caller checks for `None` and skips the search. The app never crashes because of a missing AI feature.
- **`async def`** — the function signature is async but `client.invoke_model()` is synchronous. For a class project this is fine; in high-traffic production you'd use `asyncio.run_in_executor()` to avoid blocking the event loop.

---

### Step 6 — Create the Similarity Service

Create `backend/app/services/similarity_service.py`:

```python
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
```

**Why raw SQL instead of SQLAlchemy ORM?**

SQLAlchemy's ORM doesn't natively support pgvector operators like `<=>`. Using `text()` with raw SQL gives full control over the query. The `CAST(:embedding AS vector)` syntax is used instead of `:embedding::vector` because asyncpg's parameter binding conflicts with PostgreSQL's `::` cast syntax.

**The `1 - (embedding <=> ...)` formula:**

- `<=>` returns **cosine distance** (0 = identical, 1 = opposite)
- `1 - distance` = **cosine similarity** (1 = identical, 0 = opposite)
- We display similarity as a percentage: `0.91` → `91% match`

**The `exclude_post_id` parameter:**

When a user is editing an existing post, you'd pass the post's own ID to exclude it from results (otherwise a post would match itself at 100%).

---

### Step 7 — Add API Schemas

Add to `backend/app/schemas/post.py`:

```python
class SimilarPostsRequest(BaseModel):
    text: str  # the question text to find similarities for


class SimilarPostResult(BaseModel):
    post_id: uuid.UUID
    title: str
    similarity: float  # 0.0 to 1.0

    model_config = {"from_attributes": True}


class SimilarPostsResponse(BaseModel):
    results: list[SimilarPostResult]
```

---

### Step 8 — Store Embeddings on Post Creation

Modify `create_post()` in `backend/app/services/post_service.py`:

```python
from app.core.bedrock import generate_embedding

async def create_post(db: AsyncSession, data: PostCreate, author_id: uuid.UUID) -> Post:
    post = Post(title=data.title, body=data.body, author_id=author_id)

    if data.tag_ids:
        result = await db.execute(select(Tag).where(Tag.tag_id.in_(data.tag_ids)))
        post.tags = list(result.scalars().all())

    db.add(post)
    await db.flush()
    await db.refresh(post)

    # Generate and store embedding — title + body gives better semantic representation
    embedding = await generate_embedding(f"{data.title}\n\n{data.body}")
    if embedding:
        post.embedding = embedding
        await db.flush()

    return post
```

**Why `f"{data.title}\n\n{data.body}"`?**

Combining title and body gives Bedrock more context. The title alone might be too short or ambiguous. The body provides the full semantic context. The `\n\n` separator helps the model treat them as related but distinct sections.

**Why not await the embedding before `db.flush()`?**

The post must be flushed to the DB first (to get its `post_id`) before we can update it with the embedding. We do two flushes — one to create the post, one to add the embedding.

---

### Step 9 — Add the API Endpoint

Add to `backend/app/api/posts.py`:

```python
from app.schemas.post import ..., SimilarPostsRequest, SimilarPostsResponse
from app.services.similarity_service import find_similar_posts

# This route MUST be defined BEFORE /{post_id} routes
# Otherwise "similar" would be interpreted as a UUID post_id
@router.post("/similar", response_model=SimilarPostsResponse)
async def get_similar_posts(
    data: SimilarPostsRequest,
    db: AsyncSession = Depends(get_db),
):
    results = await find_similar_posts(db, data.text)
    return SimilarPostsResponse(results=results)
```

**Critical: Route order matters.** FastAPI matches routes top-to-bottom. If `/{post_id}` is defined before `/similar`, then a request to `/posts/similar` would try to find a post with `post_id = "similar"` (a string, not a UUID), and return 422 Unprocessable Entity.

**No authentication required.** Anyone (even unauthenticated users) can check for similar questions before deciding to sign up and post. This is intentional.

---

### Step 10 — Connect the Frontend

Add to `frontend/src/pages/CreatePost.jsx`:

```javascript
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

// Inside the component:
const [similarPosts, setSimilarPosts] = useState([]);
const [isFetchingSimilar, setIsFetchingSimilar] = useState(false);
const debounceTimer = useRef(null);

// Debounced effect — fires 600ms after user stops typing in the title
useEffect(() => {
  const text = form.title.trim();
  if (text.length < 15) {       // don't search for very short titles
    setSimilarPosts([]);
    return;
  }
  clearTimeout(debounceTimer.current);
  debounceTimer.current = setTimeout(async () => {
    setIsFetchingSimilar(true);
    try {
      const res = await api.post("/posts/similar", { text });
      setSimilarPosts(res.data.results || []);
    } catch {
      setSimilarPosts([]);       // fail silently — never break the form
    } finally {
      setIsFetchingSimilar(false);
    }
  }, 600);
  return () => clearTimeout(debounceTimer.current);  // cleanup on unmount
}, [form.title]);
```

**The UI panel:**
```jsx
{isFetchingSimilar && (
  <div className="card p-4 border-l-4 border-blue-400 bg-blue-50">
    <p className="text-sm text-blue-600 animate-pulse">
      Checking for similar questions...
    </p>
  </div>
)}

{!isFetchingSimilar && similarPosts.length > 0 && (
  <div className="card p-4 border-l-4 border-amber-400 bg-amber-50">
    <p className="text-sm font-semibold text-amber-800 mb-2">
      ⚠ Similar questions already exist — your answer might be there:
    </p>
    <ul className="space-y-2">
      {similarPosts.map((post) => (
        <li key={post.post_id} className="flex items-center justify-between">
          <Link
            to={`/posts/${post.post_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-700 hover:underline"
          >
            {post.title}
          </Link>
          <span className="text-xs text-gray-500 ml-3 shrink-0">
            {Math.round(post.similarity * 100)}% match
          </span>
        </li>
      ))}
    </ul>
    <p className="text-xs text-gray-500 mt-3">
      You can still post your question if none of these answer it.
    </p>
  </div>
)}
```

**Why `useRef` for the timer instead of `useState`?**

`useRef` stores a mutable value that doesn't trigger a re-render when it changes. Using `useState` for the timer would cause an extra render every time the timer is set or cleared, which is wasteful. `useRef` is the correct React pattern for storing DOM references, timers, and other mutable values that don't affect the UI directly.

**Why 600ms debounce?**

- Too short (e.g. 200ms): API called on every keystroke — wastes Bedrock credits and creates flickering
- Too long (e.g. 1500ms): Feels unresponsive
- 600ms: User has clearly paused typing; feels instant but not spammy

---

## 8. AWS Setup Requirements

### 1. Enable Bedrock Model Access

```
AWS Console → Bedrock → Model access → Manage model access
→ Check: Amazon Titan Embeddings G1 - Text
→ Save changes (takes 1-2 minutes)
```

Without this step, all Bedrock calls return a 403 Access Denied error even with valid credentials.

### 2. IAM Permission Required

The IAM user or EC2 IAM role needs this permission:

```json
{
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel"],
  "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v1"
}
```

Or attach the managed policy `AmazonBedrockFullAccess` to the IAM group.

### 3. pgvector on RDS

RDS PostgreSQL supports pgvector natively — no manual installation needed. Just run:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This is handled automatically by Migration 004.

---

## 9. Local Development Setup

Bedrock requires AWS credentials. For local Docker development:

### Option A — Root-level `.env` (used in this project)

Create `.env` in the project root (same folder as `docker-compose.yml`):
```
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
```

Reference in `docker-compose.yml`:
```yaml
services:
  backend:
    env_file:
      - ./backend/.env
    environment:
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
```

Docker Compose reads the root `.env` for `${VAR}` substitution automatically.

### Option B — Mount AWS credentials folder

```yaml
volumes:
  - ~/.aws:/root/.aws:ro
```

This mounts your local `~/.aws/credentials` file into the container read-only.

### Why `backend/.env` alone didn't work

Docker's `env_file` parser sometimes fails to read variables at the end of a file if the file lacks a trailing newline or has mixed line endings (CRLF vs LF) on Windows. Using the root `.env` + explicit `environment:` section in `docker-compose.yml` avoids this issue entirely.

---

## 10. How the Vector Search Query Works

```sql
SELECT post_id, title,
       1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
FROM posts
WHERE embedding IS NOT NULL
ORDER BY embedding <=> CAST(:embedding AS vector)
LIMIT 5
```

**Breaking it down:**

| Part | Explanation |
|---|---|
| `CAST(:embedding AS vector)` | Converts the string `"[0.1, -0.2, ...]"` to a PostgreSQL vector type |
| `<=>` | pgvector's cosine distance operator — lower = more similar |
| `1 - (embedding <=> ...)` | Converts distance to similarity (0.91 = 91% similar) |
| `WHERE embedding IS NOT NULL` | Skips posts created before the embedding column was added |
| `ORDER BY embedding <=> ...` | Uses the IVFFlat index for fast approximate nearest-neighbor ordering |
| `LIMIT 5` | Returns only the top 5 most similar posts |

**Why `CAST()` instead of `::vector`?**

asyncpg (the PostgreSQL driver) uses `$1`, `$2` positional parameters. SQLAlchemy's `text()` uses `:param` named parameters and translates them to positional. The `::` PostgreSQL cast syntax conflicts with SQLAlchemy's `:` parameter prefix — the parser gets confused. `CAST(:embedding AS vector)` uses standard SQL syntax that doesn't conflict.

---

## 11. Bugs We Hit and How We Fixed Them

### Bug 1 — `ModuleNotFoundError: No module named 'pgvector'`

**What happened:** Migration ran before the Docker image was rebuilt with the new `pgvector` package.

**Fix:** Always rebuild the Docker image after adding new Python packages:
```bash
docker compose up --build -d
```
Then run migrations.

### Bug 2 — `NoCredentialsError: Unable to locate credentials`

**What happened:** AWS credentials were added to `backend/.env` but Docker's `env_file` parser failed to read the last lines of the file due to a missing trailing newline or Windows line ending issue.

**Diagnosis:**
```bash
docker compose exec backend env | grep AWS
```
Only `AWS_REGION` appeared — credentials were missing.

**Fix:** Added credentials to a root-level `.env` and referenced them explicitly in `docker-compose.yml` using `${VAR}` substitution.

### Bug 3 — `PostgresSyntaxError: syntax error at or near ":"`

**What happened:** The SQL query used `:embedding::vector` which asyncpg misinterpreted — it tried to parse `:embedding:` as a malformed parameter name.

**Fix:** Replaced `::vector` with `CAST(:embedding AS vector)` throughout the query.

### Bug 4 — Mixing named and positional parameters

**What happened:** An earlier version of the query mixed `:exclude_id` (named) with `$1` (positional), which asyncpg rejects.

**Fix:** Split the query into two separate `text()` statements — one for when `exclude_post_id` is provided, one without it. Each statement uses only named parameters consistently.

### Bug 5 — Frontend hot-reload not working on Windows

**What happened:** Vite's file watcher uses `inotify` which doesn't work with Docker volume mounts on Windows (due to how Docker Desktop bridges the Windows filesystem).

**Fix:** Added polling to `vite.config.js`:
```javascript
server: {
  watch: {
    usePolling: true,
    interval: 500,
  },
}
```

---

## 12. Tuning and Configuration

### Similarity Threshold (currently 0.75)

In `similarity_service.py`:
```python
min_similarity: float = 0.75
```

| Threshold | Effect |
|---|---|
| 0.90+ | Only near-identical questions shown — very few results |
| 0.75 | Good balance — meaningfully similar questions shown |
| 0.60 | More results but some false positives |
| 0.50 | Too many unrelated results |

### Debounce Delay (currently 600ms)

In `CreatePost.jsx`:
```javascript
debounceTimer.current = setTimeout(async () => { ... }, 600);
```

Decrease for faster response. Increase to reduce API calls.

### Minimum Title Length (currently 15 chars)

```javascript
if (text.length < 15) { setSimilarPosts([]); return; }
```

Too-short titles produce poor embeddings. 15 characters is roughly 2-3 meaningful words.

### Number of Results (currently 5)

```python
limit: int = 5
```

Showing more than 5 results overwhelms the user. 3-5 is the sweet spot.

### IVFFlat `lists` Parameter

```sql
WITH (lists = 100)
```

Tune based on table size: `lists = max(100, rows / 1000)`. Rebuild the index after large data loads.

---

## 13. How to Extend This Feature

### Backfill Embeddings for Old Posts

Posts created before Migration 004 have `embedding = NULL`. To backfill:

```python
# One-time backfill script (run manually)
async def backfill_embeddings():
    async with get_db() as db:
        result = await db.execute(
            select(Post).where(Post.embedding == None).limit(100)
        )
        posts = result.scalars().all()
        for post in posts:
            embedding = await generate_embedding(f"{post.title}\n\n{post.body}")
            if embedding:
                post.embedding = embedding
        await db.commit()
```

### Search by Body Too

To trigger similarity search when the user types in the body field, add a second `useEffect` watching `form.body` in `CreatePost.jsx`, or combine both:

```javascript
useEffect(() => {
  const text = `${form.title}\n\n${form.body}`.trim();
  // ... rest of debounce logic
}, [form.title, form.body]);
```

### Show Similarity on Post Detail Page

After viewing a post, show "Related questions" in a sidebar by calling `/posts/similar` with the post's title and excluding the current post:

```python
await find_similar_posts(db, post.title, exclude_post_id=post.post_id)
```

### Switch to a Different Embedding Model

Change `BEDROCK_MODEL_ID` in `.env`:

```
# Cohere Embed (768 dimensions — change Vector(1536) to Vector(768))
BEDROCK_MODEL_ID=cohere.embed-english-v3

# Amazon Titan V2 (1024 dimensions)
BEDROCK_MODEL_ID=amazon.titan-embed-text-v2:0
```

Note: if you change dimensions, you must update `Vector(1536)` in the model, recreate the index, and re-embed all posts.

### Add Similarity to the Feed

Instead of a keyword search, let users search by semantic meaning. Pass the search query through Bedrock and use pgvector on the `GET /posts` endpoint alongside the existing full-text search.
