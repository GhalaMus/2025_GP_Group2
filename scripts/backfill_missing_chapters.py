import argparse
import os
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from firebase_init import db
from firebase_admin import firestore
from app import build_chapters, build_transcript_text_with_speakers, is_arabic


def main():
    parser = argparse.ArgumentParser(
        description="Backfill missing podcast chapters from saved transcripts."
    )
    parser.add_argument("--only-id", help="Backfill only one podcast document id.")
    parser.add_argument("--apply", action="store_true", help="Actually write chapter updates.")
    args = parser.parse_args()

    ready = 0
    updated = 0
    skipped = 0
    missing_words = 0

    for doc in db.collection("podcasts").stream():
        if args.only_id and doc.id != args.only_id:
            continue

        data = doc.to_dict() or {}
        existing_chapters = data.get("chapters") or []
        if isinstance(existing_chapters, list) and len(existing_chapters) > 0:
            skipped += 1
            continue

        tdoc = doc.reference.collection("transcripts").document("main").get()
        tdata = tdoc.to_dict() or {}
        words = tdata.get("words") or []
        if not isinstance(words, list) or not words:
            missing_words += 1
            print(f"MISSING_WORDS {doc.id} {data.get('title') or 'Untitled'}")
            continue

        transcript_text = (data.get("transcriptText") or "").strip()
        if not transcript_text:
            try:
                transcript_text = build_transcript_text_with_speakers(words)
            except Exception:
                transcript_text = ""

        language = (data.get("language") or "").strip().lower()
        if language not in ("en", "ar"):
            language = "ar" if is_arabic(transcript_text) else "en"

        chapters = build_chapters(words, transcript_text, language=language)
        if not isinstance(chapters, list) or not chapters:
            print(f"FAILED {doc.id} {data.get('title') or 'Untitled'}")
            continue

        ready += 1
        print(f"READY {doc.id} -> {len(chapters)} chapters")
        if not args.apply:
            continue

        doc.reference.set(
            {
                "chapters": chapters,
                "chaptersUpdatedAt": firestore.SERVER_TIMESTAMP,
                "transcriptText": transcript_text or data.get("transcriptText") or "",
            },
            merge=True,
        )
        updated += 1
        print(f"UPDATED {doc.id}")

    print("\nSummary")
    print("-------")
    print(f"Ready: {ready}")
    print(f"Updated: {updated}")
    print(f"Missing words: {missing_words}")
    print(f"Skipped: {skipped}")
    if not args.apply:
        print("Dry run only. Re-run with --apply to perform the backfill.")


if __name__ == "__main__":
    main()
