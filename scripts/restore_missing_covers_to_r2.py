import argparse
import base64
import os
from datetime import datetime, timezone
from urllib.parse import quote

import boto3
import firebase_admin
from botocore.client import Config
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from firebase_admin import credentials, firestore


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ACCOUNT_PATH = os.path.join(ROOT_DIR, "config", "service_account.json")


def load_firestore():
    load_dotenv(os.path.join(ROOT_DIR, ".env"))
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    return firestore.client()


def build_r2_client():
    account_id = (os.getenv("R2_ACCOUNT_ID") or "").strip()
    access_key = (os.getenv("R2_ACCESS_KEY_ID") or "").strip()
    secret_key = (os.getenv("R2_SECRET_ACCESS_KEY") or "").strip()
    bucket_name = (os.getenv("R2_BUCKET_NAME") or "").strip()
    public_base_url = (os.getenv("R2_PUBLIC_BASE_URL") or "").strip().rstrip("/")

    if not all([account_id, access_key, secret_key, bucket_name]):
        raise RuntimeError("Missing R2 environment variables.")

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    return client, bucket_name, public_base_url


def build_asset_url(client, bucket_name: str, public_base_url: str, key: str) -> str:
    normalized_key = str(key or "").strip().lstrip("/")
    if not normalized_key:
        return ""
    if public_base_url:
        return f"{public_base_url}/{quote(normalized_key, safe='/')}"
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket_name, "Key": normalized_key},
        ExpiresIn=3600,
    )


def object_exists(client, bucket_name: str, key: str) -> bool:
    if not key:
        return False
    try:
        client.head_object(Bucket=bucket_name, Key=key)
        return True
    except ClientError as exc:
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if status == 404:
            return False
        raise


def main():
    parser = argparse.ArgumentParser(
        description="Restore missing cover images in R2 using cover thumbnails stored in Firestore."
    )
    parser.add_argument("--only-id", help="Restore only one podcast document id.")
    parser.add_argument("--apply", action="store_true", help="Actually upload thumbnails and update Firestore.")
    args = parser.parse_args()

    db = load_firestore()
    client, bucket_name, public_base_url = build_r2_client()

    ready = 0
    restored = 0
    missing_thumb = 0
    skipped = 0

    for doc in db.collection("podcasts").stream():
        if args.only_id and doc.id != args.only_id:
            continue

        data = doc.to_dict() or {}
        cover_path = (data.get("coverPath") or "").strip()
        thumb_b64 = (data.get("coverThumbB64") or "").strip()

        if not cover_path:
            skipped += 1
            continue

        if object_exists(client, bucket_name, cover_path):
            skipped += 1
            continue

        if not thumb_b64:
            missing_thumb += 1
            print(f"MISSING_THUMB {doc.id} {data.get('title') or 'Untitled'}")
            continue

        ready += 1
        restored_key = f"covers/{doc.id}/restored_thumb_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}.jpg"
        print(f"READY {doc.id} -> {restored_key}")

        if not args.apply:
            continue

        image_bytes = base64.b64decode(thumb_b64)
        client.put_object(
            Bucket=bucket_name,
            Key=restored_key,
            Body=image_bytes,
            ContentType="image/jpeg",
        )
        asset_url = build_asset_url(client, bucket_name, public_base_url, restored_key)
        doc.reference.set(
            {
                "coverPath": restored_key,
                "coverUrl": asset_url,
                "coverMimeType": "image/jpeg",
                "coverRestoredFromThumbAt": datetime.now(timezone.utc).isoformat(),
                "coverUpdatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        restored += 1
        print(f"RESTORED {doc.id} -> {bucket_name}/{restored_key}")

    print("\nSummary")
    print("-------")
    print(f"Ready to restore: {ready}")
    print(f"Restored: {restored}")
    print(f"Missing thumbnail: {missing_thumb}")
    print(f"Skipped: {skipped}")
    if not args.apply:
        print("Dry run only. Re-run with --apply to perform the restoration.")


if __name__ == "__main__":
    main()
