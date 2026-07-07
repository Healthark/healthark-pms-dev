"""
Recover the true author of each goal mentor-review from the submission
notification trail.

`goal_mentor_reviews.mentor_id` was added later; existing rows were backfilled
best-effort from `goal.manager_id`, which is WRONG whenever the mentee changed
mentors mid-cycle (manager_id has since moved to the new mentor). The
`goal_mentor_review_submitted` notification, however, was written at submit time
with `actor_id` = the mentor who actually did it — the authoritative record.

This script matches each submitted mentor review to its notification by
(goal_id, cycle_half) and sets `mentor_id = actor_id`. Rows whose notification
has been purged (100-day retention) are left as-is. Draft-only reviews have no
submission notification and are skipped.

Usage (from backend/, venv active):
    python scripts/backfill_mentor_review_authors.py           # DRY RUN
    python scripts/backfill_mentor_review_authors.py --apply   # commit
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal  # noqa: E402
from app.models.goal_mentor_review_models import GoalMentorReview  # noqa: E402
from app.models.notification_models import Notification  # noqa: E402
from app.models.user_models import User  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="commit (default: dry run)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        # (goal_id, half) -> actor_id, taking the latest notification if several.
        notes = (
            db.query(Notification)
            .filter(
                Notification.type == "goal_mentor_review_submitted",
                Notification.entity_type == "goal",
                Notification.actor_id.isnot(None),
            )
            .order_by(Notification.id)
            .all()
        )
        author_by_key: dict[tuple[int, str], int] = {}
        for n in notes:
            body = n.body or ""
            for half in ("H1", "H2", "Q1", "Q2", "Q3", "Q4"):
                if f"the {half} mentor review" in body:
                    author_by_key[(n.entity_id, half)] = n.actor_id
                    break

        names = {u.id: u.full_name for u in db.query(User).all()}
        changes: list[tuple[int, int, str, object, int]] = []
        no_note = 0
        already = 0

        for mr in db.query(GoalMentorReview).order_by(GoalMentorReview.goal_id).all():
            author = author_by_key.get((mr.goal_id, mr.cycle_half))
            if author is None:
                no_note += 1
                continue
            if mr.mentor_id == author:
                already += 1
                continue
            changes.append((mr.id, mr.goal_id, mr.cycle_half, mr.mentor_id, author))
            mr.mentor_id = author

        print("=" * 70)
        print(f"MODE: {'APPLY' if args.apply else 'DRY RUN'}")
        print("=" * 70)
        print(f"\nCORRECTIONS ({len(changes)}):")
        for rid, gid, half, old, new in changes:
            o = "NULL" if old is None else f"{old} ({names.get(old, '?')})"
            print(f"  review {rid}  goal {gid} {half}:  {o}  ->  {new} ({names.get(new, '?')})")
        if not changes:
            print("  (none)")
        print(
            f"\nSUMMARY: {len(changes)} corrected, {already} already correct, "
            f"{no_note} without a submission notification (left as-is)"
        )

        if args.apply and changes:
            db.commit()
            print("\n[OK] Committed.")
        elif changes:
            db.rollback()
            print("\n(dry run - nothing written. Re-run with --apply to commit.)")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
