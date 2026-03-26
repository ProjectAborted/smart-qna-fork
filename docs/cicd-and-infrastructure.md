# CI/CD Pipeline & Infrastructure Documentation

**Course:** Modern Software Deployment  
**Project:** Smart Q&A — Course Discussion Platform  
**Region:** us-west-1 (N. California)  
**Author:** Infrastructure & CI/CD teammate  

---

## Table of Contents

1. [Overview](#1-overview)
2. [Infrastructure — Terraform](#2-infrastructure--terraform)
3. [Terraform State Management](#3-terraform-state-management)
4. [GitHub Actions — Terraform CI/CD](#4-github-actions--terraform-cicd)
5. [GitHub Actions — Backend CI/CD](#5-github-actions--backend-cicd)
6. [GitHub Actions — Frontend CI/CD](#6-github-actions--frontend-cicd)
7. [GitHub Secrets Reference](#7-github-secrets-reference)
8. [How to Deploy](#8-how-to-deploy)
9. [Architecture Diagram](#9-architecture-diagram)
10. [Lessons Learned](#10-lessons-learned)

---

## 1. Overview

This document covers two parts of the Smart Q&A deployment:

1. **Infrastructure as Code** — All AWS resources are defined in Terraform (`terraform/`) so they can be provisioned, modified, and destroyed reproducibly.
2. **CI/CD Pipelines** — Three GitHub Actions workflows automate testing, building, and deploying the application on every push to `main`.

### What this teammate owns

| Area | Terraform | CI/CD |
|---|---|---|
| ECR (Docker registry) | `terraform/ecr.tf` | `backend-ci.yml` |
| S3 frontend bucket | `terraform/storage.tf` | `frontend-ci.yml` |
| S3 attachments bucket | `terraform/storage.tf` | — |
| CloudFront CDN | `terraform/cdn.tf` | `frontend-ci.yml` |
| EC2 ×2 (backend servers) | `terraform/compute.tf` | `backend-ci.yml` |
| Application Load Balancer | `terraform/compute.tf` | — |
| Security Groups | `terraform/networking.tf` | — |
| IAM roles | `terraform/iam.tf` | — |

### What other teammates own

| Area | Owner |
|---|---|
| RDS (PostgreSQL 15) | Teammate — DB |
| SQS (notification queue) | Teammate — Messaging |
| Lambda (notification worker) | Teammate — Messaging |
| Cognito (authentication) | Already provisioned |

---

## 2. Infrastructure — Terraform

### File Structure

```
terraform/
├── main.tf                  # AWS provider, S3 remote state backend
├── variables.tf             # All input variables
├── outputs.tf               # Key values printed after terraform apply
├── networking.tf            # Default VPC, ALB security group, EC2 security group
├── iam.tf                   # EC2 instance profile with required AWS permissions
├── storage.tf               # S3 frontend bucket, S3 attachments bucket
├── cdn.tf                   # CloudFront distribution (SPA + API routing)
├── ecr.tf                   # ECR private Docker image repository
├── compute.tf               # EC2 ×2, key pair, ALB, target group, listener
└── terraform.tfvars.example # Template for local secrets (never commit .tfvars)
```

### Key Design Decisions

**Default VPC** — Uses the AWS default VPC instead of creating a custom one. Avoids subnet/routing complexity for a course project while still allowing proper security group layering.

**Security group layering:**
- ALB SG accepts HTTP/HTTPS from `0.0.0.0/0` (internet)
- EC2 SG accepts HTTP only from ALB SG (not directly from internet)
- EC2 SG accepts SSH from `0.0.0.0/0` so GitHub Actions can deploy

**CloudFront as the single entry point** — All traffic (frontend assets and API calls) goes through CloudFront. The frontend is served from S3 via CloudFront OAC. API calls to `/api/v1/*` are forwarded to the ALB, which distributes them across both EC2 instances.

**EC2 user data** — On first boot, each EC2 instance automatically installs Docker and Docker Compose via a shell script in `compute.tf`. No manual SSH setup is needed.

**IAM instance profile** — EC2 instances have a role attached that grants them:
- `AmazonEC2ContainerRegistryReadOnly` — pull Docker images from ECR
- `AmazonS3FullAccess` — generate pre-signed URLs for file uploads
- `AmazonSQSFullAccess` — enqueue notification messages
- `AmazonBedrockFullAccess` — AI similarity search embeddings
- Custom Cognito-idp policy — admin group management

### Networking Architecture

```
Internet
   │
   ▼
CloudFront (d2o2tfuqobkmjr.cloudfront.net)
   │
   ├── Default behaviour → S3 Frontend Bucket (static React files)
   │
   └── /api/v1/* → ALB (smartqna-alb-*.us-west-1.elb.amazonaws.com)
                       │
                       ├── EC2 #1 (3.101.15.76) — FastAPI + Docker
                       └── EC2 #2 (54.215.199.177) — FastAPI + Docker
                               │
                               └── RDS PostgreSQL (teammate)
```

### CloudFront Routing

Two origins are configured in `cdn.tf`:

| Origin | Behaviour | Cache |
|---|---|---|
| S3 frontend bucket | Default (`/*`) | 1 hour TTL |
| ALB | `/api/v1/*` | TTL = 0 (never cached) |

SPA routing (React Router) is handled by mapping S3 403 and 404 errors to `index.html` with a 200 response code — so refreshing `/posts/123` doesn't return an error.

### ECR Lifecycle Policy

The ECR repository keeps only the 10 most recent images, automatically expiring older ones. This prevents unbounded storage growth as new images are pushed on every backend deploy.

---

## 3. Terraform State Management

Terraform state is stored remotely in S3 so all teammates (and GitHub Actions) share the same view of what's provisioned.

### Setup (done once manually)

```bash
# Create the state bucket
aws s3 mb s3://smartqna-tfstate --region us-west-1

# Enable versioning so state can be recovered if corrupted
aws s3api put-bucket-versioning \
  --bucket smartqna-tfstate \
  --versioning-configuration Status=Enabled
```

The `use_lockfile = true` setting in `main.tf` uses Terraform's native S3 lock file (requires Terraform ≥ 1.10) — no DynamoDB table needed.

### Backend configuration (`main.tf`)

```hcl
backend "s3" {
  bucket       = "smartqna-tfstate"
  key          = "smartqna/terraform.tfstate"
  region       = "us-west-1"
  use_lockfile = true
  encrypt      = true
}
```

### Local workflow

```bash
cd terraform
terraform init      # Connect to S3 backend, download provider
terraform plan      # Preview changes (dry run)
terraform apply     # Provision / update resources
terraform output    # Print key values (IPs, URLs, IDs)
terraform destroy   # Tear down all resources (use carefully)
```

---

## 4. GitHub Actions — Terraform CI/CD

**File:** `.github/workflows/terraform.yml`  
**Triggers:** Push or PR touching `terraform/**` or the workflow file itself; manual via `workflow_dispatch`

### Jobs

```
push to main (terraform/ changed)
        │
        ▼
  [validate]
  ├── terraform init
  ├── terraform fmt --check   (fails if code isn't formatted)
  └── terraform validate      (checks config syntax)
        │
        ▼ (only on push to main or manual trigger)
  [apply]
  ├── terraform init
  ├── terraform plan          (shown in logs)
  └── terraform apply -auto-approve
```

### Why `fmt --check`?

`terraform fmt` enforces consistent HCL formatting (spacing, alignment). Running `--check` in CI ensures no badly formatted code is merged — it's the Terraform equivalent of a linter.

### Variables passed in CI

Sensitive variables are passed via GitHub Secrets as `TF_VAR_*` environment variables — never stored in files:

```yaml
env:
  TF_VAR_secret_key: ${{ secrets.SECRET_KEY }}
  TF_VAR_db_url: ${{ secrets.DATABASE_URL }}
  TF_VAR_sqs_queue_url: ${{ secrets.SQS_QUEUE_URL }}
```

The SSH public key is read directly from `smartqna-deployer.pub` (committed to the repo — public keys are safe to commit) using Terraform's `file()` function:

```hcl
public_key = trimspace(file("${path.module}/../smartqna-deployer.pub"))
```

---

## 5. GitHub Actions — Backend CI/CD

**File:** `.github/workflows/backend-ci.yml`  
**Triggers:** Push to `main` touching `backend/**`

### Full pipeline flow

```
git push (backend/ changed)
        │
        ▼
  [test job]
  ├── Start PostgreSQL 15 service container
  ├── pip install -r backend/requirements.txt
  ├── alembic upgrade head  (run migrations against test DB)
  └── pytest -v             (all tests must pass)
        │
        ▼ (only if tests pass)
  [deploy job]
  ├── Write EC2_SSH_KEY to ~/.ssh/id_rsa
  ├── ssh-keyscan EC2_HOST_1 and EC2_HOST_2 → known_hosts
  ├── Configure AWS credentials
  ├── Log into ECR
  ├── docker build backend/
  ├── docker tag :latest AND :<git-sha>   (for rollback traceability)
  ├── docker push both tags to ECR
  ├── Generate .env file from GitHub Secrets
  │
  ├── Deploy to EC2 #1:
  │     ├── scp .env → /home/ec2-user/smartqna/.env
  │     ├── scp docker-compose.prod.yml → /home/ec2-user/smartqna/
  │     ├── docker pull ECR:latest
  │     ├── docker compose up -d
  │     └── alembic upgrade head  (migrations run once, on EC2 #1 only)
  │
  └── Deploy to EC2 #2:
        ├── scp .env and docker-compose.prod.yml
        ├── docker pull ECR:latest
        └── docker compose up -d
```

### Key improvements over original workflow

| Issue | Fix |
|---|---|
| No SSH key setup | Added `echo "$EC2_SSH_KEY" > ~/.ssh/id_rsa` step |
| Only deployed to 1 EC2 | Separate deploy steps for `EC2_HOST_1` and `EC2_HOST_2` |
| No migration on deploy | `alembic upgrade head` runs on EC2 #1 after container starts |
| Only `:latest` tag | Also tags with `:<github.sha>` for rollback |
| Hardcoded compose file | `.env` file generated from secrets, `docker-compose.prod.yml` uses `${VAR}` substitution |

### `docker-compose.prod.yml` — env var substitution

The production compose file uses `${VAR}` placeholders:

```yaml
services:
  backend:
    image: ${ECR_REPO}:latest
    environment:
      DATABASE_URL: ${DATABASE_URL}
      SECRET_KEY: ${SECRET_KEY}
      COGNITO_USER_POOL_ID: ${COGNITO_USER_POOL_ID}
      ...
```

The CI workflow generates a `.env` file on the runner from GitHub Secrets, then `scp`s it to each EC2. Docker Compose reads `.env` automatically.

---

## 6. GitHub Actions — Frontend CI/CD

**File:** `.github/workflows/frontend-ci.yml`  
**Triggers:** Push to `main` touching `frontend/**`

### Full pipeline flow

```
git push (frontend/ changed)
        │
        ▼
  [build-and-deploy job]
  ├── actions/setup-node@v4 (Node 20)
  ├── npm ci  (requires frontend/package-lock.json)
  ├── npm run build
  │     └── Vite bakes env vars into the static bundle:
  │           VITE_API_URL=https://d2o2tfuqobkmjr.cloudfront.net/api/v1
  │           VITE_COGNITO_USER_POOL_ID=us-east-1_FYVTuevQ9
  │           VITE_COGNITO_CLIENT_ID=7r4nc65f89pg5adl442fufrig8
  │           VITE_COGNITO_REGION=us-east-1
  ├── Configure AWS credentials
  ├── aws s3 sync frontend/dist s3://smartqna-frontend --delete
  └── aws cloudfront create-invalidation --paths "/*"
```

### Why `VITE_API_URL` points to CloudFront (not ALB directly)

All API calls go through CloudFront → ALB → EC2. This means:
- Single HTTPS domain for both frontend and API — no mixed content issues
- No CORS problems (same origin)
- CloudFront handles TLS — ALB only needs HTTP internally

### CloudFront cache invalidation

After syncing new files to S3, the workflow invalidates the CloudFront cache with `--paths "/*"`. Without this, users would see the old cached version for up to 1 hour. The invalidation forces CloudFront to fetch fresh files from S3 immediately.

### `package-lock.json`

`frontend/package-lock.json` is committed to the repository (unlike `node_modules/`). This is required for `npm ci`, which installs the exact dependency versions recorded in the lock file — making builds reproducible across every CI run.

---

## 7. GitHub Secrets Reference

Go to: **GitHub repo → Settings → Secrets and variables → Actions**

| Secret | Description | Source |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user access key | AWS Console → IAM |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key | AWS Console → IAM |
| `ECR_REPO` | Full ECR URI | `terraform output ecr_repository_uri` |
| `EC2_HOST_1` | EC2 #1 public IP | `terraform output ec2_instance_1_ip` |
| `EC2_HOST_2` | EC2 #2 public IP | `terraform output ec2_instance_2_ip` |
| `EC2_SSH_KEY` | Private key PEM content | `smartqna-deployer` file |
| `ALB_DNS_NAME` | ALB DNS name | `terraform output alb_dns_name` |
| `S3_FRONTEND_BUCKET` | Frontend bucket name | `terraform output s3_frontend_bucket` |
| `CF_DISTRIBUTION_ID` | CloudFront distribution ID | `terraform output cloudfront_distribution_id` |
| `CLOUDFRONT_DOMAIN` | CloudFront domain | `terraform output cloudfront_domain` |
| `SECRET_KEY` | FastAPI app secret | Generated with `python -c "import secrets; print(secrets.token_hex(32))"` |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID | `us-east-1_FYVTuevQ9` (already provisioned) |
| `COGNITO_APP_CLIENT_ID` | Cognito App Client ID | `7r4nc65f89pg5adl442fufrig8` (already provisioned) |
| `DATABASE_URL` | RDS connection string | Teammate (RDS) |
| `SQS_QUEUE_URL` | SQS queue URL | Teammate (SQS) |

---

## 8. How to Deploy

### First-time setup (done once)

```bash
# 1. Create S3 state bucket
aws s3 mb s3://smartqna-tfstate --region us-west-1

# 2. Generate SSH key pair
ssh-keygen -t rsa -b 4096 -f smartqna-deployer -N ""
# smartqna-deployer.pub → committed to repo (Terraform reads it)
# smartqna-deployer     → paste into GitHub Secret EC2_SSH_KEY

# 3. Create terraform.tfvars from the example
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# Fill in: secret_key, db_url, sqs_queue_url

# 4. Provision infrastructure
cd terraform
terraform init
terraform apply

# 5. Copy terraform output values into GitHub Secrets
terraform output
```

### Every backend deploy (automatic)

```bash
# Make code changes in backend/
git add .
git commit -m "your message"
git push origin main
# → GitHub Actions: test → build → push ECR → deploy EC2 #1 + #2
```

### Every frontend deploy (automatic)

```bash
# Make code changes in frontend/
git add .
git commit -m "your message"
git push origin main
# → GitHub Actions: build → S3 sync → CloudFront invalidation
```

### Infrastructure change

```bash
# Edit terraform/*.tf files
git add terraform/
git commit -m "your message"
git push origin main
# → GitHub Actions: terraform validate → plan → apply
```

---

## 9. Architecture Diagram

```
DEVELOPER LAPTOP
│
├── git push → GitHub (main branch)
│               │
│               ├── terraform/** changed?
│               │     └── Terraform workflow: validate → plan → apply
│               │
│               ├── backend/** changed?
│               │     └── Backend workflow: test → build → ECR → EC2 deploy
│               │
│               └── frontend/** changed?
│                     └── Frontend workflow: build → S3 sync → CF invalidate
│
USER BROWSER
│
└── https://d2o2tfuqobkmjr.cloudfront.net
        │
        ├── /* (React SPA) ──────────────────► S3 (smartqna-frontend)
        │
        └── /api/v1/* ───────────────────────► ALB (smartqna-alb)
                                                  │
                                          ┌───────┴───────┐
                                          ▼               ▼
                                       EC2 #1          EC2 #2
                                   (FastAPI Docker) (FastAPI Docker)
                                          │               │
                                          └───────┬───────┘
                                                  │
                                          ┌───────┼───────┐
                                          ▼       ▼       ▼
                                         RDS     SQS    Bedrock
                                      (teammate)(teammate)(AI)
```

---

## 10. Lessons Learned

### Terraform formatting is strict
`terraform fmt` enforces exact whitespace alignment within each block. All `=` signs in a block must align to the longest key. The CI pipeline enforces this with `terraform fmt --check`, which exits with code 3 (not 0) if any file is misformatted.

### Shell variables in Terraform heredocs need `$$`
Inside a Terraform `locals` heredoc, `${VAR}` is interpreted as a Terraform interpolation, not a shell variable. Use `$${VAR}` to produce a literal `${VAR}` in the generated script that bash evaluates at runtime.

### Windows CRLF breaks SSH key format
Pasting an SSH public key on Windows (CMD/PowerShell) embeds invisible `\r` characters. Terraform's `file()` function reads the file directly from disk without encoding issues. Committing the public key file and using `file()` is cleaner than passing it as a string variable.

### Public keys are safe to commit
Only the **private** key must be kept secret. The public key (`smartqna-deployer.pub`) is designed to be distributed and is safe to commit to the repository. GitHub Actions reads it directly during `terraform apply`.

### `workflow_dispatch` needs explicit `if` conditions
GitHub Actions jobs with `if: github.event_name == 'push'` are skipped when triggered via `workflow_dispatch`. Each job's `if` condition must explicitly include `|| github.event_name == 'workflow_dispatch'` to run on manual triggers.

### `npm ci` requires `package-lock.json` to be committed
`npm ci` is the recommended command for CI/CD (faster, deterministic, fails on version mismatches). It requires `package-lock.json` to exist in the repository. Generate it with `npm install --package-lock-only` and commit it — unlike `node_modules/`, the lock file is small and should always be tracked.

### CloudFront OAC requires `depends_on`
The S3 bucket policy that grants CloudFront OAC access references the CloudFront distribution's ARN. Terraform must create the distribution before the bucket policy. The `depends_on = [aws_cloudfront_distribution.frontend]` annotation makes this dependency explicit.
