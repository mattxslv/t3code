import type {
  AutoRoutingModelTierOverride,
  AutoRoutingTier,
  ServerProviderModel,
} from "@t3tools/contracts";

export interface AutoRoutingModelProfile {
  readonly tier: AutoRoutingTier;
  readonly tierSource: "override" | "catalog";
  /** 1 slowest .. 3 fastest. */
  readonly speed: 1 | 2 | 3;
  /** Relative subscription usage weight. An ordering hint, not a price. */
  readonly usageWeight: number;
  /** False when no family rule matched and no override exists. */
  readonly known: boolean;
}

interface FamilyRule {
  readonly pattern: RegExp;
  readonly tier: AutoRoutingTier;
  readonly speed: 1 | 2 | 3;
  readonly usageWeight: number;
}

// Families are matched on slug and display name, so renamed snapshots still classify.
const FAMILY_RULES: ReadonlyArray<FamilyRule> = [
  { pattern: /\b(fable|astra)\b/i, tier: 4, speed: 1, usageWeight: 8 },
  { pattern: /\b(opus|sol)\b/i, tier: 3, speed: 2, usageWeight: 4 },
  { pattern: /\b(sonnet|terra)\b/i, tier: 2, speed: 2, usageWeight: 2 },
  { pattern: /\b(haiku|luna|mini|nano|spark|flash|lite)\b/i, tier: 1, speed: 3, usageWeight: 1 },
];

function tierDefaults(tier: AutoRoutingTier): Pick<FamilyRule, "speed" | "usageWeight"> {
  if (tier <= 1) return { speed: 3, usageWeight: 1 };
  if (tier === 2) return { speed: 2, usageWeight: 2 };
  if (tier === 3) return { speed: 2, usageWeight: 4 };
  return { speed: 1, usageWeight: 8 };
}

function familyText(slug: string, name: string): string {
  return `${slug} ${name}`.replace(/[-_.]+/g, " ");
}

export function resolveModelProfile(
  model: { readonly slug: string; readonly name: string },
  overrides: ReadonlyArray<AutoRoutingModelTierOverride>,
): AutoRoutingModelProfile {
  const override = overrides.find((entry) => entry.model === model.slug);
  if (override !== undefined) {
    return {
      tier: override.tier,
      tierSource: "override",
      ...tierDefaults(override.tier),
      known: true,
    };
  }
  const text = familyText(model.slug, model.name);
  const rule = FAMILY_RULES.find((candidate) => candidate.pattern.test(text));
  if (rule === undefined) {
    return { tier: 2, tierSource: "catalog", ...tierDefaults(2), known: false };
  }
  return {
    tier: rule.tier,
    tierSource: "catalog",
    speed: rule.speed,
    usageWeight: rule.usageWeight,
    known: true,
  };
}

const EFFORT_OPTION_IDS = ["effort", "reasoningEffort"] as const;
const EFFORT_LADDER = ["low", "medium", "high"] as const;
export type AutoRoutingEffort = (typeof EFFORT_LADDER)[number];

/** Auto never picks max, xhigh, ultracode or ultrathink; those stay a manual choice. */
export function effortForComplexity(
  complexity: "trivial" | "simple" | "moderate" | "complex",
  profile: "economy" | "balanced" | "quality",
): AutoRoutingEffort {
  const base = complexity === "complex" ? 2 : complexity === "moderate" ? 1 : 0;
  const shift = profile === "economy" ? -1 : profile === "quality" ? 1 : 0;
  const index = Math.min(EFFORT_LADDER.length - 1, Math.max(0, base + shift));
  return EFFORT_LADDER[index]!;
}

export type EffortCapableModel = Pick<ServerProviderModel, "capabilities">;

/** The option to send for the chosen effort, or null when the model has no matching level. */
export function effortOptionFor(
  model: EffortCapableModel,
  effort: AutoRoutingEffort,
): { readonly id: string; readonly value: string } | null {
  for (const descriptor of model.capabilities?.optionDescriptors ?? []) {
    if (descriptor.type !== "select") continue;
    if (!(EFFORT_OPTION_IDS as ReadonlyArray<string>).includes(descriptor.id)) continue;
    return descriptor.options.some((option) => option.id === effort)
      ? { id: descriptor.id, value: effort }
      : null;
  }
  return null;
}
