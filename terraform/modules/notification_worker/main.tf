locals {
  lambda_function_name = "${var.project_name}-${var.environment}-notification-worker"
  lambda_role_name     = "${var.project_name}-${var.environment}-notification-worker-role"
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_sqs_queue" "notification" {
  name = var.notification_queue_name
}

resource "aws_iam_role" "lambda_role" {
  name = local.lambda_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "basic_lambda_logs" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "sqs_access" {
  name = "${local.lambda_function_name}-sqs-access"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Effect   = "Allow"
        Resource = data.aws_sqs_queue.notification.arn
      }
    ]
  })
}

resource "aws_iam_role_policy" "ses_access" {
  name = "${local.lambda_function_name}-ses-access"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}

resource "aws_ecr_repository" "notification_worker" {
  name                 = "${var.project_name}-${var.environment}-notification-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_lambda_function" "notification_worker" {
  function_name = local.lambda_function_name
  role          = aws_iam_role.lambda_role.arn
  package_type  = "Image"
  image_uri     = var.notification_worker_image_uri
  timeout       = 60
  memory_size   = 512

  environment {
    variables = {
      DB_HOST      = var.db_host
      DB_PORT      = tostring(var.db_port)
      DB_NAME      = var.db_name
      DB_USER      = var.db_user
      DB_PASSWORD  = var.db_password
      SENDER_EMAIL = var.sender_email
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.basic_lambda_logs,
    aws_iam_role_policy.sqs_access,
    aws_iam_role_policy.ses_access
  ]
}

resource "aws_lambda_event_source_mapping" "notification_queue_trigger" {
  count            = var.enable_notification_queue_trigger ? 1 : 0
  event_source_arn = data.aws_sqs_queue.notification.arn
  function_name    = aws_lambda_function.notification_worker.arn
  batch_size       = 10
  enabled          = true
}