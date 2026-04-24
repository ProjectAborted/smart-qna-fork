"""
Lambda function: consumes SQS notifications queue,
writes to RDS, and optionally sends email via SES.
"""
import json
import os
import uuid
from datetime import datetime

import boto3
import psycopg2

ses = boto3.client("ses")


def get_db_connection():
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
    )


def handler(event, context):
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        for record in event["Records"]:
            body = json.loads(record["body"])

            cursor.execute(
                """
                INSERT INTO notifications
                    (notification_id, user_id, type, reference_id, message, is_read, created_at)
                VALUES (%s, %s, %s, %s, %s, FALSE, %s)
                """,
                (
                    str(uuid.uuid4()),
                    body["recipient_id"],
                    body["type"],
                    body["reference_id"],
                    body["message"],
                    datetime.utcnow(),
                ),
            )

            if body.get("send_email") and body.get("recipient_email"):
                ses.send_email(
                    Source="noreply@smartqna.example.com",
                    Destination={"ToAddresses": [body["recipient_email"]]},
                    Message={
                        "Subject": {"Data": f"Smart Q&A: {body['message']}"},
                        "Body": {"Text": {"Data": body["message"]}},
                    },
                )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()
