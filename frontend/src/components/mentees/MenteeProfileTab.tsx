import {
  BadgeCheck,
  Briefcase,
  Building2,
  Mail,
  Phone,
  Shield,
  UserCheck,
} from "lucide-react";
import type { MenteeDetail } from "../../services/mentee.service";

interface MenteeProfileTabProps {
  readonly mentee: MenteeDetail;
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  readonly icon: typeof Mail;
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-text-muted"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-xs text-text-muted">{label}</p>
        <p className="text-sm font-medium text-text-main break-words">
          {value ?? "—"}
        </p>
      </div>
    </div>
  );
}

export function MenteeProfileTab({ mentee }: MenteeProfileTabProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <InfoRow icon={BadgeCheck} label="Employee Code" value={mentee.employee_code} />
      <InfoRow icon={Shield} label="Role" value={mentee.role} />
      <InfoRow icon={Mail} label="Email" value={mentee.email} />
      <InfoRow icon={Phone} label="Phone" value={mentee.phone} />
      <InfoRow icon={Building2} label="Department" value={mentee.department_name} />
      <InfoRow icon={Briefcase} label="Designation" value={mentee.designation_name} />
      <InfoRow
        icon={UserCheck}
        label="Status"
        value={mentee.is_active ? "Active" : "Inactive"}
      />
    </div>
  );
}
