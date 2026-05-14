import { Navigate } from "react-router-dom";
import { ManagementReviewTab } from "../components/admin/ManagementReviewTab";
import { useAuth } from "../hooks/useAuth";

export default function ManagementReviews() {
  const { user } = useAuth();

  // Sub-role gate. Backend re-checks via _require_management, so this is
  // purely a UI affordance — direct URL access for anyone else gets bounced.
  const canSeeManagementReview =
    user?.role === "Admin" && user?.is_management === true;

  if (!canSeeManagementReview) {
    return <Navigate to="/unauthorized" replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Management Reviews
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Review annual evaluations that have cleared the mentor stage and publish management ratings.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <ManagementReviewTab />
      </div>
    </div>
  );
}
