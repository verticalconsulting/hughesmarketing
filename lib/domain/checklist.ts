export function gettingStarted(s: {
  onboardingMissing: number;
  auditCount: number;
  hasPlan: boolean;
  doneItems: number;
  decidedVerdicts: number;
}) {
  return [
    { key: "brand", label: "Add the brand", done: true },
    { key: "onboarding", label: "Answer onboarding questions", done: s.onboardingMissing === 0 },
    { key: "audit", label: "Run the first audit", done: s.auditCount > 0 },
    { key: "plan", label: "Build the marketing plan", done: s.hasPlan },
    { key: "execute", label: "Complete a plan item", done: s.doneItems > 0 },
    { key: "measure", label: "Get a tracker verdict", done: s.decidedVerdicts > 0 },
  ];
}
