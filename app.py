from flask import (
    Flask,
    request,
    redirect,
    url_for,
    session,
    jsonify,
    Response,
    has_request_context,
)
from flask_cors import CORS
from flask_session import Session
from dotenv import load_dotenv
from openai import OpenAI
from pydub import AudioSegment
from shutil import which
from io import BytesIO
from elevenlabs.client import ElevenLabs
import os
import re
import requests
import base64
from firebase_admin import firestore
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta, timezone
import jwt
from firebase_init import db
from PIL import Image, UnidentifiedImageError
import json
import html
from urllib.parse import quote
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

print("DEBUG in app.py:", db)

SHOW_TITLE_PLACEHOLDER = "{{SHOW_TITLE}}"
ARABIC_SECTION_HEADERS = {
    "INTRO": "مقدمة",
    "BODY": "النص",
    "OUTRO": "الخاتمة",
}
ARABIC_MUSIC_TAG = "[فاصل موسيقي]"

def is_music_tag(text: str) -> bool:
    stripped = str(text or "").strip().lower()
    return stripped in {"[music]", "[موسيقى]", "[فاصل موسيقي]"}

def is_section_header(text: str) -> bool:
    stripped = str(text or "").strip()
    return bool(re.match(r"^(INTRO|BODY|OUTRO|مقدمة|النص|الخاتمة)\s*:?$", stripped, re.IGNORECASE))

def localize_script_structure(script: str, language: str) -> str:
    if not script:
        return script

    lang = (language or "").strip().lower()
    localized_lines = []
    for raw_line in str(script).splitlines():
        stripped = raw_line.strip()

        if lang == "ar":
            if re.match(r"^INTRO\s*:?$", stripped, re.IGNORECASE):
                localized_lines.append(ARABIC_SECTION_HEADERS["INTRO"])
                continue
            if re.match(r"^BODY\s*:?$", stripped, re.IGNORECASE):
                localized_lines.append(ARABIC_SECTION_HEADERS["BODY"])
                continue
            if re.match(r"^OUTRO\s*:?$", stripped, re.IGNORECASE):
                localized_lines.append(ARABIC_SECTION_HEADERS["OUTRO"])
                continue
            if is_music_tag(stripped):
                localized_lines.append(ARABIC_MUSIC_TAG)
                continue
        else:
            if re.match(r"^مقدمة\s*:?$", stripped):
                localized_lines.append("INTRO")
                continue
            if re.match(r"^النص\s*:?$", stripped):
                localized_lines.append("BODY")
                continue
            if re.match(r"^الخاتمة\s*:?$", stripped):
                localized_lines.append("OUTRO")
                continue
            if is_music_tag(stripped):
                localized_lines.append("[music]")
                continue

        localized_lines.append(raw_line)

    return "\n".join(localized_lines)

# ------------------------------------------------------------
# App + Config
# ------------------------------------------------------------


def _configured_frontend_origins():
    defaults = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://wecast-frontend.onrender.com",
    ]
    configured = []

    raw_env = (os.getenv("FRONTEND_ORIGINS") or "").strip()
    if raw_env:
        for value in raw_env.split(","):
            candidate = value.strip().rstrip("/")
            if candidate and candidate not in configured:
                configured.append(candidate)

    for key in ("WECAST_APP_URL", "FRONTEND_URL"):
        candidate = (os.getenv(key) or "").strip().rstrip("/")
        if candidate and candidate not in configured:
            configured.append(candidate)

    for candidate in defaults:
        normalized = candidate.rstrip("/")
        if normalized and normalized not in configured:
            configured.append(normalized)

    return configured


app = Flask(__name__)
FRONTEND_ORIGINS = _configured_frontend_origins()

CORS(
    app,
    resources={r"/*": {"origins": FRONTEND_ORIGINS}},
    supports_credentials=True,
    allow_headers=["Content-Type", "Authorization"],
    methods=["GET", "POST", "OPTIONS"],
)

@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    if origin in FRONTEND_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


# Server-side sessions 
app.config.update(
    SECRET_KEY= "WeCast2025", 
    SESSION_TYPE="filesystem", 
    SESSION_FILE_DIR="./.flask_session",
    SESSION_PERMANENT=False,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=False,  
)
Session(app)

# Load .env variables configuring ffmpeg for pydub
load_dotenv()

import boto3
from botocore.client import Config

# Get ffmpeg & ffprobe paths from .env
ffmpeg_path = os.getenv("FFMPEG_PATH")
ffprobe_path = os.getenv("FFPROBE_PATH")

print("DEBUG ffmpeg_path:", ffmpeg_path)
print("DEBUG ffprobe_path:", ffprobe_path)

# If the paths exist, configure pydub AND PATH
if ffmpeg_path and os.path.exists(ffmpeg_path):
    AudioSegment.converter = ffmpeg_path
    ffmpeg_dir = os.path.dirname(ffmpeg_path)
    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
else:
    print("WARNING: ffmpeg_path missing or invalid")

if ffprobe_path and os.path.exists(ffprobe_path):
    AudioSegment.ffprobe = ffprobe_path
    ffprobe_dir = os.path.dirname(ffprobe_path)
    if ffprobe_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = ffprobe_dir + os.pathsep + os.environ.get("PATH", "")
else:
    print("WARNING: ffprobe_path missing or invalid")

print("DEBUG AudioSegment.converter:", getattr(AudioSegment, "converter", None))
print("DEBUG AudioSegment.ffprobe:", getattr(AudioSegment, "ffprobe", None))
print("DEBUG PATH starts with:", os.environ["PATH"].split(os.pathsep)[0])


app.secret_key = app.config["SECRET_KEY"]
RECYCLE_BIN_RETENTION_DAYS = int(os.getenv("RECYCLE_BIN_RETENTION_DAYS", "30"))



def create_token(user_id, email):
    payload = {
        "user_id": user_id,
        "email": email,
        "exp": datetime.utcnow() + timedelta(days=7),
    }
    token = jwt.encode(payload, app.config["SECRET_KEY"], algorithm="HS256")
    return token


def get_current_user_email():
    """Read JWT from Authorization header and return the email inside it."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
        return payload.get("email") or payload.get("user_id")
    except Exception as e:
        print("JWT decode failed:", e)
        return None

# ------------------------------------------------------------
# Cloudflare R2 Config
# ------------------------------------------------------------
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")
R2_PUBLIC_BASE_URL = (os.getenv("R2_PUBLIC_BASE_URL") or "").strip().rstrip("/")

R2_ENDPOINT = (
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    if R2_ACCOUNT_ID else None
)

r2_client = None
if all([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME]):
    r2_client = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
else:
    print("WARNING: R2 environment variables are missing. R2 client not initialized.")


def upload_bytes_to_r2(file_bytes: bytes, object_key: str, content_type: str):
    if not r2_client:
        raise RuntimeError("R2 client is not configured.")

    r2_client.put_object(
        Bucket=R2_BUCKET_NAME,
        Key=object_key,
        Body=file_bytes,
        ContentType=content_type,
    )
    return object_key


def generate_r2_signed_url(object_key: str, expires_in: int = 3600):
    if not r2_client:
        raise RuntimeError("R2 client is not configured.")

    return r2_client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": R2_BUCKET_NAME,
            "Key": object_key,
        },
        ExpiresIn=expires_in,
    )


def delete_from_r2(object_key: str):
    if not r2_client:
        raise RuntimeError("R2 client is not configured.")

    r2_client.delete_object(Bucket=R2_BUCKET_NAME, Key=object_key)


def build_r2_asset_url(object_key: str, expires_in: int = 3600):
    normalized_key = str(object_key or "").strip().lstrip("/")
    if not normalized_key:
        return ""

    if R2_PUBLIC_BASE_URL:
        return f"{R2_PUBLIC_BASE_URL}/{quote(normalized_key, safe='/')}"

    return generate_r2_signed_url(normalized_key, expires_in=expires_in)


def delete_from_r2_quietly(object_key: str, label: str = "R2 cleanup"):
    normalized_key = str(object_key or "").strip()
    if not normalized_key:
        return

    try:
        delete_from_r2(normalized_key)
    except Exception as exc:
        print(f"{label} warning: {exc}")


def resolve_podcast_media_urls(data, *, include_audio: bool = True, include_cover: bool = True):
    payload = dict(data or {})

    if include_audio:
        audio_key = str(payload.get("audioKey") or "").strip()
        if audio_key:
            try:
                payload["audioUrl"] = build_r2_asset_url(audio_key, expires_in=3600)
            except Exception as exc:
                print(f"Audio URL refresh failed: {exc}")

    if include_cover:
        cover_key = str(payload.get("coverPath") or "").strip()
        if cover_key:
            try:
                payload["coverUrl"] = build_r2_asset_url(cover_key, expires_in=3600)
            except Exception as exc:
                print(f"Cover URL refresh failed: {exc}")

    return payload


def _normalize_public_url(value: str) -> str:
    src = (value or "").strip()
    if not src:
        return ""
    if src.startswith(("http://", "https://", "/")):
        return src
    return f"/{src.lstrip('/')}"


def _delete_podcast_assets(data):
    delete_from_r2_quietly((data or {}).get("audioKey") or "", label="Audio delete")
    delete_from_r2_quietly((data or {}).get("coverPath") or "", label="Cover delete")

print("DEBUG R2_ACCOUNT_ID present:", bool(R2_ACCOUNT_ID))
print("DEBUG R2_ACCESS_KEY_ID present:", bool(R2_ACCESS_KEY_ID))
print("DEBUG R2_SECRET_ACCESS_KEY present:", bool(R2_SECRET_ACCESS_KEY))
print("DEBUG R2_BUCKET_NAME:", R2_BUCKET_NAME)
print("DEBUG R2_ENDPOINT:", R2_ENDPOINT)
print("DEBUG R2_PUBLIC_BASE_URL:", R2_PUBLIC_BASE_URL or "(signed URLs)")


def is_reasonably_valid_email(email: str) -> bool:
    value = (email or "").strip()
    if not value or len(value) > 254:
        return False
    if not re.match(r"^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$", value, re.IGNORECASE):
        return False

    local_part, _, domain = value.rpartition("@")
    if not local_part or not domain:
        return False
    if ".." in local_part or ".." in domain:
        return False
    if local_part.startswith(".") or local_part.endswith("."):
        return False

    labels = domain.split(".")
    if any(not label or label.startswith("-") or label.endswith("-") for label in labels):
        return False

    return True


def normalize_auth_provider(provider_value, password_hash=None):
    raw = (provider_value or "").strip().lower()
    if raw in {"password", "email", "email_password"}:
        return "password"
    if "google" in raw:
        return "google"
    if "github" in raw:
        return "github"
    if password_hash:
        return "password"
    return raw or "unknown"


def user_id_candidates(user_id):
    value = (user_id or "").strip()
    if not value:
        return []
    candidates = [value]
    lowered = value.lower()
    if lowered not in candidates:
        candidates.append(lowered)
    return candidates


def user_ids_match(left, right):
    return (left or "").strip().lower() == (right or "").strip().lower()


def get_user_doc_by_candidates(user_id):
    for candidate in user_id_candidates(user_id):
        doc = db.collection("users").document(candidate).get()
        if doc.exists:
            return doc
    return None


def _wecast_frontend_url():
    base = (
        os.getenv("WECAST_APP_URL")
        or os.getenv("FRONTEND_URL")
        or ""
    ).strip()
    if base:
        return base.rstrip("/")

    if has_request_context():
        origin = (request.headers.get("Origin") or "").strip()
        if origin in FRONTEND_ORIGINS:
            return origin.rstrip("/")

    return "https://wecast-frontend.onrender.com"


def _wecast_logo_url():
    return (os.getenv("WECAST_LOGO_URL") or f"{_wecast_frontend_url()}/logo.png").strip()


def _firebase_web_api_key():
    direct = (
        os.getenv("FIREBASE_WEB_API_KEY")
        or os.getenv("VITE_FIREBASE_API_KEY")
        or ""
    ).strip()
    if direct:
        return direct

    local_env_path = os.path.join(os.path.dirname(__file__), "static", "frontend", ".env.local")
    if os.path.exists(local_env_path):
        try:
            with open(local_env_path, "r", encoding="utf-8") as fh:
                for line in fh:
                    raw = line.strip()
                    if raw.startswith("VITE_FIREBASE_API_KEY="):
                        return raw.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception as env_error:
            print(f"Could not read frontend .env.local for Firebase API key: {env_error}")
    return ""


def _password_reset_continue_url():
    return f"{_wecast_frontend_url()}/#/login"


def _legacy_password_seed():
    seed = base64.urlsafe_b64encode(os.urandom(24)).decode("ascii").rstrip("=")
    return seed or "WeCastResetSeed9!"


def _generate_firebase_password_reset_link(email):
    from firebase_admin import auth as fb_auth

    continue_url = _password_reset_continue_url()
    if continue_url:
        try:
            action_code_settings = fb_auth.ActionCodeSettings(
                url=continue_url,
                handle_code_in_app=False,
            )
            return fb_auth.generate_password_reset_link(email, action_code_settings)
        except TypeError:
            pass
        except Exception as link_error:
            print(
                f"Firebase password reset link with continue URL failed for {email}: {link_error}"
            )

    return fb_auth.generate_password_reset_link(email)


def _provision_legacy_password_user(email, doc, data):
    from firebase_admin import auth as fb_auth

    normalized_email = (email or "").strip().lower()
    display_name = (
        data.get("displayName")
        or data.get("name")
        or normalized_email.split("@")[0]
    ).strip()

    # Legacy password accounts predate Firebase Auth email verification.
    # Mark migrated users verified so they can complete the reset + login path.
    email_verified = bool(data.get("emailVerified", True))
    try:
        user_record = fb_auth.create_user(
            email=normalized_email,
            password=_legacy_password_seed(),
            display_name=display_name or None,
            email_verified=email_verified,
            disabled=False,
        )
    except Exception:
        user_record = fb_auth.get_user_by_email(normalized_email)

    if doc and doc.exists:
        doc.reference.set(
            {
                "authProvider": "password",
                "emailVerified": email_verified,
                "firebaseUid": user_record.uid,
                "firebasePasswordProvisionedAt": datetime.utcnow().isoformat(),
            },
            merge=True,
        )

    return user_record


def _fallback_display_name(email, preferred=None):
    cleaned = (preferred or "").strip()
    if cleaned:
        return cleaned

    normalized_email = (email or "").strip().lower()
    if "@" in normalized_email:
        return normalized_email.split("@", 1)[0]
    return normalized_email


def _upsert_firebase_user_profile(
    *,
    email,
    display_name="",
    auth_provider="password",
    email_verified=False,
    firebase_uid="",
    mark_login=False,
):
    normalized_email = (email or "").strip().lower()
    if not normalized_email:
        raise ValueError("Email is required.")

    existing_doc = get_user_doc_by_candidates(normalized_email)
    existing_data = (
        existing_doc.to_dict() or {}
        if existing_doc and existing_doc.exists
        else {}
    )
    user_ref = (
        existing_doc.reference
        if existing_doc and existing_doc.exists
        else db.collection("users").document(normalized_email)
    )

    existing_name = (
        existing_data.get("displayName")
        or existing_data.get("name")
        or ""
    ).strip()
    resolved_name = _fallback_display_name(
        normalized_email,
        display_name or existing_name,
    )
    normalized_provider = normalize_auth_provider(
        auth_provider,
        existing_data.get("password_hash"),
    )
    now_iso = datetime.utcnow().isoformat()

    payload = {
        "email": normalized_email,
        "authProvider": normalized_provider,
        "emailVerified": bool(existing_data.get("emailVerified")) or bool(email_verified),
    }

    if firebase_uid:
        payload["firebaseUid"] = firebase_uid

    if display_name or not existing_name:
        payload["name"] = resolved_name
        payload["displayName"] = resolved_name

    if not existing_data.get("username_lower") and resolved_name:
        payload["username_lower"] = resolved_name.lower()

    if mark_login:
        payload["last_login"] = now_iso
        payload["failed_attempts"] = 0
        payload["lock_until"] = None

    if not (existing_doc and existing_doc.exists):
        payload.setdefault("name", resolved_name)
        payload.setdefault("displayName", resolved_name)
        payload.setdefault("username_lower", resolved_name.lower())
        payload["bio"] = existing_data.get("bio", "")
        payload["avatarUrl"] = existing_data.get("avatarUrl", "")
        payload["created_at"] = existing_data.get("created_at") or now_iso
        payload["role"] = existing_data.get("role") or "user"
        payload["failed_attempts"] = existing_data.get("failed_attempts", 0)
        payload["lock_until"] = existing_data.get("lock_until")
    else:
        if not existing_data.get("role"):
            payload["role"] = "user"
        if "bio" not in existing_data:
            payload["bio"] = ""
        if "avatarUrl" not in existing_data:
            payload["avatarUrl"] = ""

    user_ref.set(payload, merge=True)
    final_doc = user_ref.get()
    return final_doc.to_dict() or {}


def _session_user_payload(data, fallback_email):
    return {
        "email": data.get("email", fallback_email),
        "name": data.get("name") or data.get("displayName") or "",
        "role": data.get("role", "user"),
        "authProvider": normalize_auth_provider(
            data.get("authProvider"),
            data.get("password_hash"),
        ),
        "emailVerified": bool(data.get("emailVerified")),
    }


def _build_password_reset_email(display_name, email, reset_link):
    safe_name = html.escape((display_name or "").strip() or "there")
    safe_email = html.escape((email or "").strip())
    safe_link = html.escape((reset_link or "").strip(), quote=True)
    safe_app_url = html.escape(_wecast_frontend_url(), quote=True)
    safe_logo_url = html.escape(_wecast_logo_url(), quote=True)

    subject = "Reset your WeCast password"
    text = (
        f"Hi {display_name or 'there'},\n\n"
        "We received a request to reset your WeCast password.\n"
        f"Use this secure link to choose a new password:\n{reset_link}\n\n"
        "If you did not request this, you can safely ignore this email.\n\n"
        "WeCast"
    )
    html_body = f"""\
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f7efe2;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#171717;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7efe2;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fffaf0;border:1px solid #ead9b7;border-radius:24px;overflow:hidden;box-shadow:0 18px 40px rgba(23,23,23,0.08);">
            <tr>
              <td style="background:linear-gradient(180deg,#f6d35a 0%,#f7e6b3 100%);padding:28px 32px 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <img src="{safe_logo_url}" alt="WeCast" width="42" height="42" style="display:block;border:0;outline:none;text-decoration:none;">
                    </td>
                    <td style="vertical-align:middle;padding-left:12px;">
                      <div style="font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1;color:#111111;font-weight:700;">WeCast</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 32px 16px;">
                <div style="font-size:14px;line-height:1.5;color:#6b7280;">Password Reset</div>
                <h1 style="margin:10px 0 16px;font-size:34px;line-height:1.08;color:#111111;">Choose a new password</h1>
                <p style="margin:0 0 14px;font-size:16px;line-height:1.8;color:#374151;">Hi {safe_name},</p>
                <p style="margin:0 0 14px;font-size:16px;line-height:1.8;color:#374151;">
                  We received a request to reset the password for your WeCast account
                  <span style="font-weight:600;color:#111111;">{safe_email}</span>.
                </p>
                <p style="margin:0 0 22px;font-size:16px;line-height:1.8;color:#374151;">
                  Click the button below to set a new password securely.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                  <tr>
                    <td align="center" bgcolor="#111111" style="border-radius:14px;">
                      <a href="{safe_link}" style="display:inline-block;padding:15px 24px;font-size:16px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;">Reset password</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 14px;font-size:14px;line-height:1.8;color:#6b7280;">
                  If the button doesn’t work, copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 20px;font-size:13px;line-height:1.7;word-break:break-word;color:#7c3aed;">
                  <a href="{safe_link}" style="color:#7c3aed;text-decoration:none;">{safe_link}</a>
                </p>
                <div style="border-top:1px solid #ead9b7;margin-top:22px;padding-top:18px;">
                  <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#6b7280;">
                    If you didn’t request this change, you can safely ignore this email.
                  </p>
                  <p style="margin:0;font-size:14px;line-height:1.7;color:#6b7280;">
                    Need help? Visit
                    <a href="{safe_app_url}" style="color:#111111;font-weight:600;text-decoration:none;"> WeCast</a>.
                  </p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""
    return subject, text, html_body


def _send_reset_email_via_resend(email, display_name, reset_link):
    api_key = (os.getenv("RESEND_API_KEY") or "").strip()
    from_email = (os.getenv("RESEND_FROM_EMAIL") or "").strip()
    if not api_key or not from_email:
        return False

    from_name = (os.getenv("RESEND_FROM_NAME") or "WeCast").strip() or "WeCast"
    reply_to = (os.getenv("WECAST_SUPPORT_EMAIL") or from_email).strip()
    subject, text_body, html_body = _build_password_reset_email(display_name, email, reset_link)

    payload = {
        "from": f"{from_name} <{from_email}>",
        "to": [email],
        "subject": subject,
        "html": html_body,
        "text": text_body,
        "reply_to": reply_to,
    }
    response = requests.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    if not response.ok:
        raise RuntimeError(f"Resend email failed with status {response.status_code}")
    return True


def _send_reset_email_via_firebase(email):
    api_key = _firebase_web_api_key()
    if not api_key:
        return False

    endpoint = f"https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={api_key}"
    payload = {
        "requestType": "PASSWORD_RESET",
        "email": email,
    }
    continue_url = _password_reset_continue_url()
    if continue_url:
        payload["continueUrl"] = continue_url
        payload["canHandleCodeInApp"] = False

    response = requests.post(
        endpoint,
        headers={"Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    if response.ok:
        return True

    if continue_url:
        fallback_response = requests.post(
            endpoint,
            headers={"Content-Type": "application/json"},
            json={
                "requestType": "PASSWORD_RESET",
                "email": email,
            },
            timeout=30,
        )
        if fallback_response.ok:
            return True

    raise RuntimeError(
        f"Firebase reset email failed with status {response.status_code}: {response.text[:240]}"
    )


def prepare_password_reset_delivery(email, strict=False):
    from firebase_admin import auth as fb_auth

    normalized_email = (email or "").strip().lower()
    doc = get_user_doc_by_candidates(normalized_email)
    data = doc.to_dict() or {} if doc and doc.exists else {}
    stored_provider = normalize_auth_provider(
        data.get("authProvider"),
        data.get("password_hash"),
    )
    user_record = None
    migrated_from_legacy = False
    try:
        user_record = fb_auth.get_user_by_email(normalized_email)
    except fb_auth.UserNotFoundError:
        user_record = None

    if not user_record:
        if stored_provider in {"google", "github"}:
            if strict:
                return {"status": "provider_managed", "authProvider": stored_provider}
            return {"status": "hidden"}

        if data.get("password_hash"):
            try:
                user_record = _provision_legacy_password_user(normalized_email, doc, data)
                migrated_from_legacy = True
            except Exception as migration_error:
                print(
                    f"Legacy password account migration failed for {normalized_email}: {migration_error}"
                )
                if strict:
                    return {"status": "unavailable", "authProvider": "password"}
                return {"status": "hidden"}
        else:
            if strict:
                return {"status": "unavailable", "authProvider": stored_provider or "unknown"}
            return {"status": "hidden"}

    provider_ids = {
        (getattr(provider, "provider_id", "") or "").strip().lower()
        for provider in (getattr(user_record, "provider_data", None) or [])
        if (getattr(provider, "provider_id", "") or "").strip()
    }
    has_password_provider = "password" in provider_ids or (
        not provider_ids and stored_provider == "password"
    )

    if "google.com" in provider_ids or stored_provider == "google":
        auth_provider = "google"
    elif "github.com" in provider_ids or stored_provider == "github":
        auth_provider = "github"
    else:
        auth_provider = "password"

    if not has_password_provider:
        if strict and auth_provider in {"google", "github"}:
            return {"status": "provider_managed", "authProvider": auth_provider}
        if strict:
            return {"status": "unavailable", "authProvider": auth_provider}
        return {"status": "hidden"}

    display_name = (
        data.get("displayName")
        or data.get("name")
        or getattr(user_record, "display_name", None)
        or normalized_email.split("@")[0]
    ).strip()

    try:
        reset_link = _generate_firebase_password_reset_link(normalized_email)
    except Exception as link_error:
        print(f"Firebase password reset link generation failed for {normalized_email}: {link_error}")
        return {
            "status": "not_sent",
            "delivery": "none",
            "authProvider": "password",
            "email": normalized_email,
            "migratedFromLegacy": migrated_from_legacy,
        }

    delivery = ""

    try:
        if _send_reset_email_via_resend(normalized_email, display_name, reset_link):
            delivery = "resend"
    except Exception as send_error:
        print(f"Resend password reset email failed for {normalized_email}: {send_error}")

    if not delivery:
        try:
            if _send_reset_email_via_firebase(normalized_email):
                delivery = "firebase_server"
        except Exception as send_error:
            print(f"Firebase server reset email send failed for {normalized_email}: {send_error}")

    if delivery:
        if doc and doc.exists:
            merge_payload = {
                "authProvider": "password",
                "emailVerified": bool(
                    data.get("emailVerified", getattr(user_record, "email_verified", True))
                ),
                "last_password_reset_request": datetime.utcnow().isoformat(),
                "last_password_reset_delivery": delivery,
            }
            firebase_uid = getattr(user_record, "uid", "") or data.get("firebaseUid", "")
            if firebase_uid:
                merge_payload["firebaseUid"] = firebase_uid

            doc.reference.set(merge_payload, merge=True)

        return {
            "status": "sent",
            "delivery": delivery,
            "authProvider": "password",
            "email": normalized_email,
            "migratedFromLegacy": migrated_from_legacy,
        }

    return {
        "status": "not_sent",
        "delivery": "none",
        "authProvider": "password",
        "email": normalized_email,
        "migratedFromLegacy": migrated_from_legacy,
    }

# ------------------------------------------------------------
# API Clients (OpenAI + ElevenLabs)
# ------------------------------------------------------------
# OpenAI client for script + title generation
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_API_KEY)
# ElevenLabs client for multi speaker TTS
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
print("ELEVENLABS_API_KEY present?", bool(ELEVENLABS_API_KEY))

if not ELEVENLABS_API_KEY:
    raise RuntimeError(
        "ELEVENLABS_API_KEY is missing. Add it to .env next to app.py:\n"
        "ELEVENLABS_API_KEY=xi_************************"
    )

voice_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

def _chat_completion_with_fallback(messages, temperature=0.7, models=None):
    """
    Try multiple OpenAI chat models in order and return the first success.
    """
    model_candidates = models or [
        os.getenv("OPENAI_CHAT_MODEL", "").strip() or "gpt-4o",
        os.getenv("OPENAI_CHAT_FALLBACK_MODEL", "").strip() or "gpt-4o-mini",
    ]

    seen = set()
    ordered = []
    for m in model_candidates:
        if m and m not in seen:
            ordered.append(m)
            seen.add(m)

    errors = []
    for model in ordered:
        try:
            return client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
            )
        except Exception as e:
            errors.append(f"{model}: {e}")

    raise RuntimeError(" | ".join(errors) if errors else "No OpenAI chat model configured")


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

def is_arabic(text: str) -> bool:
    """
    Detect if text is *mostly* Arabic.
    Returns True only if a reasonable percentage of letters are Arabic.
    """
    if not text:
        return False

    arabic_letters = 0
    total_letters = 0

    for c in text:
        if c.isalpha():
            total_letters += 1
            if "\u0600" <= c <= "\u06FF" or "\u0750" <= c <= "\u08FF":
                arabic_letters += 1

    if total_letters == 0:
        return False

    return (arabic_letters / total_letters) >= 0.30


def detect_language(description: str) -> str:
    return "ar" if is_arabic(description) else "en"

def norm_token(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"[^\w\u0600-\u06FF]+", "", s)  # keep arabic letters too
    return s

def timeline_tokens(word_timeline):
    return [norm_token(w.get("w", "")) for w in word_timeline]

def find_anchor_start_sec(word_timeline, anchor: str):
    tokens = timeline_tokens(word_timeline)
    anchor_tokens = [norm_token(t) for t in anchor.split() if norm_token(t)]
    if len(anchor_tokens) < 2:
        return None

    n = len(tokens)
    m = len(anchor_tokens)

    for i in range(0, n - m + 1):
        if tokens[i:i+m] == anchor_tokens:
            return float(word_timeline[i]["start"])
    return None

def build_transcript_text_with_speakers(words):
    """
    Build a readable transcript with speaker labels in-line.
    Example:
      Bob: Hello there ...
      Alice: Hi Bob ...
    """
    if not words:
        return ""

    parts = []
    last_speaker = None

    for w in words:
        token = (w.get("w") or "").strip()
        if not token:
            continue

        speaker = (w.get("speaker") or "").strip()
        if speaker and speaker != last_speaker:
            if parts:
                parts.append("\n")
            parts.append(f"{speaker}: ")
            last_speaker = speaker

        parts.append(token + " ")

    return "".join(parts).strip()

def save_generated_podcast_to_firestore(user_id: str, title: str, script_style: str,
                                       description: str, script: str, speakers_info: list,
                                       language: str = ""):
    # 1) Create the podcast doc with an auto-ID
    podcast_ref = db.collection("podcasts").document()
    podcast_id = podcast_ref.id

    now = firestore.SERVER_TIMESTAMP
    lang = (language or "").strip().lower()
    if lang not in ("en", "ar"):
        lang = detect_language(description)

    # Podcast doc
    podcast_ref.set({
        "userId": user_id,
        "title": title or "Untitled Episode",
        "description": description,
        "language": lang,
        "style": script_style,
        "speakersCount": len(speakers_info or []),
        "status": "draft",
        "hasEditDraft": False,
        "createdAt": now,
        "lastEditedAt": now,
    })

    # 2) Speakers subcollection
    speakers_col = podcast_ref.collection("speakers")
    for s in speakers_info or []:
        speakers_col.document().set({
            "name": (s.get("name") or "").strip(),
            "gender": (s.get("gender") or "").strip(),
            "role": (s.get("role") or "").strip(),
            "providerVoiceId": (s.get("voiceId") or "").strip(),  
            "createdAt": now,
        })

    # 3) Script doc (single doc, id = "main")
    script_ref = podcast_ref.collection("scripts").document("main")
    script_ref.set({
        "sourceText": description,
        "finalScriptText": script,
        "wordCount": len((script or "").split()),
        "createdAt": now,
        "lastEditedAt": now,
    })

    return podcast_id

def generate_podcast_script(description: str, speakers_info: list, script_style: str, language: str = ""):
    """Generate a structured podcast script where ALL speakers talk,
    and remove only headings and bracket lines without touching the real script content.
    """

    lang = (language or "").strip().lower()
    if lang not in ("en", "ar"):
        lang = detect_language(description)

    is_ar = lang == "ar"
    language_instruction = (
        "Please write the script in Arabic."
        if is_ar
        else "Please write the script in English."
    )

    if is_ar:
            intro_block = f"""
            --------------------
            {ARABIC_SECTION_HEADERS["INTRO"]}
            --------------------
          
- يجب أن يبدأ النص بتحية من المضيف للمستمعين بطريقة طبيعية مثل:
  "<HostName>: أهلاً بكم في بودكاست '{{SHOW_TITLE}}'."
  أو
  "<HostName>: مرحباً بكم في '{{SHOW_TITLE}}'."
  أو
  "<HostName>: سعيد بانضمامكم إلينا في '{{SHOW_TITLE}}'."
  أو تحية مشابهة طبيعية ومتنوعة.

- يمنع استخدام العبارات التالية:
  "أهلاً بكم في حلقة جديدة من"
  أو
  "أهلا بكم في حلقة جديدة"

- يجب أن تكون التحية طبيعية ومتنوعة وليست مكررة.

- بعد التحية مباشرة:
  قم بتقديم موضوع الحلقة بشكل طبيعي.

- ثم قدم المتحدثين أو الضيوف بطريقة سلسة وطبيعية ضمن النص.

- اجعل الأسلوب يشبه بودكاست حقيقي، محادثة خفيفة وطبيعية بين المضيف والضيوف.

    """
    else:
            intro_block = """
            --------------------
            INTRO
            --------------------
           - Start with: Host greets listeners and says something NATURAL like:
    "<HostName>: Welcome to our podcast '{{SHOW_TITLE}}'."
    OR
    "<HostName>: Hello and welcome to '{{SHOW_TITLE}}'."
    OR
    "<HostName>: Thanks for joining us on '{{SHOW_TITLE}}'."
    - DO NOT use the phrase "Welcome to another episode of" or "Welcome to another episode".
    - Use more natural, varied opening greetings.
    - Then introduce the topic + speakers naturally.
            """

    # Format speakers list for GPT
    num_speakers = len(speakers_info)
    speaker_info_text = "\n".join(
        [f"- {s['name']} ({s['gender']}, {s['role']})" for s in speakers_info]
    )

    # Style guidelines used in prompt
    style_guidelines = {
        "Interview": """
- Tone: Professional, journalistic.
- Flow: Host asks, guest answers.
- Turn-taking: MUST alternate speakers.
- Goal: Insightful conversation.
""",
        "Storytelling": """
- Tone: Cinematic and narrative.
- Flow: Story with emotional beats.
- Turn-taking: All speakers appear in intro, body, outro.
- Goal: Immersive storytelling.
""",
        "Educational": """
- Tone: Clear and helpful.
- Flow: Explain â†’ clarify â†’ examples.
- Turn-taking: Host + guests engage.
- Goal: Learn through dialogue.
""",
        "Conversational": """
- Tone: Friendly and natural.
- Flow: Co-host casual conversation.
- Turn-taking: Hosts react and alternate often.
- Goal: Feel like real conversation.
""",
    }

    style_rules = style_guidelines.get(script_style, "")

    # FULL PROMPT 
    prompt = f"""
You are a professional podcast scriptwriter.

There should be exactly {num_speakers} speaker(s). Use these exact labels:

{speaker_info_text}

Format the content into a natural podcast script. Do not exceed or invent story details.

STYLE: {script_style}

Follow these requirements:
{intro_block}

--------------------
{"النص" if is_ar else "BODY"}
--------------------
- Natural dialogue.
- All speakers MUST speak multiple times.
- Turn-taking is REQUIRED.

--------------------
{"الخاتمة" if is_ar else "OUTRO"}
--------------------
- Summary or closing thoughts.

--------------------
RULES
--------------------
- The script MUST contain three sections in this exact format:

--------------------
{"مقدمة" if is_ar else "INTRO"}
--------------------
{ARABIC_MUSIC_TAG if is_ar else "[music]"}
[script content here]
{ARABIC_MUSIC_TAG if is_ar else "[music]"}

--------------------
{"النص" if is_ar else "BODY"}
--------------------
[script content here]
--------------------
{"الخاتمة" if is_ar else "OUTRO"}
--------------------
{ARABIC_MUSIC_TAG if is_ar else "[music]"}
[script content here]
{ARABIC_MUSIC_TAG if is_ar else "[music]"}

- Do NOT add any extra music tags.
- Do NOT put music in the middle of dialogue.
- Every spoken line MUST begin with: SpeakerName:
- Do NOT use bullet points inside the script.
- Do NOT use markdown (#, ##, ### headings).
- Sound cues must be inside square brackets.
- Keep the script natural and flowing.

SPEAKER RULES (MANDATORY â€” DO NOT VIOLATE):
- Speaker Interaction Rule: When a speaker replies, they should naturally reference the other speaker's label when appropriate during conversation. Speakers MUST address each other using the exact labels provided (example: if speakers are x and v, then the script may contain: "That’s interesting, v." or "What do you think, x?").
- Keep speaker labels EXACTLY as written in the input (example: ga, ha, sp, user, narrator).
- Do NOT rename, modify, expand, substitute, or invent new speaker names.
- If the original text contains: "ga:", "ha:" or any label format, use them EXACTLY.
- DO NOT convert them to human names or fictional identities.
- If a line does not have a speaker label, DO NOT create one.
- Output must preserve speaker labeling format literally.

TRANSITION SPEECH RULES (VERY IMPORTANT):

- The sentence immediately BEFORE a {"[music]" if not is_ar else ARABIC_MUSIC_TAG} tag must sound like a natural ending, conclusion, or pause. 
- Do NOT end abruptly. End with tone markers such as:
  1- a reflective closing thought
  2- a conversational wrap-up
  3- a gentle shift phrase such as:
      "We'll continue right after this..."
      "More on that in a moment."
      "Let's pause for a second."

- The FIRST sentence after a {"[music]" if not is_ar else ARABIC_MUSIC_TAG} tag must feel like a fresh beginning or a smooth re-entry. 
- Use natural re-entry language like:
      "Welcome back”"
      "Now lets continue”"
      "Picking up where we left off”"
      "So now”"

- DO NOT be robotic or repetitive. 
- Tone must feel intentional, confident, and designed for audio.

{language_instruction}

Transform the following text into a structured podcast script:

[TEXT START]
{description}
[TEXT END]
"""

    # ---- Call GPT ----
    response = _chat_completion_with_fallback(
        messages=[
            {
                "role": "system",
                "content": "You write natural, structured podcast scripts with correct speaker dialogue."
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.75,
    )

    raw_script = response.choices[0].message.content.strip()
    PLACEHOLDER = SHOW_TITLE_PLACEHOLDER  

    if PLACEHOLDER not in raw_script:
        raw_script = re.sub(r"\{SHOW_TITLE\}", PLACEHOLDER, raw_script)
        raw_script = re.sub(r"\bSHOW_TITLE\b", PLACEHOLDER, raw_script)

    if PLACEHOLDER not in raw_script:
        m = re.search(
            r'episode of\s+["“«](.+?)["”»]',
            raw_script,
            flags=re.IGNORECASE,
        )
        if m:
            bad_title = m.group(2)
            raw_script = raw_script.replace(bad_title, PLACEHOLDER, 1)

    if PLACEHOLDER not in raw_script and is_arabic(raw_script):
        m = re.search(
            r"(?:حلقة من|من)\s*[\"“«](.+?)[\"”»]",
            raw_script,
        )
        if m:
            bad_title = m.group(1)
            raw_script = raw_script.replace(bad_title, PLACEHOLDER, 1)

    # ============================================================
    # CLEAN ONLY BAD LINES 
    # ============================================================
    cleaned_lines = []
    for ln in raw_script.splitlines():
        stripped = ln.strip()

        # remove markdown headings like "# Intro", "### BODY"
        if re.match(r"^#{1,6}\s+\w+", stripped):
            continue

        # remove bracket-only lines EXCEPT music tags
        if re.fullmatch(r"\[[^\]]+\]", stripped):
            if not is_music_tag(stripped):
                continue

        cleaned_lines.append(ln)

    cleaned_raw = "\n".join(cleaned_lines)
    final_script = localize_script_structure(cleaned_raw, lang)

    return final_script


def generate_title_from_script(script: str, script_style: str = "") -> str:
    """Generate a short, catchy podcast episode title (3-8 words)."""

    text = script or ""
    if not text.strip():
        return "Untitled Episode"

    # Detect language from the script itself
    is_ar = is_arabic(text)
    style_label = script_style or ("تعليمي" if is_ar else "General")

    if is_ar:
        # Arabic title instructions
        prompt = f"""
أنت كاتب محترف لعناوين البودكاست.

اكتب عنوانًا واحدًا قصيرًا وجذابًا لحلقة بودكاست
مكوّنًا من 3 إلى 8 كلمات تقريبًا.

القواعد:
- العنوان باللغة العربية فقط.
- لا تضع أرقام للحلقات.
- لا تستخدم علامات اقتباس أو إيموجي.
- أعد سطرًا واحدًا يحتوي على العنوان فقط بدون أي شرح إضافي.

نمط الحلقة: {style_label}

النص:
\"\"\"{text[:4000]}\"\"\"        
"""
    else:
        prompt = f"""
You are an assistant helping to name a podcast episode.

Write ONE short, catchy podcast episode title in 4â€“8 words.

Style: {style_label}

Rules:
- No quotation marks.
- No episode numbers.
- No emojis.
- Title case (Capitalize Major Words).
- Return ONLY the title text, nothing else.

Script:
\"\"\"{text[:4000]}\"\"\"        
"""

    resp = _chat_completion_with_fallback(
        messages=[
            {
                "role": "system",
                "content": "You write concise, catchy podcast titles in the same language as the script.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.7,
    )

    title = (resp.choices[0].message.content or "").strip()
    title = title.strip('"â€œâ€‌آ«آ»').strip()

    if not title:
        return "حلقة بدون عنوان" if is_ar else "Untitled Episode"

    return title


def fallback_time_split_chapters(word_timeline, language: str = "en"):
    if not word_timeline:
        return []

    duration = float(word_timeline[-1]["end"])
    cuts = [0.0, duration * 0.22, duration * 0.45, duration * 0.7, duration * 0.88]

    if language == "ar":
        titles = [
            "\u0627\u0644\u0645\u0642\u062f\u0645\u0629",
            "\u0627\u0644\u062e\u0644\u0641\u064a\u0629",
            "\u0623\u0647\u0645 \u0627\u0644\u0646\u0642\u0627\u0634\u0627\u062a",
            "\u0646\u0642\u0627\u0637 \u062a\u062d\u0648\u0644",
            "\u0627\u0644\u062e\u0627\u062a\u0645\u0629",
        ]
    else:
        titles = ["Opening", "Background", "Key Discussion", "Turning Points", "Wrap-Up"]
    out = [{"title": t, "startSec": float(c)} for t, c in zip(titles, cuts)]
    return out

def sanitize_chapter_titles(chapters, language: str = "en"):
    items = list(chapters or [])
    if language != "ar" or not items:
        return items

    fallback_titles = [c["title"] for c in fallback_time_split_chapters(
        [{"end": float(idx + 1)} for idx in range(max(len(items), 5))], language="ar"
    )]

    sanitized = []
    for idx, chapter in enumerate(items):
        title = str((chapter or {}).get("title") or "").strip()
        start_sec = float((chapter or {}).get("startSec") or 0.0)
        looks_broken = (
            not title
            or re.fullmatch(r"[\?\u061F\s]+", title) is not None
            or ("?" in title and not is_arabic(title))
        )
        sanitized.append({
            "title": fallback_titles[idx] if looks_broken and idx < len(fallback_titles) else title,
            "startSec": start_sec,
        })

    return sanitized

def generate_chapters_from_transcript(transcript_text: str, language: str = "en"):
    if language == "ar":
        user_prompt = f"""
Split this podcast transcript into podcast chapters for a player.
Return 5 to 7 chapters.
For each chapter:
- title: short (2-6 words) in Arabic.
- anchor: a short phrase (4-12 words) that appears in the transcript and starts that section (must be nearly exact text). Keep the anchor in the transcript's original language.

Return JSON only:
{{"chapters":[{{"title":"...","anchor":"..."}}, ...]}}

Transcript:
\"\"\"{transcript_text[:12000]}\"\"\"
"""
    else:
        user_prompt = f"""
Split this podcast transcript into podcast chapters for a player.
Return 5 to 7 chapters.
For each chapter:
- title: short (2-6 words)
- anchor: a short phrase (4-12 words) that appears in the transcript and starts that section (must be nearly exact text)

Return JSON only:
{{"chapters":[{{"title":"...","anchor":"..."}}, ...]}}

Transcript:
\"\"\"{transcript_text[:12000]}\"\"\"
"""

    resp = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "Return strict JSON only. No markdown."},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
    )

    raw = (resp.choices[0].message.content or "").strip()
    # naive JSON parse
    try:
        data = __import__("json").loads(raw)
        return data.get("chapters") or []
    except Exception:
        return []

def build_chapters(word_timeline, transcript_text, language="en"):
    try:
        proposed = generate_chapters_from_transcript(transcript_text, language=language)
    except Exception as exc:
        print(f"Chapter generation failed, using fallback: {exc}")
        proposed = []

    chapters = []
    used = set()

    for ch in proposed:
        title = (ch.get("title") or "").strip()
        anchor = (ch.get("anchor") or "").strip()
        if not title or not anchor:
            continue

        start = find_anchor_start_sec(word_timeline, anchor)
        if start is None:
            continue

        # avoid duplicates / too-close chapters
        key = round(start, 2)
        if key in used:
            continue
        used.add(key)

        chapters.append({"title": title, "startSec": start})

    chapters.sort(key=lambda x: x["startSec"])

    # Guardrails: must be actual chapters‌
    # If fewer than 5 chapters, fallback to deterministic time split
    if len(chapters) < 5:
        chapters = fallback_time_split_chapters(word_timeline, language=language)

    return sanitize_chapter_titles(chapters, language=language)


def validate_roles(style: str, speakers_info: list):
    roles = [s["role"] for s in speakers_info]

    if style == "Interview":
        return (
            roles in [["host", "guest"], ["host", "host", "guest"]],
            "For 'Interview' style, valid setups: 1 host â†’ 1 guest or 2 hosts â†’ 1 guest.",
        )

    if style == "Storytelling":
        return (
            roles in [["host"], ["host", "guest"], ["host", "guest", "guest"]],
            "For 'Storytelling' style, valid setups: 1 host solo, 1 host â†’ 1 guest, or 1 host â†’ 2 guests.",
        )

    if style == "Educational":
        return (
            roles in [["host"], ["host", "guest"], ["host", "guest", "guest"]],
            "For 'Educational' style, valid setups: 1 host solo, 1 host â†’ 1 guest, or 1 host â†’ 2 guests.",
        )

    if style == "Conversational":
        return (
            roles in [["host", "host"], ["host", "host", "host"]],
            "For 'Conversational', use 2â€“3 hosts (no guests).",
        )

    return (True, "")

def chars_to_words(text: str, ch_starts: list, ch_ends: list):
    """
    Convert character-level timestamps to word-level.
    Returns list of dicts: {w, start, end}
    """
    words = []
    if not text:
        return words

    n = min(len(text), len(ch_starts), len(ch_ends))
    i = 0

    while i < n:
        if text[i].isspace():
            i += 1
            continue

        start_i = i
        start_t = ch_starts[i]

        while i < n and not text[i].isspace():
            i += 1

        end_i = i - 1
        end_t = ch_ends[end_i]

        token = text[start_i:i].strip()
        if token:
            words.append({"w": token, "start": float(start_t), "end": float(end_t)})

    return words

def eleven_tts_with_timestamps(text: str, voice_id: str, model_id: str = "eleven_multilingual_v2"):
    """
    Returns: (audio_bytes, word_timings_for_this_segment)
    word timings are relative to segment start (0.0)
    """
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps"
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = {
        "text": text,
        "model_id": model_id,
        "output_format": "mp3_44100_128",
    }

    r = requests.post(url, headers=headers, json=body, timeout=120)
    if not r.ok:
        raise RuntimeError(f"ElevenLabs error {r.status_code}: {r.text[:300]}")

    data = r.json()
    audio_b64 = data.get("audio_base64")
    if not audio_b64:
        raise RuntimeError("Missing audio_base64 in ElevenLabs response.")

    audio_bytes = base64.b64decode(audio_b64)

    alignment = data.get("alignment") or {}
    ch_starts = alignment.get("character_start_times_seconds") or []
    ch_ends = alignment.get("character_end_times_seconds") or []

    # Convert char timings to words using the exact same text we sent
    words = chars_to_words(text, ch_starts, ch_ends)

    return audio_bytes, words

@app.get("/api/health")
def health():
    return jsonify(status="ok")

@app.get("/api/voices")
def api_voices():
    provider_q = (request.args.get("provider") or "").strip().lower()
    gender_q = (request.args.get("gender") or "").strip().lower()
    try:
        limit = int(request.args.get("limit") or "0")
    except Exception:
        limit = 0
    #allow larger lists but prevent overly heavy responses.
    limit = max(0, min(limit, 1000))

    def _gender_matches(value: str):
        if not gender_q:
            return True
        v = (value or "").strip().lower()
        if not v:
            return False
        return v == gender_q

    def _normalize_eleven_voice(v: dict):
        voice_id = v.get("voice_id") or v.get("voiceId") or v.get("id") or ""
        labels = v.get("labels") or {}
        gender = v.get("gender") or labels.get("gender") or ""
        return {
            "docId": voice_id,
            "id": voice_id,
            "providerVoiceId": voice_id,
            "provider": "ElevenLabs",
            "name": v.get("name") or "",
            "gender": gender,
            "description": v.get("description") or "",
            "pitch": labels.get("pitch") or "",
            "languages": labels.get("languages") or [],
            "tone": labels.get("tone") or [],
            "labels": {"gender": gender},
            "preview_url": v.get("preview_url") or "",
        }

    # If caller explicitly requests ElevenLabs, fetch live list directly.
    if provider_q == "elevenlabs":
        if not ELEVENLABS_API_KEY:
            return jsonify(count=0, items=[], error="Missing ELEVENLABS_API_KEY"), 500
        try:
            r = requests.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": ELEVENLABS_API_KEY},
                timeout=30,
            )
            if not r.ok:
                return jsonify(
                    count=0,
                    items=[],
                    error=f"ElevenLabs voices error {r.status_code}: {r.text[:300]}",
                ), 502
            voices = (r.json() or {}).get("voices") or []
            items = [_normalize_eleven_voice(v) for v in voices if (v.get("voice_id") or v.get("id"))]
            if gender_q:
                items = [x for x in items if _gender_matches(x.get("gender"))]
            if limit > 0:
                items = items[:limit]
            return jsonify(count=len(items), items=items)
        except Exception as e:
            print("ElevenLabs /api/voices direct ERROR:", e)
            return jsonify(error=str(e), count=0, items=[]), 500

    try:
        docs = db.collection("voices").stream()

        items = []
        for d in docs:
            v = d.to_dict() or {}

            # normalize fields (support both Firestore styles)
            name = v.get("name") or v.get("Name") or ""
            gender = v.get("gender") or v.get("Gender") or ""
            description = v.get("description") or v.get("Description") or ""
            provider = v.get("provider") or v.get("Provider") or "ElevenLabs"
            pitch = v.get("pitch") or v.get("Pitch") or ""
            languages = v.get("languages") or v.get("Languages") or []
            tone = v.get("tone") or v.get("Tone") or []

            provider_voice_id = (
                v.get("providerVoiceId")
                or v.get("provider_voice_id")
                or v.get("voiceId")
                or v.get("VoiceId")
                or v.get("id")
                or d.id
            )

            out = {
                "docId": d.id,
                "id": provider_voice_id,           
                "providerVoiceId": provider_voice_id,    
                "provider": provider,
                "name": name,
                "gender": gender,
                "description": description,
                "pitch": pitch,
                "languages": languages if isinstance(languages, list) else [],
                "tone": tone if isinstance(tone, list) else [],
                "labels": {"gender": gender},  
                "preview_url": v.get("preview_url") or "",     
            }
            if _gender_matches(gender):
                items.append(out)

        if items:
            return jsonify(count=len(items), items=items)

        # Fallback to ElevenLabs if Firestore has no voices
        if not ELEVENLABS_API_KEY:
            return jsonify(count=0, items=[], error="Missing ELEVENLABS_API_KEY"), 500

        try:
            r = requests.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": ELEVENLABS_API_KEY},
                timeout=30,
            )
            if not r.ok:
                return jsonify(
                    count=0,
                    items=[],
                    error=f"ElevenLabs voices error {r.status_code}: {r.text[:200]}",
                ), 502

            data = r.json() or {}
            voices = data.get("voices") or []
            for v in voices:
                voice_id = v.get("voice_id") or v.get("voiceId") or v.get("id") or ""
                labels = v.get("labels") or {}
                gender = v.get("gender") or labels.get("gender") or ""
                out = {
                    "docId": voice_id,
                    "id": voice_id,
                    "providerVoiceId": voice_id,
                    "provider": "ElevenLabs",
                    "name": v.get("name") or "",
                    "gender": gender,
                    "description": v.get("description") or "",
                    "pitch": labels.get("pitch") or "",
                    "languages": labels.get("languages") or [],
                    "tone": labels.get("tone") or [],
                    "labels": {"gender": gender},
                }
                if _gender_matches(gender):
                    items.append(out)

            return jsonify(count=len(items), items=items)
        except Exception as e:
            print("ElevenLabs /api/voices fallback ERROR:", e)
            return jsonify(error=str(e), count=0, items=[]), 500

    except Exception as e:
        print("Firestore /api/voices ERROR:", e)
        return jsonify(error=str(e), count=0, items=[]), 500

@app.post("/api/voices/preview")
def api_voice_preview():
    data = request.get_json(force=True) or {}
    incoming = (data.get("voiceId") or "").strip()
    incoming_name = (data.get("voiceName") or "").strip()
    text = (data.get("text") or "Hello, this is a WeCast preview.").strip()
    if len(text) > 120:
        text = text[:120].strip()

    if not ELEVENLABS_API_KEY:
        return jsonify(error="Missing ELEVENLABS_API_KEY"), 500

    if not incoming:
        return jsonify(error="Missing voiceId"), 400

    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
    }

    def _synthesize_preview(candidate_voice_id: str):
        url = (
            f"https://api.elevenlabs.io/v1/text-to-speech/{candidate_voice_id}/stream"
            "?optimize_streaming_latency=4"
        )
        payload = {
            "text": text,
            "model_id": "eleven_turbo_v2_5",
            "output_format": "mp3_44100_64",
        }
        return requests.post(url, headers=headers, json=payload, timeout=40)

    # Fast path: synthesize directly using the incoming ID.
    voice_id = incoming
    r = _synthesize_preview(voice_id)
    if r.ok:
        return Response(r.content, mimetype="audio/mpeg")

    # Fallback: resolve by id/name from account voices, then retry once.
    if r.status_code == 404:
        try:
            vr = requests.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": ELEVENLABS_API_KEY},
                timeout=20,
            )
            if not vr.ok:
                return jsonify(
                    error=f"ElevenLabs voices list failed {vr.status_code}",
                    details=vr.text[:400],
                ), 502

            voices = (vr.json() or {}).get("voices") or []
            by_id = {str(v.get("voice_id") or v.get("id") or "").strip(): v for v in voices}
            by_name = {
                (v.get("name") or "").strip().lower(): v
                for v in voices
                if (v.get("name") or "").strip()
            }

            if voice_id not in by_id:
                suggest_name = (incoming_name or incoming).strip().lower()
                match = by_name.get(suggest_name)
                if match and (match.get("voice_id") or match.get("id")):
                    voice_id = (match.get("voice_id") or match.get("id")).strip()
                else:
                    return jsonify(
                        error="Voice not found in ElevenLabs account",
                        received=incoming,
                        receivedName=incoming_name,
                    ), 404

            retry = _synthesize_preview(voice_id)
            if retry.ok:
                return Response(retry.content, mimetype="audio/mpeg")
            if retry.status_code == 404:
                return jsonify(
                    error="Voice not found on ElevenLabs",
                    voice_id=voice_id,
                    details=retry.text[:400],
                ), 404
            return jsonify(
                error=f"ElevenLabs error {retry.status_code}",
                voice_id=voice_id,
                details=retry.text[:800],
            ), 502
        except Exception as e:
            return jsonify(error="Failed to resolve voice", details=str(e)), 500

    return jsonify(
        error=f"ElevenLabs error {r.status_code}",
        voice_id=voice_id,
        details=r.text[:800],
    ), 502

def _require_login_user():
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return None, (jsonify(error="Not logged in"), 401)
    return user_id, None


def _assert_podcast_owner(podcast_id: str, user_id: str):
    ref = db.collection("podcasts").document(podcast_id)
    doc = ref.get()
    if not doc.exists:
        return None, (jsonify(error="Podcast not found"), 404)

    pdata = doc.to_dict() or {}
    if pdata.get("userId") != user_id:
        return None, (jsonify(error="Forbidden"), 403)

    return pdata, None


def _get_draft_for(podcast_id: str):
    draft = session.get("create_draft") or {}
    # Safety: only return the draft if it matches the podcastId
    if draft.get("podcastId") != podcast_id:
        return {}
    return draft


def _set_draft_for(podcast_id: str, updates: dict):
    draft = session.get("create_draft") or {}
    if draft.get("podcastId") != podcast_id:
        # If the draft isn't for this podcast, create a minimal draft entry
        draft = {"podcastId": podcast_id}
    draft.update(updates)
    session["create_draft"] = draft
    session.modified = True


def _edit_draft_ref(podcast_id: str):
    return db.collection("podcasts").document(podcast_id).collection("edits").document("draft")


def _serialize_edit_draft(doc):
    if not doc.exists:
        return None

    data = doc.to_dict() or {}
    def _iso(value):
        if not value:
            return ""
        if isinstance(value, datetime):
            return value.isoformat()
        if hasattr(value, "isoformat"):
            try:
                return value.isoformat()
            except Exception:
                return ""
        return str(value)

    return {
        "showTitle": data.get("showTitle", ""),
        "script": data.get("script", ""),
        "speakers": data.get("speakers", []),
        "introMusic": data.get("introMusic", ""),
        "bodyMusic": data.get("bodyMusic", ""),
        "outroMusic": data.get("outroMusic", ""),
        "category": data.get("category", ""),
        "savedAt": _iso(data.get("savedAt")),
        "updatedAt": _iso(data.get("updatedAt")),
    }


def _validate_image_bytes(image_bytes: bytes, min_size: int = 512):
    try:
        img = Image.open(BytesIO(image_bytes))
        img.verify()  # verify file integrity
    except UnidentifiedImageError:
        return False, "Unsupported image format. Please upload PNG/JPG."
    except Exception:
        return False, "Invalid image file."

    # reopen after verify
    img = Image.open(BytesIO(image_bytes))
    w, h = img.size

    if w < min_size or h < min_size:
        return False, f"Image too small. Minimum is {min_size}x{min_size}px."

    return True, {"width": w, "height": h, "format": (img.format or "").upper()}


def _build_cover_prompt(title: str, style: str, language: str, description: str, extra: str = ""):
    lang_hint = "Arabic" if language == "ar" else "English"

    # no text on image (title is shown in UI, not baked into art)
    return f"""
Create a professional podcast cover art image.

Context:
- Episode title: "{title}"
- Podcast style: {style or "Conversational"}
- Language context: {lang_hint}

Design requirements:
- Square composition (1:1), podcast-platform friendly
- Modern, clean, high contrast, minimal clutter
- A single strong focal concept + abstract shapes related to the topic
- Do NOT include readable text, letters, numbers, logos, or watermarks
- Avoid photorealistic faces; prefer abstract/illustrative/graphic styles

Topic description:
{description[:1200]}

Optional direction:
{extra}
""".strip()


def _generate_cover_b64(prompt: str, size: str = "1024x1024") -> str:
    """
    Uses OpenAI Images API (gpt-image-1) and returns base64 PNG.
    """
    img = client.images.generate(
        model="gpt-image-1",
        prompt=prompt,
        size=size,
    )
    return img.data[0].b64_json


def _cover_ext_from_mime(mime_type: str) -> str:
    mt = (mime_type or "").lower()
    if mt == "image/jpeg":
        return "jpg"
    if mt == "image/webp":
        return "webp"
    return "png"


def _make_cover_thumb_b64(image_bytes: bytes, size: int = 256) -> str:
    """
    Create a small JPEG thumbnail base64 suitable for Firestore storage.
    """
    try:
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        img.thumbnail((size, size))
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=78, optimize=True)
        return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception:
        return ""

def _persist_avatar_to_r2(user_id: str, image_bytes: bytes, mime_type: str):
    ext = _cover_ext_from_mime(mime_type)
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    object_key = f"avatars/{user_id}/{ts}.{ext}"

    upload_bytes_to_r2(image_bytes, object_key, mime_type)
    signed_url = build_r2_asset_url(object_key, expires_in=3600)

    return signed_url, object_key

def _persist_cover_to_storage_and_doc(podcast_id: str, cover_b64: str, mime_type: str = "image/png"):
    """
    Persist cover image to Cloudflare R2 and store a small thumbnail in Firestore.
    Returns: (cover_url, storage_path, thumb_b64, persist_error)
    """
    if not cover_b64:
        return "", "", "", "missing_cover_data"
    
    if cover_b64.startswith("data:"):
        cover_b64 = cover_b64.split(",", 1)[1]

    img_bytes = base64.b64decode(cover_b64)
    thumb_b64 = _make_cover_thumb_b64(img_bytes)
    ext = _cover_ext_from_mime(mime_type)
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    storage_path = f"covers/{podcast_id}/{ts}.{ext}"

    cover_url = ""
    persist_error = ""
    old_cover_path = ""

    try:
        existing_doc = db.collection("podcasts").document(podcast_id).get()
        if existing_doc.exists:
            old_cover_path = ((existing_doc.to_dict() or {}).get("coverPath") or "").strip()
    except Exception:
        old_cover_path = ""

    try:
        upload_bytes_to_r2(img_bytes, storage_path, mime_type)
        cover_url = build_r2_asset_url(storage_path, expires_in=3600)
    except Exception as e:
        persist_error = f"r2_upload_failed: {e}"

    if old_cover_path and old_cover_path != storage_path and not persist_error:
        delete_from_r2_quietly(old_cover_path, label="Cover replace")

    db.collection("podcasts").document(podcast_id).set(
        {
            "coverUrl": cover_url,
            "coverPath": storage_path,
            "coverMimeType": mime_type,
            "coverThumbB64": thumb_b64,
            "coverUpdatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )

    return cover_url, storage_path, thumb_b64, persist_error

@app.get("/api/podcasts/<podcast_id>/finalize")
def api_finalize_get(podcast_id):
    user_id, err = _require_login_user()
    if err:
        return err

    pdata, err = _assert_podcast_owner(podcast_id, user_id)
    if err:
        return err

    draft = _get_draft_for(podcast_id)
    cover_b64 = draft.get("coverArtBase64")
    cover_meta = draft.get("coverArtMeta") or {}
    title = draft.get("title") or pdata.get("title") or "Untitled Episode"

    return jsonify(
        ok=True,
        podcastId=podcast_id,
        title=title,
        coverArtBase64=cover_b64,
        coverArtMeta=cover_meta,
    )

@app.post("/api/podcasts/<podcast_id>/cover/generate")
def api_cover_generate(podcast_id):
    user_id, err = _require_login_user()
    if err:
        return err

    pdata, err = _assert_podcast_owner(podcast_id, user_id)
    if err:
        return err

    payload = request.get_json(silent=True) or {}

    # prefer the latest title (payload -> session draft -> firestore)
    draft = _get_draft_for(podcast_id)
    title = (payload.get("title") or draft.get("title") or pdata.get("title") or "Untitled Episode").strip()

    # topic text: prefer session description, otherwise fetch from Firestore script
    description = (payload.get("description") or draft.get("description") or "").strip()
    if not description:
        try:
            sdoc = db.collection("podcasts").document(podcast_id).collection("scripts").document("main").get()
            if sdoc.exists:
                sdata = sdoc.to_dict() or {}
                description = (sdata.get("sourceText") or sdata.get("finalScriptText") or "")[:2000]
        except Exception:
            description = ""

    style = (payload.get("style") or draft.get("script_style") or pdata.get("style") or "Conversational").strip()
    language = (payload.get("language") or draft.get("language") or pdata.get("language") or "en").strip().lower()
    extra = (payload.get("direction") or "").strip()  #"blue palette", "minimal", etc.

    prompt = _build_cover_prompt(title=title, style=style, language=language, description=description, extra=extra)

    try:
        b64 = _generate_cover_b64(prompt, size="1024x1024")
    except Exception as e:
        print("Cover generation error:", e)
        return jsonify(error=f"Failed to generate cover art: {str(e)}"), 500

    try:
        cover_url, storage_path, thumb_b64, persist_error = _persist_cover_to_storage_and_doc(
            podcast_id, b64, "image/png"
        )
    except Exception as e:
        print("Cover persist error:", e)
        return jsonify(error="Cover generated but failed to persist."), 500

    # Keep session draft for immediate preview/finalize UI state.
    _set_draft_for(podcast_id, {
        "coverArtBase64": b64,
        "coverArtMeta": {
            "generatedAt": datetime.utcnow().isoformat(),
            "source": "openai",
            "mimeType": "image/png",
            "storagePath": storage_path,
            "coverUrl": cover_url,
            "persistError": persist_error,
        },
        "title": title,  # keep title synced for step 7
    })
    if not pdata.get("readyEmailSent"):
        send_podcast_ready_email(user_id, title, podcast_id)
        db.collection("podcasts").document(podcast_id).set(
            {
                "readyEmailSent": True,
                "readyEmailSentAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    return jsonify(
        ok=True,
        podcastId=podcast_id,
        coverArtBase64=b64,
        coverUrl=cover_url,
        coverThumbB64=thumb_b64,
        warning=("Cover thumbnail saved; storage URL unavailable." if persist_error else ""),
    )

@app.post("/api/podcast/<podcast_id>/update")
def api_update_podcast(podcast_id):
    """Save edit draft or finalize podcast changes."""
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    data = request.get_json(silent=True) or {}
    print(f"Received update for podcast {podcast_id}")
    print(f"Data keys: {data.keys()}")
    
    # Get podcast document
    podcast_ref = db.collection("podcasts").document(podcast_id)
    podcast_doc = podcast_ref.get()
    
    if not podcast_doc.exists:
        return jsonify(error="Podcast not found"), 404

    podcast_data = podcast_doc.to_dict() or {}
    
    # Verify ownership
    if podcast_data.get("userId") != user_id:
        return jsonify(error="Forbidden"), 403

    mode = str(data.get("mode") or "final").strip().lower()
    allowed_modes = {"draft", "final", "discard_draft"}
    if mode not in allowed_modes:
        return jsonify(error="Invalid update mode"), 400

    podcast_ref = db.collection("podcasts").document(podcast_id)
    draft_ref = _edit_draft_ref(podcast_id)

    if mode == "discard_draft":
        draft_ref.delete()
        podcast_ref.set(
            {
                "hasEditDraft": False,
                "editDraftUpdatedAt": firestore.DELETE_FIELD,
            },
            merge=True,
        )
        return jsonify(ok=True, mode=mode, message="Draft discarded", podcastId=podcast_id)

    payload = {
        "showTitle": data.get("showTitle", podcast_data.get("title", "")),
        "script": data.get("script", ""),
        "speakers": data.get("speakers", []),
        "introMusic": data.get("introMusic", ""),
        "bodyMusic": data.get("bodyMusic", ""),
        "outroMusic": data.get("outroMusic", ""),
        "category": data.get("category", ""),
        "description": data.get("description", ""),
        "scriptStyle": data.get("scriptStyle", podcast_data.get("style", "")),
        "savedAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }

    if mode == "draft":
        draft_ref.set(payload, merge=True)
        podcast_ref.set(
            {
                "hasEditDraft": True,
                "editDraftUpdatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        return jsonify(
            ok=True,
            mode=mode,
            message="Draft saved successfully",
            podcastId=podcast_id,
            draft=_serialize_edit_draft(draft_ref.get()),
        )

    # Update main podcast document
    updates = {
        "title": payload["showTitle"],
        "lastEditedAt": firestore.SERVER_TIMESTAMP,
        "category": payload["category"],
        "introMusic": payload["introMusic"],
        "bodyMusic": payload["bodyMusic"],
        "outroMusic": payload["outroMusic"],
    }
    
    if payload["description"]:
        updates["description"] = payload["description"]
    
    podcast_ref.set(updates, merge=True)
    print(f"Updated main podcast document")

    # Get the script that the frontend sent (already has updated speaker names)
    script_to_save = payload["script"]
    print(f"DEBUG: Saving script with length: {len(script_to_save)}")
    print(f"DEBUG: Script preview: {script_to_save[:200]}")
    
    # Update script - the frontend has already updated the speaker names
    if script_to_save:
        script_ref = podcast_ref.collection("scripts").document("main")
        script_ref.set({
            "finalScriptText": script_to_save,
            "wordCount": len((script_to_save or "").split()),
            "lastEditedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)
        print(f"DEBUG: Script saved to Firestore")
    else:
        print(f"DEBUG: No script to save")

    # Update speakers - delete old ones and add new ones
    if payload["speakers"]:
        print(f"DEBUG: Saving {len(payload['speakers'])} speakers")
        
        # Delete existing speakers
        for speaker_doc in podcast_ref.collection("speakers").stream():
            speaker_doc.reference.delete()
        
        # Add new speakers
        for speaker in payload["speakers"]:
            podcast_ref.collection("speakers").document().set({
                "name": speaker.get("name", ""),
                "gender": speaker.get("gender", "Male"),
                "role": speaker.get("role", "host"),
                "providerVoiceId": speaker.get("voiceId", ""),
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })
        print(f"DEBUG: Speakers saved")

    draft_ref.delete()
    podcast_ref.set(
        {
            "hasEditDraft": False,
            "editDraftUpdatedAt": firestore.DELETE_FIELD,
        },
        merge=True,
    )

    return jsonify({
        "ok": True,
        "mode": mode,
        "message": "Podcast updated successfully",
        "podcastId": podcast_id,
        "updatedScript": script_to_save  # Return the updated script to frontend
    })

@app.post("/api/podcasts/<podcast_id>/cover/upload")
def api_cover_upload(podcast_id):
    user_id, err = _require_login_user()
    if err:
        return err

    _, err = _assert_podcast_owner(podcast_id, user_id)
    if err:
        return err

    if "file" not in request.files:
        return jsonify(error="Missing file"), 400

    f = request.files["file"]
    image_bytes = f.read()
    if not image_bytes:
        return jsonify(error="Empty file"), 400

    ok, info = _validate_image_bytes(image_bytes, min_size=512)
    if not ok:
        return jsonify(error=info), 400

    mimeType = "image/png" if info["format"] == "PNG" else "image/jpeg"

    # Encode for session storage + frontend display
    b64 = base64.b64encode(image_bytes).decode("utf-8")

    try:
        cover_url, storage_path, thumb_b64, persist_error = _persist_cover_to_storage_and_doc(
            podcast_id, b64, mimeType
        )
    except Exception as e:
        print("Cover persist error:", e)
        return jsonify(error="Cover uploaded but failed to persist."), 500

    _set_draft_for(podcast_id, {
        "coverArtBase64": b64,
        "coverArtMeta": {
            "uploadedAt": datetime.utcnow().isoformat(),
            "source": "upload",
            "width": info["width"],
            "height": info["height"],
            "format": info["format"],
            "mimeType": mimeType,
            "storagePath": storage_path,
            "coverUrl": cover_url,
            "persistError": persist_error,
        },
    })

    return jsonify(
        ok=True,
        podcastId=podcast_id,
        coverArtBase64=b64,
        coverUrl=cover_url,
        coverThumbB64=thumb_b64,
        mimeType=mimeType,
        meta=info,
        warning=("Cover thumbnail saved; storage URL unavailable." if persist_error else ""),
    )

@app.post("/api/podcasts/<podcast_id>/title")
def api_podcast_update_title(podcast_id):
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    ref = db.collection("podcasts").document(podcast_id)
    doc = ref.get()
    if not doc.exists:
        return jsonify(error="Podcast not found"), 404

    pdata = doc.to_dict() or {}
    if pdata.get("userId") != user_id:
        return jsonify(error="Forbidden"), 403

    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip()
    if not title:
        return jsonify(error="Title is required"), 400

    ref.set(
        {"title": title, "lastEditedAt": firestore.SERVER_TIMESTAMP},
        merge=True
    )

    # also keep session draft in sync if its the same podcast
    draft = session.get("create_draft") or {}
    if draft.get("podcastId") == podcast_id:
        draft["title"] = title
        draft["show_title"] = title
        session["create_draft"] = draft
        session.modified = True

    return jsonify(ok=True, podcastId=podcast_id, title=title)

@app.post("/api/podcasts/<podcast_id>/cover/clear")
def api_cover_clear(podcast_id):
    user_id, err = _require_login_user()
    if err:
        return err

    pdata, err = _assert_podcast_owner(podcast_id, user_id)
    if err:
        return err

    try:
        old_path = (pdata or {}).get("coverPath") or ""
        if old_path:
            delete_from_r2(old_path)
    except Exception as e:
        print("Cover delete warning:", e)

    db.collection("podcasts").document(podcast_id).set(
        {
            "coverUrl": "",
            "coverPath": "",
            "coverMimeType": "",
            "coverThumbB64": "",
            "coverUpdatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )

    _set_draft_for(podcast_id, {"coverArtBase64": None, "coverArtMeta": {}})
    return jsonify(ok=True)

@app.get("/api/me")
def api_me():
    """
    Return the logged-in user's basic profile from Firestore.
    Uses the session user_id set during /api/login or /api/social-login.
    Refreshes avatarUrl from R2 if avatarKey exists.
    """
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    try:
        user_ref = db.collection("users").document(user_id)
        doc = user_ref.get()

        if not doc.exists:
            return jsonify(error="User not found"), 404

        data = doc.to_dict() or {}
        avatar_url = data.get("avatarUrl", "")
        avatar_key = data.get("avatarKey", "")

        if avatar_key:
            try:
                avatar_url = build_r2_asset_url(avatar_key, expires_in=3600)
            except Exception as e:
                print(f"Avatar signed URL refresh failed: {e}")

        auth_provider = (
            data.get("authProvider")
            or ("password" if data.get("password_hash") else "unknown")
        )

        return jsonify(
            email=data.get("email", user_id),
            displayName=data.get("name", data.get("displayName", "WeCast User")),
            bio=data.get("bio", "I create AI-powered podcasts."),
            avatarUrl=avatar_url,
            authProvider=auth_provider,
            emailVerified=bool(data.get("emailVerified")),
            handle=data.get("handle", f"@{data.get('name', 'user').lower().replace(' ', '')}"),
            createdAt=data.get("created_at"),
        )
    except Exception as e:
        print(f"Error fetching user profile: {e}")
        return jsonify(error="Failed to fetch profile"), 500


@app.post("/api/profile/update")
def api_profile_update():
    """Update user profile information"""
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    user_ref = db.collection("users").document(user_id)
    existing_doc = user_ref.get()
    existing_data = existing_doc.to_dict() or {}
    old_avatar_key = (existing_data.get("avatarKey") or "").strip()

    # Handle form data with possible file upload
    if request.content_type and 'multipart/form-data' in request.content_type:
        display_name = request.form.get('displayName', '').strip()
        bio = request.form.get('bio', '').strip()
        
        # Handle avatar upload
        avatar_file = request.files.get('avatar')
        avatar_url = None
        
        if avatar_file and avatar_file.filename:
            # Validate file type
            if not avatar_file.content_type.startswith('image/'):
                return jsonify(error="Only image files are allowed"), 400
            
            # Read file bytes
            image_bytes = avatar_file.read()
            
            # Validate image size (max 5MB)
            if len(image_bytes) > 5 * 1024 * 1024:
                return jsonify(error="Image size should be less than 5MB"), 400
            
            try:
                signed_url, avatar_key = _persist_avatar_to_r2(
                    user_id=user_id,
                    image_bytes=image_bytes,
                    mime_type=avatar_file.content_type,
                )
                avatar_url = signed_url
            except Exception as e:
                print(f"Avatar upload error: {e}")
                return jsonify(error="Failed to upload avatar"), 500
    else:
        # JSON data (if no file upload)
        data = request.get_json(silent=True) or {}
        display_name = data.get('displayName', '').strip()
        bio = data.get('bio', '').strip()
        avatar_url = data.get('avatarUrl', '').strip()

    # Prepare update data
    update_data = {}
    
    if display_name:
        update_data['name'] = display_name
        update_data['displayName'] = display_name
        # Auto-generate handle from display name
        handle = f"@{display_name.lower().replace(' ', '')}"
        update_data['handle'] = handle
    
    if bio is not None:  # Allow empty bio
        update_data['bio'] = bio
    
    if avatar_url:
        update_data['avatarUrl'] = avatar_url
    if 'avatar_key' in locals():
        update_data['avatarKey'] = avatar_key
    
    update_data['updatedAt'] = firestore.SERVER_TIMESTAMP

    if not update_data:
        return jsonify(error="No data to update"), 400

    try:
        # Update Firestore
        user_ref.set(update_data, merge=True)
        if 'avatar_key' in locals() and old_avatar_key and old_avatar_key != avatar_key:
            delete_from_r2_quietly(old_avatar_key, label="Avatar replace")

        # Get updated user data
        updated_doc = user_ref.get()
        updated_data = updated_doc.to_dict() or {}
        response_avatar_url = avatar_url or updated_data.get('avatarUrl', '')
        refreshed_avatar_key = (updated_data.get('avatarKey') or "").strip()
        if refreshed_avatar_key and not response_avatar_url:
            try:
                response_avatar_url = build_r2_asset_url(refreshed_avatar_key, expires_in=3600)
            except Exception as exc:
                print(f"Avatar response URL refresh failed: {exc}")
        
        return jsonify({
            "ok": True,
            "message": "Profile updated successfully",
            "displayName": updated_data.get('name', updated_data.get('displayName', '')),
            "bio": updated_data.get('bio', ''),
            "avatarUrl": response_avatar_url,
            "email": updated_data.get('email', ''),
            "handle": updated_data.get('handle', '')
        })
        
    except Exception as e:
        print(f"Profile update error: {e}")
        return jsonify(error="Failed to update profile"), 500

@app.get("/api/profile/avatar")
def api_profile_avatar():
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    user_ref = db.collection("users").document(user_id)
    doc = user_ref.get()
    if not doc.exists:
        return jsonify(error="User not found"), 404

    data = doc.to_dict() or {}
    avatar_key = data.get("avatarKey") or ""

    if not avatar_key:
        return jsonify(avatarUrl="")

    try:
        signed_url = build_r2_asset_url(avatar_key, expires_in=3600)
        return jsonify(avatarUrl=signed_url)
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.delete("/api/account")
def api_delete_account():
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    def _purge_podcast_document(ref):
        snapshot = ref.get()
        if snapshot.exists:
            _delete_podcast_assets(snapshot.to_dict() or {})
        for sub_name in ("scripts", "speakers", "transcripts", "edits"):
            try:
                for sub_doc in ref.collection(sub_name).stream():
                    sub_doc.reference.delete()
            except Exception:
                pass
        ref.delete()

    try:
        deleted_podcast_ids = set()
        for candidate in user_id_candidates(user_id):
            try:
                for doc in db.collection("podcasts").where("userId", "==", candidate).stream():
                    if doc.id in deleted_podcast_ids:
                        continue
                    deleted_podcast_ids.add(doc.id)
                    _purge_podcast_document(doc.reference)
            except Exception as podcast_error:
                print(f"Podcast deletion error for {candidate}: {podcast_error}")

        deleted_user_docs = 0
        for candidate in user_id_candidates(user_id):
            try:
                user_ref = db.collection("users").document(candidate)
                user_doc = user_ref.get()
                if user_doc.exists:
                    avatar_key = ((user_doc.to_dict() or {}).get("avatarKey") or "").strip()
                    if avatar_key:
                        delete_from_r2_quietly(avatar_key, label="Avatar delete")
                    user_ref.delete()
                    deleted_user_docs += 1
            except Exception as user_error:
                print(f"User deletion error for {candidate}: {user_error}")

        session.clear()
        session.modified = True

        return jsonify(
            ok=True,
            deletedAccount=user_id,
            deletedUserDocs=deleted_user_docs,
            deletedPodcasts=len(deleted_podcast_ids),
        )
    except Exception as e:
        print(f"Account deletion error: {e}")
        return jsonify(error="Failed to delete account"), 500


@app.post("/api/account/password-reset-link")
def api_account_password_reset_link():
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    try:
        doc = get_user_doc_by_candidates(user_id)
        if not doc or not doc.exists:
            return jsonify(error="User not found"), 404

        data = doc.to_dict() or {}
        email = (data.get("email") or user_id or "").strip().lower()
        if not email or not is_reasonably_valid_email(email):
            return jsonify(error="A valid account email is required before sending a reset link."), 400

        result = prepare_password_reset_delivery(email, strict=True)
        if result.get("status") == "provider_managed":
            return jsonify(
                error="Password changes are managed by your sign-in provider.",
                authProvider=result.get("authProvider", "unknown"),
            ), 409
        if result.get("status") == "unavailable":
            return jsonify(
                error="Password reset is unavailable for this account right now.",
                authProvider=result.get("authProvider", "unknown"),
            ), 409
        if result.get("status") != "sent":
            return jsonify(error="Failed to prepare a password reset link."), 500

        return jsonify(ok=True, **result)
    except Exception as e:
        print(f"Password reset preparation error: {e}")
        return jsonify(error="Failed to prepare a password reset link."), 500


@app.post("/api/password-reset-email")
def api_password_reset_email():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()

    if not is_reasonably_valid_email(email):
        return jsonify(error="Please enter a valid email address."), 400

    try:
        result = prepare_password_reset_delivery(email, strict=False)
        if result.get("status") in {"sent", "hidden"}:
            return jsonify(ok=True, **result)
        return jsonify(error="We couldn't send the password reset email right now."), 500
    except Exception as e:
        print(f"Password reset email request error: {e}")
        return jsonify(error="We couldn't process the password reset email."), 500
@app.get("/api/podcast/<podcast_id>")
def api_get_podcast(podcast_id):
    """Fetch full podcast data for editing"""
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    # Get podcast document
    podcast_ref = db.collection("podcasts").document(podcast_id)
    podcast_doc = podcast_ref.get()
    
    if not podcast_doc.exists:
        return jsonify(error="Podcast not found"), 404

    podcast_data = podcast_doc.to_dict() or {}
    
    # Verify ownership
    if podcast_data.get("userId") != user_id:
        return jsonify(error="Forbidden"), 403

    # Get speakers from subcollection
    speakers = []
    speakers_query = podcast_ref.collection("speakers").stream()
    for speaker_doc in speakers_query:
        speaker_data = speaker_doc.to_dict() or {}
        speakers.append({
            "name": speaker_data.get("name", ""),
            "gender": speaker_data.get("gender", "Male"),
            "role": speaker_data.get("role", "host"),
            "voiceId": speaker_data.get("providerVoiceId", ""),
        })

    # Get script from subcollection
    script_doc = podcast_ref.collection("scripts").document("main").get()
    script = ""
    script_template = ""
    if script_doc.exists:
        script_data = script_doc.to_dict() or {}
        script = script_data.get("finalScriptText", "")
        script_template = script_data.get("sourceText", "")

    edit_draft = _serialize_edit_draft(_edit_draft_ref(podcast_id).get())

    resolved_podcast_data = resolve_podcast_media_urls(
        podcast_data,
        include_audio=True,
        include_cover=True,
    )

    # Return all data the edit page needs
    return jsonify({
        "id": podcast_id,
        "script": script,
        "scriptTemplate": script_template,
        "showTitle": podcast_data.get("title", ""),
        "title": podcast_data.get("title", ""),
        "episodeTitle": podcast_data.get("title", ""),
        "scriptStyle": podcast_data.get("style", ""),
        "speakersCount": len(speakers),
        "speakers": speakers,
        "description": podcast_data.get("description", ""),
        "introMusic": podcast_data.get("introMusic", ""),
        "bodyMusic": podcast_data.get("bodyMusic", ""),
        "outroMusic": podcast_data.get("outroMusic", ""),
        "category": podcast_data.get("category", ""),
        "language": podcast_data.get("language", "en"),
        "audioUrl": resolved_podcast_data.get("audioUrl", podcast_data.get("audioUrl", "")),
        "audioKey": podcast_data.get("audioKey", ""),
        "coverUrl": resolved_podcast_data.get("coverUrl", podcast_data.get("coverUrl", "")),
        "editDraft": edit_draft,
    })
    
@app.post("/api/generate")
def api_generate():
    data = request.get_json(force=True)
    script_style = (data.get("script_style") or "").strip()
    speakers = int(data.get("speakers") or 0)
    speakers_info = data.get("speakers_info") or []
    description = (data.get("description") or "").strip()
    ui_language = (data.get("language") or "").strip().lower()

    ok, msg = validate_roles(script_style, speakers_info)
    if not ok:
        return jsonify(ok=False, error=msg), 400
    if not script_style:
        return jsonify(ok=False, error="Please choose a podcast style."), 400
    if speakers not in (1, 2, 3):
        return jsonify(ok=False, error="Invalid speakers count."), 400
    if len(description.split()) < 500:
        return jsonify(ok=False, error="Your text must be at least 500 words."), 400

    try:
        script = generate_podcast_script(description, speakers_info, script_style, language=ui_language)
    except Exception as e:
        print("api_generate script error:", e)
        return jsonify(ok=False, error=f"Script generation failed: {str(e)}"), 500

    try:
        title = generate_title_from_script(script, script_style)
    except Exception as e:
        print("api_generate title error:", e)
        title = "Podcast Show"

    script_template = script  
    show_title = title or "Podcast Show"
    # figure out user (prefer session)
    user_id = session.get("user_id")
    if not user_id:
        # fallback to JWT header if you want
        user_id = get_current_user_email()

    is_guest_session = not bool(user_id)

    if user_id:
        podcast_id = save_generated_podcast_to_firestore(
            user_id=user_id,
            title=title,
            script_style=script_style,
            description=description,
            script=script_template,
            speakers_info=speakers_info,
            language=ui_language,
        )
    else:
        # Try WeCast guest flow: keep the draft in-session and defer persistence
        # until the user signs up or explicitly saves later.
        podcast_id = db.collection("podcasts").document().id


    session["create_draft"] = {
        "podcastId": podcast_id,
        "script_style": script_style,
        "speakers_count": speakers,
        "speakers_info": speakers_info,
        "description": description,
        "script": script_template,
        "show_title": show_title,
        "title": title,
        "language": ui_language,
        "guestMode": is_guest_session,
    }


    return jsonify(ok=True, script=script_template, title=title, show_title=show_title, podcastId=podcast_id)




@app.get("/api/episodes")
def api_episodes_list():
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    def _clean_for_brief(text: str):
        if not text:
            return ""
        lines = []
        for raw_line in str(text).replace("\r", "\n").split("\n"):
            line = raw_line.strip()
            if not line:
                continue
            # Ignore section headers and stage directions.
            if is_section_header(line):
                continue
            if re.match(r"^[\[\(].*[\]\)]$", line):
                if is_music_tag(line):
                    continue
                continue

            m = re.match(r"^[^:]{1,40}:\s+(.+)$", line)
            if m:
                line = m.group(1).strip()
            lines.append(line)

        return " ".join(lines)

    def _short_brief(text: str, limit: int = 220):
        raw = " ".join((_clean_for_brief(text) or "").split())
        if not raw:
            return ""
        if len(raw) <= limit:
            return raw

        cutoff = raw[:limit]
        punct_idx = max(cutoff.rfind("."), cutoff.rfind("!"), cutoff.rfind("?"))
        if punct_idx >= 80:
            return cutoff[: punct_idx + 1].rstrip()
        return cutoff.rstrip() + "..."

    def _has_arabic(text: str):
        return bool(re.search(r"[\u0600-\u06FF]", text or ""))

    def _choose_best_brief(candidates, prefer_arabic: bool):
        usable = [c for c in candidates if (c or "").strip()]
        if not usable:
            return ""
        if not prefer_arabic:
            return usable[0]
        for candidate in usable:
            if _has_arabic(candidate):
                return candidate
        return usable[0]

    def _coerce_datetime(value):
        if isinstance(value, datetime):
            return value
        to_datetime = getattr(value, "to_datetime", None)
        if callable(to_datetime):
            try:
                return to_datetime()
            except Exception:
                return None
        return None

    def _purge_episode_document(ref):
        snapshot = ref.get()
        if snapshot.exists:
            _delete_podcast_assets(snapshot.to_dict() or {})
        for sub_name in ("scripts", "speakers", "transcripts"):
            try:
                for sub_doc in ref.collection(sub_name).stream():
                    sub_doc.reference.delete()
            except Exception:
                pass
        ref.delete()

    query = db.collection("podcasts").where("userId", "==", user_id)
    now_utc = datetime.now(timezone.utc)
    recycle_cutoff = now_utc - timedelta(days=RECYCLE_BIN_RETENTION_DAYS)
    items = []
    recycle_items = []
    for doc in query.stream():
        data = doc.to_dict() or {}
        deleted_at = _coerce_datetime(data.get("deletedAt"))
        if deleted_at and deleted_at.tzinfo is None:
            deleted_at = deleted_at.replace(tzinfo=timezone.utc)
        if deleted_at and deleted_at <= recycle_cutoff:
            _purge_episode_document(doc.reference)
            continue

        # Show only finalized/saved episodes.
        # Legacy compatibility: older saved episodes may still carry status="draft"
        # from historical flows, so we treat rich, finalized-looking records as saved.
        status = str(data.get("status") or "").strip().lower()
        if status == "deleted" and deleted_at:
            is_saved = True
            legacy_saved = False
        else:
            is_saved = status == "saved" or bool(data.get("savedAt"))
            legacy_saved = (
                status == "draft"
                and bool(data.get("audioUrl") or data.get("audioKey"))
                and bool(data.get("summary"))
                and isinstance(data.get("chapters"), list)
                and len(data.get("chapters")) > 0
            )
        if not (is_saved or legacy_saved):
            continue

        title = data.get("title") or ""
        prefer_arabic_brief = _has_arabic(title) or (data.get("language") == "ar")
        # Keep brief episode-specific first, and prefer Arabic text for Arabic episodes.
        brief = _choose_best_brief(
            [
                data.get("summary") or "",
                data.get("transcriptText") or "",
                data.get("description") or "",
            ],
            prefer_arabic=prefer_arabic_brief,
        )
        payload = {
            "id": doc.id,
            "title": title or "Untitled Episode",
            "brief": _short_brief(brief),
            "audioUrl": data.get("audioUrl") or "",
            "audioKey": data.get("audioKey") or "",
            "style": data.get("style") or "",
            "scriptStyle": data.get("style") or "",
            "coverUrl": data.get("coverThumbB64") and "" or (data.get("coverUrl") or ""),
            "coverThumbB64": data.get("coverThumbB64") or "",
            "createdAt": data.get("createdAt"),
        }
        payload["hasEditDraft"] = bool(data.get("hasEditDraft"))
        payload["editDraftUpdatedAt"] = data.get("editDraftUpdatedAt") or ""

        if deleted_at:
            payload["deletedAt"] = deleted_at.isoformat()
            payload["deleteAfter"] = (
                deleted_at + timedelta(days=RECYCLE_BIN_RETENTION_DAYS)
            ).isoformat()
            recycle_items.append(payload)
        else:
            items.append(payload)

    return jsonify(
        items=items,
        recycleBin=recycle_items,
        retentionDays=RECYCLE_BIN_RETENTION_DAYS,
    )


@app.post("/api/episodes/<episode_id>/trash")
def api_trash_episode(episode_id):
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    ref = db.collection("podcasts").document(episode_id)
    doc = ref.get()
    if not doc.exists:
        return jsonify(error="Episode not found"), 404

    data = doc.to_dict() or {}
    if data.get("userId") != user_id:
        return jsonify(error="Forbidden"), 403

    current_status = str(data.get("status") or "").strip() or "saved"
    deleted_at = datetime.now(timezone.utc)
    ref.set(
        {
            "status": "deleted",
            "deletedAt": deleted_at,
            "deletedBy": user_id,
            "deletedFromStatus": current_status,
        },
        merge=True,
    )

    return jsonify(ok=True, trashedId=episode_id, deletedAt=deleted_at.isoformat())


@app.post("/api/episodes/<episode_id>/restore")
def api_restore_episode(episode_id):
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    ref = db.collection("podcasts").document(episode_id)
    doc = ref.get()
    if not doc.exists:
        return jsonify(error="Episode not found"), 404

    data = doc.to_dict() or {}
    if data.get("userId") != user_id:
        return jsonify(error="Forbidden"), 403

    fallback_status = "saved" if data.get("savedAt") else "draft"
    restored_status = str(data.get("deletedFromStatus") or "").strip() or fallback_status
    if restored_status == "deleted":
        restored_status = fallback_status

    ref.update(
        {
            "status": restored_status,
            "deletedAt": firestore.DELETE_FIELD,
            "deletedBy": firestore.DELETE_FIELD,
            "deletedFromStatus": firestore.DELETE_FIELD,
        }
    )

    return jsonify(ok=True, restoredId=episode_id)


@app.post("/api/episodes/<episode_id>/delete")
def api_delete_episode(episode_id):
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    ref = db.collection("podcasts").document(episode_id)
    doc = ref.get()
    if not doc.exists:
        return jsonify(error="Episode not found"), 404

    data = doc.to_dict() or {}
    if data.get("userId") != user_id:
        return jsonify(error="Forbidden"), 403

    _delete_podcast_assets(data)

    for sub_name in ("scripts", "speakers", "transcripts"):
        try:
            for sub_doc in ref.collection(sub_name).stream():
                sub_doc.reference.delete()
        except Exception:
            pass

    ref.delete()

    return jsonify(ok=True, deletedId=episode_id)






def clean_script_for_tts(script: str) -> str:
    """
    Create a clean text version for TTS:
    - Remove speaker labels
    - Remove formatting leftovers (ga:, fe:, -, bullet points, unicode spaces)
    - Remove tags and markdown
    - Keep only natural spoken text
    """
    cleaned_lines = []

    for raw in script.splitlines():
        line = raw.strip()
        if not line:
            continue

        if line.startswith("#"):
            continue

        if is_section_header(line):
            continue

        if re.match(r"^([^:ï¼ڑ]+)[:ï¼ڑ]\s*(intro|body|outro|مقدمة|النص|الخاتمة)\s*$", line, re.IGNORECASE):
            continue

        if re.fullmatch(r"\[[^\]]+\]", line):
            if not is_music_tag(line):
                continue

        line = re.sub(r"\[[^\]]*]", "", line)

        line = re.sub(r"[\u200B-\u200D\uFEFF]", "", line)

        if re.fullmatch(r"[-_=*~â€¢آ·\u2022]{2,}", line):
            continue

        line = re.sub(r"^[A-Za-z0-9]{1,10}\s*[:ï¼ڑ]\s*", "", line)

        line = re.sub(r"^[^\w]+", "", line)
        line = re.sub(r"\s{2,}", " ", line).strip()

        if line:
            cleaned_lines.append(line)

    return "\n".join(cleaned_lines)

def build_speaker_voice_map():
    """
    Build a mapping: speaker_name -> voiceId
    plus a default voice (host voice if available).
    """
    draft = session.get("create_draft") or {}
    speakers_info = draft.get("speakers_info") or []

    mapping = {}
    host_voice = None
    any_voice = None

    for s in speakers_info:
        name = (s.get("name") or "").strip()
        vid = (s.get("voiceId") or "").strip()
        if not name or not vid:
            continue

        mapping[name] = vid
        if not any_voice:
            any_voice = vid
        if s.get("role") == "host" and not host_voice:
            host_voice = vid

    default_voice = host_voice or any_voice or "21m00Tcm4TlvDq8ikWAM"
    return mapping, default_voice

def parse_script_into_segments(script: str):
    """
    Turn the script into segments: [(speaker_name, text), ...]
    - ignore markdown headings (#..)
    - ignore INTRO/BODY/OUTRO headers
    - ignore separator lines (----)
    - lines without label keep the previous speaker
    - Literal parser: KEEP speaker labels exactly as written.
    - Only treat '[music]' as a special segment.
    """
    segments = []
    last_speaker = None
    for raw in script.splitlines():
        stripped = raw.strip()
        if not stripped:
            continue

        if is_music_tag(stripped):
            segments.append(("__music__", None))
            continue

        if ":" in stripped:
            speaker, text = stripped.split(":", 1)
            speaker = speaker.strip()
            text = text.strip()

            if text:
                segments.append((speaker, text))
                last_speaker = speaker
            continue

        if last_speaker:
            segments.append((last_speaker, stripped))

    return segments

def synthesize_audio_from_script(script: str, podcast_id: str = ""):
    music_index = 0
    script = (script or "").strip()
    if not script:
        return False, "Script is empty."

    segments = parse_script_into_segments(script)
    if not segments:
        return False, "Nothing to read after cleaning script."

    speaker_to_voice, default_voice = build_speaker_voice_map()

    audio_parts = []
    word_timeline = []
    timeline_offset = 0.0  # seconds

    for speaker, text in segments:

        # ----------------------
        # MUSIC SEGMENT
        # ----------------------
        if speaker.strip().lower() == "__music__":
            intro = session.get("introMusic", "")
            body = session.get("bodyMusic", "")
            outro = session.get("outroMusic", "")

            if music_index == 0:
                selected_music = intro
            elif music_index in (1, 2):
                selected_music = body
            else:
                selected_music = outro

            music_index += 1

            if selected_music:
                music_path = os.path.join("static", "music", selected_music)
                if os.path.exists(music_path):
                    music_clip = AudioSegment.from_mp3(music_path)
                    audio_parts.append(music_clip)

                    # advance offset
                    timeline_offset += (len(music_clip) / 1000.0)

            continue

        # ----------------------
        # SPEECH SEGMENT
        # ----------------------
        if is_arabic(text):
            tts_text = text.strip()
        else:
            tts_text = clean_script_for_tts(text)

        if not tts_text.strip():
            continue

        voice_id = speaker_to_voice.get(speaker, default_voice)

        try:
            audio_bytes, segment_words = eleven_tts_with_timestamps(
                text=tts_text,
                voice_id=voice_id,
                model_id="eleven_multilingual_v2",
            )
        except Exception as e:
            return False, str(e)

        speech_segment = AudioSegment.from_file(BytesIO(audio_bytes), format="mp3")
        audio_parts.append(speech_segment)

        # shift segment words to global timeline
        for w in segment_words:
            word_timeline.append({
                "w": w["w"],
                "start": w["start"] + timeline_offset,
                "end": w["end"] + timeline_offset,
                "speaker": speaker,
            })

        # advance offset by this speech duration
        timeline_offset += (len(speech_segment) / 1000.0)

    if not audio_parts:
        return False, "No audio data generated."

    final_audio = AudioSegment.silent(duration=500)
    timeline_offset_final = 0.5  # because we added 500ms silence

    for w in word_timeline:
        w["start"] += timeline_offset_final
        w["end"] += timeline_offset_final

    for item in audio_parts:
        final_audio += item

    safe_id = re.sub(r"[^A-Za-z0-9_-]", "", podcast_id or "")
    if not safe_id:
        safe_id = "output"

    local_filename = f"output_{safe_id}.mp3"
    buffer = BytesIO()
    final_audio.export(buffer, format="mp3")
    mp3_bytes = buffer.getvalue()

    # Upload to R2
    object_key = f"episodes/{safe_id}/{local_filename}"
    upload_bytes_to_r2(mp3_bytes, object_key, "audio/mpeg")
    signed_url = build_r2_asset_url(object_key, expires_in=3600)

    return True, {
        "url": signed_url,
        "audioKey": object_key,
        "words": word_timeline,
    }

@app.post("/api/audio")
def api_audio():
    
    payload = request.get_json(silent=True) or {}
    script = (payload.get("scriptText") or request.form.get("scriptText") or "").strip()
    podcast_id = (payload.get("podcastId") or "").strip()
    ui_language = (payload.get("language") or "").strip().lower()

    print("DEBUG /api/audio script length:", len(script))
    print("DEBUG /api/audio first 200 chars:", script[:200])
    print("DEBUG /api/audio podcastId:", podcast_id)
    incoming_speakers_info = payload.get("speakers_info")
    if isinstance(incoming_speakers_info, list) and incoming_speakers_info:
        draft = session.get("create_draft") or {}
        draft["speakers_info"] = incoming_speakers_info
        session["create_draft"] = draft
        session.modified = True

    if not podcast_id:
        return jsonify(error="Missing podcastId"), 400

    ok, result = synthesize_audio_from_script(script, podcast_id)
    if not ok:
        return jsonify(error=result), 400

    # keep audio in session 
    session["last_audio_url"] = result["url"]
    session["last_audio_key"] = result.get("audioKey", "")
    session.modified = True

    # NEW: save live transcript (word timeline) to Firestore
    user_id = session.get("user_id") or get_current_user_email()
    if user_id and podcast_id:
        podcast_ref = db.collection("podcasts").document(podcast_id)
        doc = podcast_ref.get()

        if doc.exists:
            pdata = doc.to_dict() or {}
            if pdata.get("userId") == user_id:
                words = result.get("words") or []
                transcript_text = build_transcript_text_with_speakers(words)
                old_audio_key = (pdata.get("audioKey") or "").strip()
                new_audio_key = (result.get("audioKey") or "").strip()

                if ui_language in ("en", "ar"):
                    podcast_ref.set({
                        "language": ui_language,
                    }, merge=True)

                # Save transcript text in main podcast doc (small)
                podcast_ref.set({
                    "transcriptText": transcript_text,
                    "transcriptUpdatedAt": firestore.SERVER_TIMESTAMP,
                    "audioUrl": result["url"],
                    "audioKey": new_audio_key,
                    "audioUpdatedAt": firestore.SERVER_TIMESTAMP,
                }, merge=True)

                if old_audio_key and new_audio_key and old_audio_key != new_audio_key:
                    delete_from_r2_quietly(old_audio_key, label="Audio replace")

                # Save full word timeline in a subcollection doc
                podcast_ref.collection("transcripts").document("main").set({
                    "words": words,
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                }, merge=True)
                
                # Generate & save chapters
                language = ui_language or pdata.get("language") or "en"
                chapters = build_chapters(words, transcript_text, language=language)

                podcast_ref.set({
                    "chapters": chapters,
                    "chaptersUpdatedAt": firestore.SERVER_TIMESTAMP,
                }, merge=True)
            else:
                print("WARN: user does not own this podcast. Not saving transcript.")
        else:
            print("WARN: podcastId not found. Not saving transcript.")

    return jsonify(
        url=result["url"],
        audioKey=result.get("audioKey", ""),
        words=result["words"]
    )

@app.get("/api/audio/<podcast_id>")
def get_audio(podcast_id):
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    ref = db.collection("podcasts").document(podcast_id)
    doc = ref.get()

    if not doc.exists:
        return jsonify(error="Podcast not found"), 404

    data = doc.to_dict() or {}
    if data.get("userId") != user_id:
        return jsonify(error="Forbidden"), 403

    audio_key = data.get("audioKey")
    if not audio_key:
        return jsonify(error="Audio not found"), 404

    try:
        signed_url = build_r2_asset_url(audio_key, expires_in=3600)
        return jsonify(url=signed_url)
    except Exception as e:
        return jsonify(error=str(e)), 500
    
@app.get("/api/transcript/last")
def api_transcript_last():
    words = session.get("last_word_timeline") or None
    return jsonify(words=words)

@app.post('/api/summarize')
def summarize_transcript():
    """
        Generate an AI summary of the podcast transcript using OpenAI.

        Expects JSON:
        {
        "podcastId": "podcast document ID",
        "text": "full transcript text"
        }

        Returns:
        {
        "summary": "generated summary text"
        }

        Side effect:
        - Saves the summary to Firestore under podcasts/{podcastId}.summary
    """

    try:
        data = request.get_json(silent=True) or {}
        text = data.get('text', '')
        podcast_id = (data.get('podcastId') or "").strip()
        ui_language = (data.get("language") or "").strip().lower()

        if not text:
            return jsonify({"error": "No text provided"}), 400
        if not podcast_id:
            return jsonify({"error": "Missing podcastId"}), 400

        user_id = session.get("user_id") or get_current_user_email()
        if not user_id:
            return jsonify({"error": "Not logged in"}), 401

        text = text[:12000]
        if ui_language in ("ar", "en"):
            is_ar = ui_language == "ar"
        else:
            is_ar = is_arabic(text)

        if is_ar:
            system_prompt = "أنت مساعد محترف يقوم بإنشاء ملخصات بودكاست موجزة. يجب أن تكون جميع الردود بحد أقصى 150 كلمة."
            user_prompt = f"يرجى تلخيص نص البودكاست التالي بحد أقصى 150 كلمة. ركز على النقاط الرئيسية والأفكار المهمة:\n\n{text}"
        else:
            system_prompt = "You are a helpful assistant that creates concise podcast summaries. Always respond with 150 words or less."
            user_prompt = f"Please summarize this podcast transcript in 150 words or less. Focus on the main points, key insights, and important discussions:\n\n{text}"

        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            max_tokens=350,
            temperature=0.7
        )

        summary = (response.choices[0].message.content or "").strip()

        # enforce <= 250 words
        words = summary.split()
        if len(words) > 250:
            summary = " ".join(words[:250]) + "..."

        # Save into Firestore (and ensure ownership)
        podcast_ref = db.collection("podcasts").document(podcast_id)
        doc = podcast_ref.get()
        if not doc.exists:
            return jsonify({"error": "Podcast not found"}), 404

        pdata = doc.to_dict() or {}
        if pdata.get("userId") != user_id:
            return jsonify({"error": "Forbidden"}), 403

        podcast_ref.set({
            "summary": summary,
            "summaryUpdatedAt": firestore.SERVER_TIMESTAMP,
            "summaryLanguage": "ar" if is_ar else "en",
        }, merge=True)

        return jsonify({"summary": summary})

    except Exception as e:
        print(f"Summary generation error: {str(e)}")
        return jsonify({"error": "Failed to generate summary"}), 500


@app.get("/api/podcasts/<podcast_id>")
def get_podcast(podcast_id):
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    ref = db.collection("podcasts").document(podcast_id)
    doc = ref.get()
    if not doc.exists:
        return jsonify(error="Podcast not found"), 404

    data = doc.to_dict() or {}
    if data.get("userId") != user_id:
        return jsonify(error="Forbidden"), 403

    podcast_payload = resolve_podcast_media_urls(data, include_audio=True, include_cover=True)
    return jsonify(ok=True, podcast={**podcast_payload, "id": podcast_id})


@app.get("/api/podcasts/<podcast_id>/transcript")
def get_podcast_transcript(podcast_id):
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    ref = db.collection("podcasts").document(podcast_id)
    doc = ref.get()
    if not doc.exists:
        return jsonify(error="Podcast not found"), 404

    data = doc.to_dict() or {}
    if data.get("userId") != user_id:
        return jsonify(error="Forbidden"), 403

    tdoc = ref.collection("transcripts").document("main").get()
    if not tdoc.exists:
        return jsonify(words=[])

    tdata = tdoc.to_dict() or {}
    return jsonify(words=tdata.get("words") or [])


@app.post("/api/podcasts/<podcast_id>/chapters/ensure")
def ensure_podcast_chapters(podcast_id):
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    ref = db.collection("podcasts").document(podcast_id)
    doc = ref.get()
    if not doc.exists:
        return jsonify(error="Podcast not found"), 404

    data = doc.to_dict() or {}
    if data.get("userId") != user_id:
        return jsonify(error="Forbidden"), 403

    existing_chapters = data.get("chapters") or []
    if isinstance(existing_chapters, list) and len(existing_chapters) > 0:
        return jsonify(chapters=existing_chapters, rebuilt=False)

    tdoc = ref.collection("transcripts").document("main").get()
    tdata = tdoc.to_dict() or {}
    words = tdata.get("words") or []

    if not isinstance(words, list) or not words:
        return jsonify(chapters=[], rebuilt=False)

    transcript_text = (data.get("transcriptText") or "").strip()
    if not transcript_text:
        try:
            transcript_text = build_transcript_text_with_speakers(words)
        except Exception:
            transcript_text = ""

    language = (data.get("language") or "en").strip().lower()
    if language not in ("en", "ar"):
        language = "ar" if is_arabic(transcript_text) else "en"

    chapters = build_chapters(words, transcript_text, language=language)
    if not isinstance(chapters, list):
        chapters = []

    if chapters:
        ref.set(
            {
                "chapters": chapters,
                "chaptersUpdatedAt": firestore.SERVER_TIMESTAMP,
                "transcriptText": transcript_text or data.get("transcriptText") or "",
            },
            merge=True,
        )

    return jsonify(chapters=chapters, rebuilt=bool(chapters))


@app.post("/api/podcasts/<podcast_id>/save-all")
def save_all_podcast(podcast_id):
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    ref = db.collection("podcasts").document(podcast_id)
    doc = ref.get()
    if not doc.exists:
        return jsonify(error="Podcast not found"), 404

    data = doc.to_dict() or {}
    if data.get("userId") != user_id:
        return jsonify(error="Forbidden"), 403

    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip()
    audio_url = (payload.get("audioUrl") or payload.get("audio_url") or "").strip()
    audio_key = (payload.get("audioKey") or payload.get("audio_key") or "").strip()
    if not audio_key:
        audio_key = (session.get("last_audio_key") or "").strip()
    summary = payload.get("summary")
    chapters = payload.get("chapters")
    words = payload.get("words")
    transcript_text = payload.get("transcriptText")

    updates = {}
    if title:
        updates["title"] = title
    if audio_url:
        updates["audioUrl"] = audio_url
        updates["audioUpdatedAt"] = firestore.SERVER_TIMESTAMP
    if audio_key:
        updates["audioKey"] = audio_key
        if not audio_url:
            updates["audioUpdatedAt"] = firestore.SERVER_TIMESTAMP
    if summary is not None:
        updates["summary"] = summary
        updates["summaryUpdatedAt"] = firestore.SERVER_TIMESTAMP
    if isinstance(chapters, list):
        updates["chapters"] = chapters
        updates["chaptersUpdatedAt"] = firestore.SERVER_TIMESTAMP

    if words and not transcript_text:
        try:
            transcript_text = build_transcript_text_with_speakers(words)
        except Exception:
            transcript_text = None

    if transcript_text:
        updates["transcriptText"] = transcript_text
        updates["transcriptUpdatedAt"] = firestore.SERVER_TIMESTAMP

    updates["status"] = "saved"
    updates["savedAt"] = firestore.SERVER_TIMESTAMP

    if updates:
        ref.set(updates, merge=True)

    if isinstance(words, list) and words:
        ref.collection("transcripts").document("main").set({
            "words": words,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)

    return jsonify(ok=True)


@app.post("/api/preview/save")
def save_preview_snapshot():
    user_id = session.get("user_id") or get_current_user_email()
    if not user_id:
        return jsonify(error="Not logged in"), 401

    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip() or "Untitled Episode"
    audio_url = _normalize_public_url((payload.get("audioUrl") or payload.get("audio_url") or session.get("last_audio_url") or "").strip())
    audio_key = (payload.get("audioKey") or payload.get("audio_key") or session.get("last_audio_key") or "").strip()
    summary = payload.get("summary")
    chapters = payload.get("chapters")
    words = payload.get("words")
    language = (payload.get("language") or "").strip().lower()
    transcript_text = payload.get("transcriptText")
    description = (payload.get("description") or "").strip()
    style = (payload.get("style") or "").strip()
    speakers_info = payload.get("speakers") if isinstance(payload.get("speakers"), list) else None

    draft = session.get("create_draft") or {}
    if not description:
        description = (draft.get("description") or "").strip()
    if not style:
        style = (draft.get("script_style") or "").strip()
    if speakers_info is None:
        draft_speakers = draft.get("speakers_info")
        speakers_info = draft_speakers if isinstance(draft_speakers, list) else []

    if not isinstance(words, list) or not words:
        words = session.get("last_word_timeline") or []

    if words and not transcript_text:
        try:
            transcript_text = build_transcript_text_with_speakers(words)
        except Exception:
            transcript_text = None

    script_text = (payload.get("script") or draft.get("script") or transcript_text or "").strip()

    podcast_id = save_generated_podcast_to_firestore(
        user_id=user_id,
        title=title,
        script_style=style,
        description=description,
        script=script_text,
        speakers_info=speakers_info or [],
        language=language,
    )

    ref = db.collection("podcasts").document(podcast_id)
    updates = {
        "status": "saved",
        "savedAt": firestore.SERVER_TIMESTAMP,
    }

    if audio_url:
        updates["audioUrl"] = audio_url
        updates["audioUpdatedAt"] = firestore.SERVER_TIMESTAMP
    if audio_key:
        updates["audioKey"] = audio_key
        if not audio_url:
            updates["audioUpdatedAt"] = firestore.SERVER_TIMESTAMP
    if summary is not None:
        updates["summary"] = summary
        updates["summaryUpdatedAt"] = firestore.SERVER_TIMESTAMP
    if isinstance(chapters, list):
        updates["chapters"] = chapters
        updates["chaptersUpdatedAt"] = firestore.SERVER_TIMESTAMP
    if transcript_text:
        updates["transcriptText"] = transcript_text
        updates["transcriptUpdatedAt"] = firestore.SERVER_TIMESTAMP

    ref.set(updates, merge=True)

    if isinstance(words, list) and words:
        ref.collection("transcripts").document("main").set(
            {
                "words": words,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    return jsonify(ok=True, podcastId=podcast_id)

@app.post("/api/save-music")
def save_music():
    data = request.get_json() or {}
    session["introMusic"] = data.get("introMusic", "")
    session["bodyMusic"] = data.get("bodyMusic", "")
    session["outroMusic"] = data.get("outroMusic", "")

    return jsonify(ok=True)

# ------------------------------------------------------------
# ------------------------------------------------------------

@app.route("/", methods=["GET"])
def index():
    return redirect("http://localhost:5173/", code=302)

@app.get("/api/audio/last")
def api_audio_last():
    """
    Return the last generated audio URL for this session, if any.
    Used so the audio does not 'disappear' after refresh or navigation.
    """
    url = session.get("last_audio_url")
    key = session.get("last_audio_key")
    if key:
        try:
            url = build_r2_asset_url(key, expires_in=3600)
            session["last_audio_url"] = url
            session.modified = True
        except Exception as exc:
            print(f"Last audio URL refresh failed: {exc}")
    return jsonify(url=url or None, audioKey=key or None)

@app.route("/api/signup", methods=["POST"])
def signup():
    data = request.get_json() or {}

    id_token = (data.get("idToken") or "").strip()
    if id_token:
        from firebase_admin import auth as fb_auth

        try:
            decoded = fb_auth.verify_id_token(id_token)
        except Exception as e:
            print("Firebase signup sync error:", e)
            return jsonify(
                {
                    "error": (
                        "We couldn't verify the Firebase session. Make sure the backend "
                        "Firebase service account matches the frontend Firebase project."
                    )
                }
            ), 401

        email = (decoded.get("email") or "").strip().lower()
        display_name = (data.get("name") or decoded.get("name") or "").strip()

        if not email:
            return jsonify({"error": "Unable to read email from Firebase token"}), 400

        try:
            final_data = _upsert_firebase_user_profile(
                email=email,
                display_name=display_name,
                auth_provider=decoded.get("firebase", {}).get("sign_in_provider", "password"),
                email_verified=bool(decoded.get("email_verified")),
                firebase_uid=decoded.get("uid") or "",
                mark_login=False,
            )
        except Exception as sync_error:
            print(f"Firebase signup profile sync failed for {email}: {sync_error}")
            return jsonify(
                {
                    "error": "We couldn't finish setting up your WeCast profile. Please try again."
                }
            ), 500

        return (
            jsonify(
                {
                    "message": "Firebase signup synchronized successfully",
                    "emailVerificationRequired": not bool(decoded.get("email_verified")),
                    "user": _session_user_payload(final_data, email),
                }
            ),
            201,
        )

    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()
    confirm_password = (data.get("confirmPassword") or "").strip()
    name = (data.get("name") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    if not is_reasonably_valid_email(email):
        return jsonify({"error": "Please enter a valid email address."}), 400

    if password != confirm_password:
        return jsonify({"error": "Passwords do not match."}), 400

    if len(password) < 8:
        return jsonify(
            {"error": "Password must be at least 8 characters long."}
        ), 400

    if not re.search(r"[A-Z]", password) or not re.search(r"\d", password) or not re.search(r"[^A-Za-z0-9]", password):
        return jsonify(
            {
                "error": (
                    "Password must be at least 8 characters and include one "
                    "uppercase letter, one number, and one special symbol."
                )
            }
        ), 400

    user_ref = db.collection("users").document(email)
    if user_ref.get().exists:
        return jsonify({"error": "This email is already in use."}), 409

    password_hash = generate_password_hash(password)

    user_ref.set(
        {
            "email": email,
            "name": name or "",
            "displayName": name or "",
            "bio": "",
            "avatarUrl": "",
            "username_lower": (name or "").lower(),
            "password_hash": password_hash,
            "authProvider": "password",
            "emailVerified": False,
            "created_at": datetime.utcnow().isoformat(),
            "last_login": datetime.utcnow().isoformat(),
            "role": "user",
            "failed_attempts": 0,
            "lock_until": None,
        }
    )

    token = create_token(email, email)
    session["user_id"] = email
    session.modified = True

    return (
        jsonify(
            {
                "message": "User created successfully",
                "token": token,
                "user": {
                    "email": email,
                    "name": name or "",
                    "role": "user",
                    "authProvider": "password",
                },
            }
        ),
        201,
    )

@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}

    identifier = (data.get("identifier") or data.get("email") or "").strip()
    password = data.get("password") or ""

    if not identifier or not password:
        return jsonify({"error": "Email/username and password are required"}), 400

    users = db.collection("users")
    user_data = None
    user_email = None

    if "@" in identifier:
        email_candidates = [identifier, identifier.lower()]
        for candidate in email_candidates:
            doc = users.document(candidate).get()
            if doc.exists:
                user_data = doc.to_dict() or {}
                user_email = user_data.get("email") or candidate
                break
    else:
        username = identifier.lower()
        username_docs = list(
            users.where("username_lower", "==", username).limit(2).stream()
        )
        if not username_docs:
            username_docs = list(users.where("name", "==", identifier).limit(2).stream())

        if len(username_docs) > 1:
            return jsonify({"error": "Multiple users match this username. Please log in with email."}), 409
        if len(username_docs) == 1:
            user_data = username_docs[0].to_dict() or {}
            user_email = user_data.get("email") or username_docs[0].id

    if not user_data:
        return jsonify({"error": "Invalid email/username or password"}), 401

    stored_hash = user_data.get("password_hash")

    if not stored_hash or not check_password_hash(stored_hash, password):
        return jsonify({"error": "Invalid email/username or password"}), 401

    token = create_token(user_email, user_email)
    
    session["user_id"] = user_email
    session.modified = True

    return (
        jsonify(
            {
                "message": "Login successful",
                "token": token,
                "user": {
                    "email": user_data.get("email"),
                    "name": user_data.get("name"),
                    "role": user_data.get("role", "user"),
                    "authProvider": user_data.get("authProvider") or ("password" if user_data.get("password_hash") else "unknown"),
                },
            }
        ),
        200,
    )

@app.post("/api/reset-password-direct")
def reset_password_direct():
    data = request.get_json(silent=True) or {}

    email = (data.get("email") or "").strip().lower()
    new_password = data.get("new_password") or ""
    confirm_password = data.get("confirm_password") or ""

    if not email or not new_password or not confirm_password:
        return jsonify(error="All fields are required."), 400

    if new_password != confirm_password:
        return jsonify(error="Passwords do not match."), 400

    if len(new_password) < 8:
        return jsonify(error="Password must be at least 8 characters long."), 400

    if (
        not re.search(r"[A-Z]", new_password)
        or not re.search(r"\d", new_password)
        or not re.search(r"[^A-Za-z0-9]", new_password)
    ):
        return jsonify(
            {
                "error": (
                    "Password must be at least 8 characters and include one "
                    "uppercase letter, one number, and one special symbol."
                )
            }
        ), 400

    user_ref = db.collection("users").document(email)
    doc = user_ref.get()

    if not doc.exists:
        return jsonify(error="Email is not registered."), 404

    new_hash = generate_password_hash(new_password)
    user_ref.update(
        {
            "password_hash": new_hash,
            "failed_attempts": 0,
            "lock_until": None,
        }
    )

    return jsonify(message="Password updated successfully. You can now log in."), 200


@app.post("/api/social-login")
def social_login():
    from firebase_admin import auth as fb_auth

    data = request.get_json(silent=True) or {}
    id_token = data.get("idToken")

    if not id_token:
        return jsonify(error="Missing Firebase ID token"), 400

    try:
        decoded = fb_auth.verify_id_token(id_token)
        email = (decoded.get("email") or "").strip().lower()
        name = (data.get("name") or decoded.get("name") or "").strip()

        if not email:
            return jsonify(error="Unable to read email from Firebase token"), 400

        final_data = _upsert_firebase_user_profile(
            email=email,
            display_name=name,
            auth_provider=decoded.get("firebase", {}).get("sign_in_provider", "oauth"),
            email_verified=bool(decoded.get("email_verified")),
            firebase_uid=decoded.get("uid") or "",
            mark_login=True,
        )


        token = create_token(email, email)

        session["user_id"] = email
        session.modified = True

        return jsonify(
            message="Login successful",
            token=token,
            user=_session_user_payload(final_data, email),
        )

    except Exception as e:
        print("Social login error:", e)
        return jsonify(
            error=(
                "We couldn't verify your Firebase sign-in. Make sure the backend "
                "Firebase service account matches the frontend Firebase project."
            )
        ), 401

@app.post("/api/firebase-email-login")
def firebase_email_login():
    from firebase_admin import auth as fb_auth

    data = request.get_json(silent=True) or {}
    id_token = data.get("idToken")

    if not id_token:
        return jsonify(error="Missing Firebase ID token"), 400

    try:
        decoded = fb_auth.verify_id_token(id_token)
        email = (decoded.get("email") or "").strip().lower()
        name = (data.get("name") or decoded.get("name") or "").strip()
        email_verified = bool(decoded.get("email_verified"))

        if not email:
            return jsonify(error="Unable to read email from Firebase token"), 400

        if not email_verified:
            return jsonify(error="Please verify your email before signing in."), 403

        final_data = _upsert_firebase_user_profile(
            email=email,
            display_name=name,
            auth_provider=decoded.get("firebase", {}).get("sign_in_provider", "password"),
            email_verified=email_verified,
            firebase_uid=decoded.get("uid") or "",
            mark_login=True,
        )

        token = create_token(email, email)
        session["user_id"] = email
        session.modified = True

        return jsonify(
            message="Login successful",
            token=token,
            user=_session_user_payload(final_data, email),
        )
    except Exception as e:
        print("Firebase email login error:", e)
        return jsonify(
            error=(
                "We couldn't verify your Firebase sign-in. Make sure the backend "
                "Firebase service account matches the frontend Firebase project."
            )
        ), 401

def _normalize_public_url(url: str) -> str:
    return (url or "").strip()

def send_podcast_ready_email(user_email, podcast_title, podcast_id):
    try:
        public_link = f"{os.getenv('FRONTEND_PUBLIC_URL')}/#/share/{podcast_id}"

        msg = MIMEMultipart()
        msg["From"] = f"{os.getenv('FROM_NAME')} <{os.getenv('FROM_EMAIL')}>"
        msg["To"] = user_email
        msg["Subject"] = "Your WeCast podcast is ready"

        body = f"""
Hi,

Your podcast "{podcast_title}" has been generated successfully.

You can access and download it here:
{public_link}

Thanks for using WeCast.
"""
        msg.attach(MIMEText(body, "plain"))

        server = smtplib.SMTP(os.getenv("SMTP_HOST"), int(os.getenv("SMTP_PORT")))
        server.starttls()
        server.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASS"))
        server.send_message(msg)
        server.quit()

        print("Podcast ready email sent successfully")

    except Exception as e:
        print("Podcast ready email failed:", str(e))

@app.get("/api/share/<podcast_id>")
def get_shared_podcast(podcast_id):
    try:
        ref = db.collection("podcasts").document(podcast_id)
        doc = ref.get()

        if not doc.exists:
            return jsonify({"error": "Podcast not found"}), 404

        podcast = doc.to_dict() or {}

        # Shared link must stop working if podcast is deleted
        if str(podcast.get("status") or "").strip().lower() == "deleted":
            return jsonify({"error": "Podcast not found"}), 404

        # Fresh audio URL
        audio_url = podcast.get("audioUrl", "")
        audio_key = podcast.get("audioKey", "")
        if audio_key:
            try:
                audio_url = generate_r2_signed_url(audio_key, expires_in=3600)
            except Exception as e:
                print("Share audio URL generation failed:", str(e))

        # Public transcript
        transcript_words = []
        tdoc = ref.collection("transcripts").document("main").get()
        if tdoc.exists:
            transcript_words = (tdoc.to_dict() or {}).get("words") or []

        return jsonify({
            "id": podcast_id,
            "title": podcast.get("title", ""),
            "audioUrl": audio_url,
            "summary": podcast.get("summary", ""),
            "chapters": podcast.get("chapters", []),
            "cover": podcast.get("coverThumbB64", ""),
            "language": podcast.get("language", "en"),
            "words": transcript_words,
        })

    except Exception as e:
        print("Public share route error:", str(e))
        return jsonify({"error": "Failed to load shared podcast"}), 500


# ------------------------------------------------------------
# Main
# ------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
