variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "notification_queue_name" {
  description = "Existing SQS notification queue name"
  type        = string
}

variable "db_host" {
  description = "PostgreSQL host"
  type        = string
}

variable "db_port" {
  description = "PostgreSQL port"
  type        = number
  default     = 5432
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
}

variable "db_user" {
  description = "PostgreSQL username"
  type        = string
}

variable "db_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
}

variable "sender_email" {
  description = "SES sender email address"
  type        = string
  default     = ""
}

variable "notification_worker_image_uri" {
  description = "Full ECR image URI for the notification worker Lambda"
  type        = string
}

variable "enable_notification_queue_trigger" {
  description = "Whether to enable the SQS -> Lambda event source mapping"
  type        = bool
  default     = false
}
