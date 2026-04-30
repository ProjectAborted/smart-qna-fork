terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  prefix = "${var.project_name}-${var.environment}-notifications"
}

resource "aws_sqs_queue" "dead_letter" {
  name = "${local.prefix}-dlq"
}

resource "aws_sqs_queue" "events" {
  name                       = "${local.prefix}-events"
  visibility_timeout_seconds = 120

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = 5
  })
}

resource "aws_ecr_repository" "worker" {
  name                 = "${local.prefix}-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "api" {
  name                 = "${local.prefix}-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_iam_role" "worker_lambda" {
  name = "${local.prefix}-worker-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "worker_logs" {
  role       = aws_iam_role.worker_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "worker_sqs_ses" {
  name = "${local.prefix}-worker-sqs-ses"
  role = aws_iam_role.worker_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Effect   = "Allow"
        Resource = aws_sqs_queue.events.arn
      },
      {
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "worker" {
  function_name = "${local.prefix}-worker"
  role          = aws_iam_role.worker_lambda.arn
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
}

resource "aws_lambda_event_source_mapping" "worker_trigger" {
  event_source_arn        = aws_sqs_queue.events.arn
  function_name           = aws_lambda_function.worker.arn
  batch_size              = 10
  enabled                 = true
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_iam_role" "api_lambda" {
  name = "${local.prefix}-api-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "api" {
  function_name = "${local.prefix}-api"
  role          = aws_iam_role.api_lambda.arn
  package_type  = "Image"
  image_uri     = var.notification_api_image_uri
  timeout       = 30
  memory_size   = 512

  environment {
    variables = {
      DB_HOST               = var.db_host
      DB_PORT               = tostring(var.db_port)
      DB_NAME               = var.db_name
      DB_USER               = var.db_user
      DB_PASSWORD           = var.db_password
      COGNITO_REGION        = var.cognito_region
      COGNITO_USER_POOL_ID  = var.cognito_user_pool_id
      COGNITO_APP_CLIENT_ID = var.cognito_app_client_id
      ALLOWED_ORIGINS       = join(",", var.allowed_origins)
    }
  }
}

resource "aws_apigatewayv2_api" "notification" {
  name          = "${local.prefix}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "notification_lambda" {
  api_id                 = aws_apigatewayv2_api.notification.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "list_notifications" {
  api_id    = aws_apigatewayv2_api.notification.id
  route_key = "GET /notifications"
  target    = "integrations/${aws_apigatewayv2_integration.notification_lambda.id}"
}

resource "aws_apigatewayv2_route" "unread_count" {
  api_id    = aws_apigatewayv2_api.notification.id
  route_key = "GET /notifications/unread-count"
  target    = "integrations/${aws_apigatewayv2_integration.notification_lambda.id}"
}

resource "aws_apigatewayv2_route" "mark_read" {
  api_id    = aws_apigatewayv2_api.notification.id
  route_key = "POST /notifications/read"
  target    = "integrations/${aws_apigatewayv2_integration.notification_lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.notification.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "allow_apigw" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.notification.execution_arn}/*/*"
}
