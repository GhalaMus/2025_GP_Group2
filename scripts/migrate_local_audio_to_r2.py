import argparse
import os
import re
from datetime import datetime, timezone
from urllib.parse import quote

import boto3
import firebase_admin
from botocore.client import Config
from dotenv import load_dotenv
from firebase_admin import credentials, firestore


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE_ACCOUNT_PATH = os.path.join(ROOT_DIR, "config", "service_account.json")
STATIC_DIR = os.path.join(ROOT_DIR, "static")


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

    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    return client, bucket_name, public_base_url


def build_r2_asset_url(client, bucket_name: str, public_base_url: str, object_key: str):
    normalized_key = str(object_key or "").strip().lstrip("/")
    if not normalized_key:
        return ""
    if public_base_url:
        return f"{public_base_url}/{quote(normalized_key, safe='/')}"
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket_name, "Key": normalized_key},
        ExpiresIn=3600,
    )


def local_audio_path(doc_id: str, audio_url: str) -> str:
    preferred = os.path.join(STATIC_DIR, f"output_{doc_id}.mp3")
    if os.path.exists(preferred):
        return preferred

    match = re.search(r"output_([A-Za-z0-9_-]+)\.mp3", audio_url or "")
    if match:
        alt = os.path.join(STATIC_DIR, f"output_{match.group(1)}.mp3")
        if os.path.exists(alt):
            return alt
    return ""


def looks_like_local_audio(audio_url: str) -> bool:
    normalized = (audio_url or "").strip().lower()
    if not normalized:
        return False
    return (
        "localhost:5000/static/" in normalized
        or "127.0.0.1:5000/static/" in normalized
        or normalized.startswith("/static/")
        or "output_" in normalized
    )


def upload_audio(client, bucket_name: str, public_base_url: str, file_path: str, doc_id: str):
    with open(file_path, "rb") as fh:
        audio_bytes = fh.read()

    object_key = f"episodes/{doc_id}/output_{doc_id}.mp3"
    client.put_object(
        Bucket=bucket_name,
        Key=object_key,
        Body=audio_bytes,
        ContentType="audio/mpeg",
    )
    return object_key, build_r2_asset_url(client, bucket_name, public_base_url, object_key)


def main():
    parser = argparse.ArgumentParser(
        description="Upload locally saved output_<id>.mp3 files to Cloudflare R2 and update Firestore."
    )
    parser.add_argument("--only-id", help="Migrate only one podcast document id.")
    parser.add_argument("--apply", action="store_true", help="Actually upload files and update Firestore.")
    args = parser.parse_args()

    db = load_firestore()
    r2_client, bucket_name, public_base_url = build_r2_client()

    migrated = 0
    missing_local = 0
    skipped = 0

    for doc in db.collection("podcasts").stream():
        if args.only_id and doc.id != args.only_id:
            continue

        data = doc.to_dict() or {}
        if (data.get("audioKey") or "").strip():
            skipped += 1
            continue

        audio_url = (data.get("audioUrl") or "").strip()
        file_path = local_audio_path(doc.id, audio_url)
        if not file_path and not looks_like_local_audio(audio_url):
            skipped += 1
            continue

        if not file_path:
            missing_local += 1
            print(f"MISSING_LOCAL {doc.id} {data.get('title') or 'Untitled'}")
            continue

        print(f"READY {doc.id} -> {file_path}")
        if not args.apply:
            continue

        object_key, migrated_url = upload_audio(
            r2_client,
            bucket_name,
            public_base_url,
            file_path,
            doc.id,
        )

        doc.reference.set(
            {
                "audioKey": object_key,
                "audioUrl": migrated_url,
                "audioUpdatedAt": firestore.SERVER_TIMESTAMP,
                "audioPath": firestore.DELETE_FIELD,
                "audioBucket": firestore.DELETE_FIELD,
                "audioNeedsRegeneration": firestore.DELETE_FIELD,
                "audioNeedsRegenerationReason": firestore.DELETE_FIELD,
                "audioStorageMigratedAt": datetime.now(timezone.utc).isoformat(),
            },
            merge=True,
        )
        migrated += 1
        print(f"MIGRATED {doc.id} -> {bucket_name}/{object_key}")

    print("\nSummary")
    print("-------")
    print(f"Migrated: {migrated}")
    print(f"Missing local file: {missing_local}")
    print(f"Skipped: {skipped}")
    if not args.apply:
        print("Dry run only. Re-run with --apply to perform the migration.")


if __name__ == "__main__":
    main()
