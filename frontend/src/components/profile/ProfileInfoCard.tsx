import { RoleBadge } from "../admin/RoleBadge";
import type { UserProfile } from "../../services/profile.service";

interface ProfileInfoCardProps {
  readonly profile: UserProfile | null;
  readonly isLoading: boolean;
}

function InfoRow({
  label,
  value,
}: Readonly<{ label: string; value: string | null | undefined }>) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-text-main">
        {value ?? "—"}
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm animate-pulse space-y-6">
      <div className="flex flex-col items-center gap-3">
        <div className="h-20 w-20 rounded-full bg-slate-100" />
        <div className="h-4 w-32 rounded bg-slate-100" />
        <div className="h-5 w-16 rounded-full bg-slate-100" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <div className="h-2.5 w-20 rounded bg-slate-100" />
            <div className="h-3.5 w-36 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProfileInfoCard({ profile, isLoading }: ProfileInfoCardProps) {
  if (isLoading || !profile) return <Skeleton />;

  const initials = profile.full_name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm space-y-6">
      {/* Avatar + identity */}
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="h-20 w-20 rounded-full bg-brand text-white flex items-center justify-center font-display text-2xl font-bold"
          aria-label={profile.full_name}
        >
          {initials}
        </div>
        <div>
          <p className="font-display text-base font-semibold text-text-main">
            {profile.full_name}
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {profile.employee_code}
          </p>
        </div>
        <RoleBadge role={profile.role} />
        <p className="text-xs text-text-muted italic">
          Photo upload coming in a future update.
        </p>
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* HR data — read only */}
      <div className="space-y-4">
        <InfoRow label="Email" value={profile.email} />
        <InfoRow label="Phone" value={profile.phone} />
        <InfoRow label="Department" value={profile.department} />
        <InfoRow label="Designation" value={profile.designation} />
        <InfoRow label="Mentor" value={profile.mentor_name} />
      </div>

      <p className="text-xs text-text-muted text-center">
        To update HR data, contact your administrator.
      </p>
    </div>
  );
}
