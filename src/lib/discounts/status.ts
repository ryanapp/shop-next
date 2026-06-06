export const RULE_STATUSES = {
  DRAFT: "DRAFT",
  GENERATING: "GENERATING",
  TESTING: "TESTING",
  ACTIVE: "ACTIVE",
  FAILED: "FAILED",
  DISABLED: "DISABLED"
} as const;

export type RuleStatus = (typeof RULE_STATUSES)[keyof typeof RULE_STATUSES];
