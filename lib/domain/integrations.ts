export const SERVICES = [
  "ga4",
  "gsc",
  "google_ads",
  "github",
  "facebook",
  "google_business_profile",
  "formspree",
  "wordpress",
  "wix",
  "other",
] as const;
export type Service = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<Service, string> = {
  ga4: "Google Analytics 4",
  gsc: "Google Search Console",
  google_ads: "Google Ads",
  github: "GitHub",
  facebook: "Facebook",
  google_business_profile: "Google Business Profile",
  formspree: "Formspree",
  wordpress: "WordPress",
  wix: "Wix",
  other: "Other",
};
