export interface Question {
  key: string;
  prompt: string;
  kind: "text" | "number" | "choice" | "list";
  options?: string[];
}

export const ONBOARDING_QUESTIONS: Question[] = [
  { key: "business_offer", prompt: "What does the business sell or offer, in one or two sentences?", kind: "text" },
  { key: "primary_audience", prompt: "Who is the primary audience or ideal customer?", kind: "text" },
  { key: "service_locations", prompt: "Which cities, regions, or areas does it serve?", kind: "list" },
  { key: "primary_goal", prompt: "What is the primary goal?", kind: "choice", options: ["leads", "sales", "signups", "donations"] },
  { key: "current_channels", prompt: "Which marketing channels are active today?", kind: "list" },
  { key: "monthly_budget", prompt: "What is the monthly marketing budget in USD (0 if none)?", kind: "number" },
  { key: "weekly_hours", prompt: "How many hours per week can the team spend?", kind: "number" },
  { key: "competitors", prompt: "Who are the top competitors (names or URLs)?", kind: "list" },
  { key: "brand_voice", prompt: "How should the brand sound? Anything to avoid?", kind: "text" },
  { key: "approval_rules", prompt: "What needs approval before going live (publishing, ad spend, site changes)?", kind: "text" },
  { key: "website_platform", prompt: "What platform runs the website (WordPress, Wix, Next.js, etc.)?", kind: "text" },
];

export const PLAN_QUESTIONS: Question[] = [
  { key: "primary_goal", prompt: "What is the primary goal for this plan?", kind: "choice", options: ["leads", "sales", "signups", "donations"] },
  { key: "primary_channel", prompt: "Which channel should be the primary focus?", kind: "choice", options: ["AI visibility", "SEO", "GEO", "Paid ads", "Social", "Website & content", "Email"] },
  { key: "secondary_channels", prompt: "Which secondary channels should support it?", kind: "list" },
  { key: "monthly_budget", prompt: "What monthly budget (USD) can the plan use?", kind: "number" },
  { key: "timeline_horizon", prompt: "What timeline should the plan cover?", kind: "choice", options: ["90_day", "6_month", "12_month", "ongoing"] },
  { key: "risk_tolerance", prompt: "How much risk is acceptable for experiments?", kind: "choice", options: ["low", "medium", "high"] },
  { key: "constraints", prompt: "Any constraints (seasonality, legal, staffing, brand rules)?", kind: "text" },
];

export function isAnswered(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function missingOnboardingQuestions(answers: Record<string, unknown>): Question[] {
  return ONBOARDING_QUESTIONS.filter((q) => !isAnswered(answers[q.key]));
}

export function missingPlanQuestions(answers: Record<string, unknown>): Question[] {
  return PLAN_QUESTIONS.filter((q) => !isAnswered(answers[q.key]));
}
