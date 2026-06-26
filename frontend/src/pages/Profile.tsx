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

      {/* Two-column layout: info left, password right — equal widths so both
          cards are visually balanced and the password form can spread its
          inputs across the available space. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProfileInfoCard profile={profile} isLoading={isPending} />
        <PasswordChangeCard />
      </div>
    </div>
  );
}
