terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — create the S3 bucket and DynamoDB table manually once
  # before running `terraform init`:
  #   aws s3 mb s3://smartqna-tfstate --region us-east-1
  #   aws dynamodb create-table \
  #     --table-name smartqna-tfstate-lock \
  #     --attribute-definitions AttributeName=LockID,AttributeType=S \
  #     --key-schema AttributeName=LockID,KeyType=HASH \
  #     --billing-mode PAY_PER_REQUEST \
  #     --region us-east-1
  backend "s3" {
    bucket       = "smartqna-tfstate"
    key          = "smartqna/terraform.tfstate"
    region       = "us-west-1"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region
}
