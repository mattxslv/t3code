import type { AutoRoutingComplexity } from "@t3tools/contracts";

export interface ClassificationHistory {
  /** Completed or failed user turns before this one. */
  readonly priorTurns: number;
  /** Complexity the current task was last routed at, if any. */
  readonly previousComplexity: AutoRoutingComplexity | null;
  /** The previous turn ended with a failed verification or an unresolved run failure. */
  readonly previousTurnFailed: boolean;
}

export interface ClassificationInput {
  readonly text: string;
  readonly attachmentCount: number;
  readonly history: ClassificationHistory;
}

export interface Classification {
  readonly complexity: AutoRoutingComplexity;
  /** 0..1. Low values mark ambiguous requests the optional AI classifier may refine. */
  readonly confidence: number;
  readonly continuation: boolean;
  readonly userReportedFailure: boolean;
  readonly signals: ReadonlyArray<string>;
}

const COMPLEXITY_ORDER: ReadonlyArray<AutoRoutingComplexity> = [
  "trivial",
  "simple",
  "moderate",
  "complex",
];

const complexityRank = (complexity: AutoRoutingComplexity) => COMPLEXITY_ORDER.indexOf(complexity);

const fromRank = (rank: number): AutoRoutingComplexity =>
  COMPLEXITY_ORDER[Math.max(0, Math.min(COMPLEXITY_ORDER.length - 1, rank))]!;

const TRIVIAL_MESSAGE =
  /^(?:hi|hey|hello|thanks?(?: you)?|thx|ty|ok(?:ay)?|cool|nice|great|perfect|yes|yep|yeah|no|nope|sure|lgtm|continue|go ahead|proceed|do it|sounds good|got it|stop)[\s.!?]*$/i;

const SHORT_ACKNOWLEDGEMENT =
  /^(?:thanks?|thank you|thx|ok(?:ay)?|cool|nice|great|perfect|awesome|lgtm|looks good|sounds good|got it)\b/i;

const SMALL_EDIT =
  /\b(?:typo|rename|reword|spelling|bump (?:the )?version|update (?:the )?(?:copy|text|label|readme|comment)|add (?:a )?comment|format(?:ting)?|whitespace|lint fix|remove (?:an? |the )?(?:unused )?(?:import|log|console\.log)|fix (?:the )?indent)/i;

const QUESTION_ONLY =
  /^(?:what|where|which|who|when|why|how|is|are|does|do|should|explain|show me|list|tell me)\b/i;
const POLITE_PREFIX = /^(?:(?:can|could|would|will) you(?: please)?|please)\s+/i;

const COMPLEX_SIGNALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:architect(?:ure)?|redesign|re-architect|system design)\b/i, "architecture"],
  [
    /\brefactor\b.*\b(?:across|entire|whole|codebase|all|every|module|package)s?\b/i,
    "broad_refactor",
  ],
  [/\bmigrat(?:e|ion)\b/i, "migration"],
  [/\b(?:race condition|deadlock|concurren(?:cy|t)|thread[- ]safe|data race)\b/i, "concurrency"],
  [
    /\b(?:security|vulnerab|exploit|auth(?:entication|orization) flow|xss|csrf|injection)\b/i,
    "security",
  ],
  // Reviewing a system for weaknesses is open-ended work, unlike touching a security-related file.
  [
    /\b(?:audit|review|check|scan|assess|inspect|look for|find)\w*\b.{0,40}\b(?:security|vulnerab\w*|exploit\w*)|\b(?:security|vulnerab\w*)\s+(?:audit|review|check|scan|assessment)\b/i,
    "security_review",
  ],
  [
    /\b(?:performance|optimi[sz]e|latency|memory leak|profil(?:e|ing)|throughput)\b/i,
    "performance",
  ],
  [
    /\b(?:flaky|intermittent|heisenbug|non-?deterministic|only (?:fails|happens) (?:in|on|sometimes))\b/i,
    "intermittent",
  ],
  [
    /\b(?:end[- ]to[- ]end|full[- ]stack|across (?:the )?(?:codebase|repo|services|packages))\b/i,
    "cross_cutting",
  ],
  [
    /\b(?:implement|build|design|create) (?:a |an |the )?(?:complete|full|entire|new) (?:[\w-]+ ){0,3}(?:system|feature|service|engine|pipeline|framework|protocol)\b/i,
    "new_system",
  ],
  [
    /\b(?:distributed|consensus|event[- ]sourc|cryptograph|compiler|parser|scheduler|algorithm|protocol|conflict resolution|vector clock)\w*\b/i,
    "hard_domain",
  ],
];

const MODERATE_SIGNALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:fix|debug|investigate|diagnose|resolve)\b/i, "debugging"],
  [
    /\b(?:add|write|update|cover)\s+(?:a |an |some |more |the )?(?:unit |integration |e2e |regression |snapshot )?tests?\b/i,
    "tests",
  ],
  [
    /\b(?:implement|add|create|build|write)\s+(?:a |an |the )?(?:[\w`.-]+ ){0,2}(?:function|method|endpoint|component|hook|command|route|handler|option|flag|page|setting|api|query)s?\b/i,
    "feature_unit",
  ],
  [/\brefactor\b/i, "refactor"],
  [
    /\b(?:and|then)\s+(?:also\s+)?(?:use|wire|integrate|update|add|write|hook up|replace|migrate|test)\b/i,
    "compound_request",
  ],
  [
    /\b(?:\w*error|exception|stack ?trace|traceback|panic|segfault|crash(?:es|ed|ing)?|failing|fails|broken)\b/i,
    "error_report",
  ],
];

const MAX_MODERATE_SCORE = 4.5;

const CONTINUATION_START =
  /^(?:and|also|now|then|next|ok(?:ay)?|yes|no|great|thanks|but|instead|actually|try|retry|again|continue|keep going|go ahead|same|still|what about|can you also|please also)\b/i;
const ANAPHORA = /\b(?:it|that|this|those|these|them|same|again|still|above|previous(?:ly)?)\b/i;

const USER_FAILURE =
  /\b(?:still (?:fail|failing|broken|not working|doesn'?t work|errors?|crash)|same (?:error|issue|problem|failure)|didn'?t (?:work|fix|help)|(?:doesn'?t|does not|won'?t) (?:compile|build|work|run)|that broke|you broke|regress(?:ed|ion)|tests? (?:still )?fail(?:s|ing)?|not fixed|wrong again)\b/i;

const FILE_PATH = /(?:^|[\s`'"(])(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]{1,6}\b/gi;
const STEP_LINE = /^\s*(?:\d+[.)]|[-*•])\s+\S/gm;

/** Local, deterministic and free. Reads only the user's own message and structured history. */
export function classifyTask(input: ClassificationInput): Classification {
  const text = input.text.trim();
  const words = text.length === 0 ? 0 : text.split(/\s+/).length;
  const signals: string[] = [];
  const hasHistory = input.history.priorTurns > 0;

  const userReportedFailure = USER_FAILURE.test(text);
  if (userReportedFailure) signals.push("user_reported_failure");

  const continuation =
    hasHistory &&
    (userReportedFailure ||
      (words <= 40 && (CONTINUATION_START.test(text) || ANAPHORA.test(text))) ||
      TRIVIAL_MESSAGE.test(text));
  if (continuation) signals.push("continuation");

  if (
    text.length === 0 ||
    TRIVIAL_MESSAGE.test(text) ||
    (words <= 6 && SHORT_ACKNOWLEDGEMENT.test(text) && !text.includes("?"))
  ) {
    signals.push("acknowledgement");
    return {
      complexity:
        continuation && input.history.previousComplexity
          ? input.history.previousComplexity
          : "trivial",
      confidence: 0.95,
      continuation,
      userReportedFailure,
      signals,
    };
  }

  let score = 0;
  let complexSignals = 0;
  for (const [pattern, signal] of COMPLEX_SIGNALS) {
    if (pattern.test(text)) {
      score += 3;
      complexSignals += 1;
      signals.push(signal);
    }
  }
  // Moderate signals overlap ("fix the error" is both debugging and an error report), so stacking
  // them alone cannot reach complex; that takes a complex signal or a large, structured request.
  let moderateScore = 0;
  for (const [pattern, signal] of MODERATE_SIGNALS) {
    if (pattern.test(text)) {
      moderateScore += 1.5;
      signals.push(signal);
    }
  }
  score += Math.min(moderateScore, MAX_MODERATE_SCORE);
  if (SMALL_EDIT.test(text)) {
    score -= 2;
    signals.push("small_edit");
  }
  if (QUESTION_ONLY.test(text.replace(POLITE_PREFIX, "")) && words <= 30 && !text.includes("```")) {
    score -= 1;
    signals.push("question");
  }

  const codeBlocks = Math.floor((text.match(/```/g)?.length ?? 0) / 2);
  if (codeBlocks > 0) {
    score += Math.min(2, codeBlocks);
    signals.push("code_block");
  }
  const files = new Set(text.match(FILE_PATH)?.map((match) => match.trim()) ?? []).size;
  if (files >= 4) {
    score += 2.5;
    signals.push("many_files");
  } else if (files >= 1) {
    score += 0.5;
    signals.push("file_reference");
  }
  const steps = text.match(STEP_LINE)?.length ?? 0;
  if (steps >= 4) {
    score += 2;
    signals.push("multi_step");
  }
  if (words > 400) {
    score += 3;
    signals.push("long_request");
  } else if (words > 150) {
    score += 1.5;
    signals.push("detailed_request");
  } else if (words < 12 && complexSignals === 0) {
    // A terse request is usually a small one, but not when it names hard work outright.
    score -= 0.5;
  }
  if (input.attachmentCount > 0) {
    score += 1;
    signals.push("attachments");
  }
  if (input.history.previousTurnFailed || userReportedFailure) {
    score += 2;
    signals.push("prior_failure");
  }

  let complexity: AutoRoutingComplexity =
    score >= 6 ? "complex" : score >= 2.5 ? "moderate" : score >= 0.5 ? "simple" : "trivial";

  // A follow-up stays at least one level below the task it continues, so it rarely downgrades mid-task.
  if (continuation && input.history.previousComplexity !== null) {
    const floor = complexityRank(input.history.previousComplexity) - (userReportedFailure ? 0 : 1);
    if (complexityRank(complexity) < floor) {
      complexity = fromRank(floor);
      signals.push("continuation_floor");
    }
  }

  // Distance from the nearest bucket boundary; few signals on a mid-length request is ambiguous.
  const boundaries = [0.5, 2.5, 6];
  const margin = Math.min(...boundaries.map((boundary) => Math.abs(score - boundary)));
  const evidence = signals.filter((signal) => signal !== "continuation").length;
  const confidence = Math.max(
    0.3,
    Math.min(0.95, 0.45 + Math.min(margin, 3) * 0.12 + Math.min(evidence, 4) * 0.06),
  );

  // Without a clear signal, lean one level up: a capable model finishing beats a cheap one failing.
  if (confidence < 0.6 && complexityRank(complexity) < complexityRank("moderate")) {
    complexity = fromRank(complexityRank(complexity) + 1);
    signals.push("low_confidence_upgrade");
  }

  return { complexity, confidence, continuation, userReportedFailure, signals };
}
