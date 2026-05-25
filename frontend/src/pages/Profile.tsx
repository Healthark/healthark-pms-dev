import { useProfile } from "../queries/profile";
import { ProfileInfoCard } from "../components/profile/ProfileInfoCard";
import { PasswordChangeCard } from "../components/profile/PasswordChangeCard";

export function Profile() {
  const { data: profile = null, isPending } = useProfile();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          My Profile
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          View your details and manage your account settings.
        </p>
      </div>

      {/* Two-column layout: info left, settings right */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left — read-only HR data (1/3 width on desktop) */}
        <ProfileInfoCard profile={profile} isLoading={isPending} />

        {/* Right — account settings (2/3 width on desktop) */}
        <div className="lg:col-span-2 space-y-6">
          <PasswordChangeCard />
        </div>
      </div>
    </div>
  );
}
