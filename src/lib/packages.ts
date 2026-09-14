// Pre-set packages a studio sells at check-in — kept as a small in-code
// table for now rather than a DB-editable settings page, same pattern as
// the seed-name constants in src/app/(app)/admin/cleanup/page.tsx. Prices
// are per-studio because studios use different currencies (Kula: TRY,
// Alchemy Uluwatu: IDR) and will likely charge different amounts even for
// the same package type.
//
// Gün confirmed Kula's real current pricing on Sep 14, 2026. Alchemy
// Uluwatu's own pricing hasn't been given yet, so its list is empty —
// selling packages there is disabled (not guessed at) until Gün provides
// real numbers. If a studio's list is empty, the "Sell a package" control
// simply doesn't show for that studio.
//
// Turning this into an in-app editable settings page (so Gün doesn't need
// a code change to add/adjust a package) is a reasonable next step, not
// done here to keep this build scoped to "make real sales possible today."

export type MembershipKind = "drop_in" | "class_pack" | "unlimited_monthly";

export type PackageOption = {
  key: string;
  label: string;
  type: MembershipKind;
  price: number; // in the studio's own currency (studio.currency)
  credits: number | null; // null = unlimited
  validityMonths: number;
};

export const STUDIO_PACKAGES: Record<string, PackageOption[]> = {
  istanbul: [
    {
      key: "drop_in",
      label: "Drop-in class — ₺1,500 (valid 1 month)",
      type: "drop_in",
      price: 1500,
      credits: 1,
      validityMonths: 1,
    },
    {
      key: "class_pack_10",
      label: "10 Class Pack — ₺12,000 (valid 2 months)",
      type: "class_pack",
      price: 12000,
      credits: 10,
      validityMonths: 2,
    },
    {
      key: "unlimited_monthly",
      label: "Aylık Sınırsız — ₺15,000 (valid 1 month)",
      type: "unlimited_monthly",
      price: 15000,
      credits: null,
      validityMonths: 1,
    },
  ],
  "alchemy-uluwatu": [],
};

export function packagesForStudio(slug: string): PackageOption[] {
  return STUDIO_PACKAGES[slug] ?? [];
}

export function packageByKey(slug: string, key: string): PackageOption | undefined {
  return packagesForStudio(slug).find((p) => p.key === key);
}

// Add N calendar months to a "YYYY-MM-DD" date string, clamping the day if
// the target month is shorter (e.g. Jan 31 + 1 month -> Feb 28/29).
export function addMonthsToDateString(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const total = m - 1 + months;
  const targetYear = y + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12; // 0-indexed
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(d, daysInTargetMonth);
  const mm = String(targetMonth + 1).padStart(2, "0");
  const dd = String(targetDay).padStart(2, "0");
  return `${targetYear}-${mm}-${dd}`;
}
