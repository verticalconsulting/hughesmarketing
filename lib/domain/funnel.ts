export const FUNNEL_STAGES = ["acquisition", "activation", "retention", "referral", "revenue"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_META: Record<FunnelStage, { label: string; hint: string; color: string }> = {
  acquisition: { label: "Acquisition", hint: "Get found", color: "var(--funnel-acquisition)" },
  activation: { label: "Activation", hint: "First value", color: "var(--funnel-activation)" },
  retention: { label: "Retention", hint: "Keep them", color: "var(--funnel-retention)" },
  referral: { label: "Referral", hint: "Word of mouth", color: "var(--funnel-referral)" },
  revenue: { label: "Revenue", hint: "Monetize", color: "var(--funnel-revenue)" },
};
