export type GroupableRule = {
  id: string;
  slug: string;
  version: number;
  status: string;
};

export type RuleGroup<T extends GroupableRule> = {
  slug: string;
  activeRule: T | null;
  versions: T[];
};

export function groupRulesBySlug<T extends GroupableRule>(
  rules: T[]
): RuleGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const rule of rules) {
    const existing = groups.get(rule.slug) ?? [];
    existing.push(rule);
    groups.set(rule.slug, existing);
  }

  return Array.from(groups.entries())
    .map(([slug, versions]) => {
      const sortedVersions = [...versions].sort((left, right) => {
        if (left.status === "ACTIVE" && right.status !== "ACTIVE") {
          return -1;
        }

        if (right.status === "ACTIVE" && left.status !== "ACTIVE") {
          return 1;
        }

        return right.version - left.version;
      });

      return {
        slug,
        activeRule:
          sortedVersions.find((rule) => rule.status === "ACTIVE") ?? null,
        versions: sortedVersions
      };
    })
    .sort((left, right) => {
      const leftVersion = left.versions[0]?.version ?? 0;
      const rightVersion = right.versions[0]?.version ?? 0;
      return rightVersion - leftVersion;
    });
}
