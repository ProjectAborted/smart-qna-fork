import json
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    ENVIRONMENT: str = "development"
    CORS_ORIGINS: str = '["http://localhost:5173"]'

    # AWS / Cognito
    COGNITO_REGION: str = "us-east-1"
    COGNITO_USER_POOL_ID: str = ""
    COGNITO_APP_CLIENT_ID: str = ""
    S3_BUCKET_ATTACHMENTS: str = ""
    AWS_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    SQS_NOTIFICATION_QUEUE_URL: str = ""
    NOTIFICATION_DELIVERY_MODE: str = "auto"  # auto | direct | sqs
    NOTIFICATION_API_URL: str = ""

    # AWS / Bedrock
    AWS_REGION: str = "us-east-1"
    BEDROCK_MODEL_ID: str = "amazon.titan-embed-text-v1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_SESSION_TOKEN: str = ""

    @property
    def cognito_jwks_url(self) -> str:
        return (
            f"https://cognito-idp.{self.COGNITO_REGION}.amazonaws.com"
            f"/{self.COGNITO_USER_POOL_ID}/.well-known/jwks.json"
        )

    @property
    def cors_origins_list(self) -> list[str]:
        try:
            parsed = json.loads(self.CORS_ORIGINS)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"


settings = Settings()
