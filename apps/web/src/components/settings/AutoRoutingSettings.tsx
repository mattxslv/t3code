import {
  DEFAULT_AUTO_ROUTING_PREFERENCES,
  DEFAULT_AUTO_ROUTING_SETTINGS,
  type AutoRoutingDecision,
  type AutoRoutingEscalationMode,
  type AutoRoutingModelDiagnostic,
  type AutoRoutingModelRef,
  type AutoRoutingProfile,
  type AutoRoutingSettings,
  type EnvironmentId,
} from "@t3tools/contracts";
import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import {
  AUTO_ROUTING_KIND_LABELS,
  AUTO_ROUTING_PROFILE_DESCRIPTIONS,
  AUTO_ROUTING_PROFILE_LABELS,
} from "../../autoRoutingStore";
import { requestConfirmDialog } from "../../confirmDialog";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const PROFILES: ReadonlyArray<AutoRoutingProfile> = ["economy", "balanced", "quality"];
const ESCALATION_LABELS: Record<AutoRoutingEscalationMode, string> = {
  ask: "Ask first",
  automatic: "Automatic",
  off: "Off",
};
const TIER_LABELS: Record<number, string> = {
  1: "Light",
  2: "Standard",
  3: "Strong",
  4: "Frontier",
};

function modelRefMatches(ref: AutoRoutingModelRef, model: AutoRoutingModelDiagnostic) {
  return (
    ref.model === model.model &&
    (ref.instanceId === undefined || ref.instanceId === model.instanceId)
  );
}

function ProfileSelect(props: {
  readonly value: AutoRoutingProfile | null;
  readonly onChange: (profile: AutoRoutingProfile) => void;
  readonly label: string;
}) {
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (value) props.onChange(value);
      }}
    >
      <SelectTrigger size="sm" aria-label={props.label}>
        <SelectValue>
          {props.value ? AUTO_ROUTING_PROFILE_LABELS[props.value] : "Mixed"}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {PROFILES.map((profile) => (
          <SelectItem key={profile} value={profile} className="min-w-64">
            <div className="grid gap-0.5">
              <span className="font-medium">{AUTO_ROUTING_PROFILE_LABELS[profile]}</span>
              <span className="text-xs leading-4 text-muted-foreground">
                {AUTO_ROUTING_PROFILE_DESCRIPTIONS[profile]}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function SafetyRows(props: {
  readonly routing: AutoRoutingSettings;
  readonly update: (next: Partial<AutoRoutingSettings>) => void;
}) {
  const { routing, update } = props;
  const toggle = (
    key:
      | "fallbackEnabled"
      | "allowMeteredProviders"
      | "allowUnverifiedAuth"
      | "aiClassification"
      | "dryRun"
      | "recordHistory",
    title: string,
    description: string,
  ) => (
    <SettingsRow
      serverScoped
      settingKeys={["autoRouting"]}
      id={`auto-routing-${key}`}
      title={title}
      description={description}
      control={
        <Switch
          aria-label={title}
          checked={routing[key]}
          onCheckedChange={(checked) => update({ [key]: Boolean(checked) })}
        />
      }
    />
  );
  return (
    <>
      <SettingsRow
        serverScoped
        settingKeys={["autoRouting"]}
        {...searchableSetting("auto-routing-escalation")}
        description="After a failed check or a report that a fix did not work, offer a stronger allowed model. Environment failures such as rate limits never escalate."
        control={
          <div className="flex items-center gap-1.5">
            <Select
              value={routing.escalation.mode}
              onValueChange={(mode) => {
                if (mode) update({ escalation: { ...routing.escalation, mode } });
              }}
            >
              <SelectTrigger size="sm" aria-label="Escalation">
                <SelectValue>{ESCALATION_LABELS[routing.escalation.mode]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {(Object.keys(ESCALATION_LABELS) as AutoRoutingEscalationMode[]).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {ESCALATION_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Select
              value={String(routing.escalation.maxPerTask)}
              onValueChange={(value) => {
                if (value)
                  update({ escalation: { ...routing.escalation, maxPerTask: Number(value) } });
              }}
            >
              <SelectTrigger size="sm" aria-label="Escalations per task">
                <SelectValue>{`${routing.escalation.maxPerTask} per task`}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {[0, 1, 2, 3].map((count) => (
                  <SelectItem key={count} value={String(count)}>
                    {`${count} per task`}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        }
      />
      {toggle(
        "fallbackEnabled",
        "Fall back to another model",
        "When the routed model is unavailable, rate limited or removed, use another eligible subscription model. Off uses your manual selection instead.",
      )}
      {toggle(
        "allowUnverifiedAuth",
        "Trust unverified sign-ins",
        "Use signed-in providers that did not report a subscription plan. Instances known to use an API key or cloud billing stay excluded.",
      )}
      {toggle(
        "allowMeteredProviders",
        "Allow metered providers",
        "Let Auto use providers signed in with an API key or cloud billing. These can cost money per request.",
      )}
      {toggle(
        "aiClassification",
        "AI classification",
        "Ask the lightest eligible model to size ambiguous requests. Only your message is sent, never repository content. Clear requests are classified locally for free.",
      )}
      {toggle(
        "dryRun",
        "Dry run",
        "Record what Auto would choose, but send every turn with your manual selection.",
      )}
      {toggle(
        "recordHistory",
        "Keep routing history",
        "Store decisions on this machine for history, diagnostics and feedback. Messages are never stored.",
      )}
    </>
  );
}

function ModelsSection(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: string | null;
  readonly routing: AutoRoutingSettings;
  readonly preferred: ReadonlyArray<AutoRoutingModelRef>;
  readonly canEditGlobal: boolean;
  readonly updateRouting: (next: Partial<AutoRoutingSettings>) => void;
  readonly updatePreferred: (next: ReadonlyArray<AutoRoutingModelRef>) => void;
}) {
  const diagnostics = useEnvironmentQuery(
    serverEnvironment.autoRoutingDiagnostics({
      environmentId: props.environmentId,
      input: props.projectId === null ? {} : { projectId: props.projectId as never },
    }),
  );
  const data = diagnostics.data;
  const setHidden = (model: AutoRoutingModelDiagnostic, hidden: boolean) => {
    const rest = props.routing.hiddenModels.filter((ref) => !modelRefMatches(ref, model));
    props.updateRouting({ hiddenModels: hidden ? [...rest, { model: model.model }] : rest });
    diagnostics.refresh();
  };
  const setTier = (model: AutoRoutingModelDiagnostic, tier: number | null) => {
    const rest = props.routing.modelTiers.filter((entry) => entry.model !== model.model);
    props.updateRouting({
      modelTiers: tier === null ? rest : [...rest, { model: model.model, tier }],
    });
    diagnostics.refresh();
  };
  const togglePreferred = (model: AutoRoutingModelDiagnostic) => {
    const exists = props.preferred.some((ref) => modelRefMatches(ref, model));
    props.updatePreferred(
      exists
        ? props.preferred.filter((ref) => !modelRefMatches(ref, model))
        : [...props.preferred, { instanceId: model.instanceId, model: model.model }],
    );
  };

  return (
    <SettingsSection id="auto-routing-models" title="Models">
      {data?.issues.map((issue) => (
        <SettingsRow key={issue} title={issue} />
      ))}
      {diagnostics.error ? (
        <SettingsRow title="Could not load models" description={diagnostics.error} />
      ) : null}
      {(data?.models ?? []).map((model) => {
        const preferred = props.preferred.some((ref) => modelRefMatches(ref, model));
        return (
          <SettingsRow
            key={`${model.instanceId}:${model.model}`}
            title={
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {model.name}
                <Badge variant="outline" size="sm">
                  {model.driver === "codex" ? "Codex" : "Claude"}
                </Badge>
                <Badge variant={model.eligible ? "success" : "secondary"} size="sm">
                  {model.eligible ? "Eligible" : (model.excludedReason ?? "Excluded")}
                </Badge>
              </span>
            }
            description={`${TIER_LABELS[model.tier] ?? model.tier} tier${model.tierSource === "override" ? " (your override)" : ""} · ${model.model}`}
            control={
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {props.canEditGlobal ? (
                  <Select
                    value={model.tierSource === "override" ? String(model.tier) : "catalog"}
                    onValueChange={(value) => {
                      if (value) setTier(model, value === "catalog" ? null : Number(value));
                    }}
                  >
                    <SelectTrigger size="sm" aria-label={`Capability tier for ${model.name}`}>
                      <SelectValue>
                        {model.tierSource === "override" ? TIER_LABELS[model.tier] : "Default tier"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      <SelectItem value="catalog">Default tier</SelectItem>
                      {[1, 2, 3, 4].map((tier) => (
                        <SelectItem key={tier} value={String(tier)}>
                          {TIER_LABELS[tier]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                ) : null}
                <Button
                  size="compact"
                  variant={preferred ? "secondary" : "ghost-muted"}
                  aria-pressed={preferred}
                  onClick={() => togglePreferred(model)}
                >
                  {preferred ? "Preferred" : "Prefer"}
                </Button>
                {props.canEditGlobal ? (
                  <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    Hide from Auto
                    <Switch
                      aria-label={`Hide ${model.name} from Auto`}
                      checked={model.hidden}
                      onCheckedChange={(checked) => setHidden(model, Boolean(checked))}
                    />
                  </label>
                ) : null}
              </div>
            }
          />
        );
      })}
    </SettingsSection>
  );
}

function DecisionSummary({ decision }: { readonly decision: AutoRoutingDecision }) {
  return (
    <div className="grid gap-1 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
        <span className="font-medium">{decision.summary}</span>
        <Badge variant="outline" size="sm">
          {AUTO_ROUTING_KIND_LABELS[decision.kind]}
        </Badge>
      </div>
      <span>
        {decision.complexity} · needs {TIER_LABELS[decision.requiredTier] ?? decision.requiredTier}{" "}
        · {decision.classifier === "ai" ? "AI-classified" : "classified locally"} · confidence{" "}
        {Math.round(decision.confidence * 100)}% · {decision.latencyMs} ms
      </span>
      {decision.usage.some((entry) => entry.maxUsedPercent !== null) ? (
        <span>
          Measured usage:{" "}
          {decision.usage
            .filter((entry) => entry.maxUsedPercent !== null)
            .map((entry) => `${entry.instanceId} ${Math.round(entry.maxUsedPercent!)}%`)
            .join(", ")}
        </span>
      ) : (
        <span>No measured usage reported by providers.</span>
      )}
    </div>
  );
}

function SimulatorSection({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: string | null;
}) {
  const simulate = useAtomCommand(serverEnvironment.autoRoutingSimulate);
  const [text, setText] = useState("");
  const [profile, setProfile] = useState<AutoRoutingProfile | null>(null);
  const [allowAi, setAllowAi] = useState(false);
  const [result, setResult] = useState<AutoRoutingDecision | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const outcome = await simulate({
      environmentId,
      input: {
        text,
        ...(projectId === null ? {} : { projectId: projectId as never }),
        ...(profile === null ? {} : { profile }),
        ...(allowAi ? { allowAiClassification: true } : {}),
      },
    });
    setRunning(false);
    if (AsyncResult.isSuccess(outcome)) setResult(outcome.value);
  };

  return (
    <SettingsSection id="auto-routing-simulator" title="Simulator">
      <SettingsRow
        {...searchableSetting("auto-routing-simulator")}
        description="Try a request to see which model Auto would pick and why. Nothing is sent to a provider unless AI classification runs, and nothing is saved."
      >
        <div className="grid gap-2 pt-2">
          <Textarea
            size="sm"
            value={text}
            placeholder="Describe a task, e.g. “Fix the flaky upload test in src/upload.test.ts”"
            onChange={(event) => setText(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              Use AI classifier
              <Switch
                aria-label="Use AI classifier"
                checked={allowAi}
                onCheckedChange={(checked) => setAllowAi(Boolean(checked))}
              />
            </label>
            <ProfileSelect
              value={profile ?? "balanced"}
              onChange={setProfile}
              label="Simulation profile"
            />
            <Button
              size="compact"
              disabled={running || text.trim().length === 0}
              onClick={() => void run()}
            >
              {running ? "Simulating…" : "Simulate"}
            </Button>
          </div>
          {result ? (
            <div className="grid gap-2 rounded-md border p-2">
              <DecisionSummary decision={result} />
              <div className="grid gap-0.5 text-xs">
                {result.candidates
                  .toSorted((left, right) => (right.score ?? -999) - (left.score ?? -999))
                  .map((candidate) => (
                    <div
                      key={`${candidate.instanceId}:${candidate.model}`}
                      className="flex justify-between gap-2"
                    >
                      <span className={candidate.excluded ? "text-muted-foreground" : undefined}>
                        {candidate.name}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {candidate.excluded ?? `score ${candidate.score}`}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

function HistorySection({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: string | null;
}) {
  const history = useEnvironmentQuery(
    serverEnvironment.autoRoutingHistory({
      environmentId,
      input: { limit: 50, ...(projectId === null ? {} : { projectId: projectId as never }) },
    }),
  );
  const submitFeedback = useAtomCommand(serverEnvironment.autoRoutingSubmitFeedback);
  const clearHistory = useAtomCommand(serverEnvironment.autoRoutingClearHistory);
  const stats = history.data?.stats;

  const rate = async (decision: AutoRoutingDecision, feedback: "good" | "bad") => {
    await submitFeedback({
      environmentId,
      input: {
        decisionId: decision.id,
        feedback: decision.feedback === feedback ? null : feedback,
      },
    });
    history.refresh();
  };

  return (
    <SettingsSection
      id="auto-routing-history"
      title="History"
      headerAction={
        <Button
          size="compact"
          variant="ghost-destructive"
          disabled={!stats || stats.total === 0}
          onClick={async () => {
            const confirmed = await requestConfirmDialog(
              "Clear routing history? This removes every recorded routing decision on this machine.",
            );
            if (!confirmed) return;
            await clearHistory({ environmentId, input: {} });
            history.refresh();
          }}
        >
          Clear
        </Button>
      }
    >
      {stats ? (
        <SettingsRow
          {...searchableSetting("auto-routing-history")}
          description={`${stats.total} decisions · ${stats.providerSwitches} provider switches · ${stats.escalations} escalations · ${stats.fallbacks} fallbacks · ${stats.dryRuns} dry runs · feedback ${stats.feedbackGood} good / ${stats.feedbackBad} bad${stats.averageLatencyMs === null ? "" : ` · ${stats.averageLatencyMs} ms average routing time`}`}
        >
          {stats.byModel.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {stats.byModel.map((entry) => (
                <Badge key={`${entry.instanceId}:${entry.model}`} variant="outline" size="sm">
                  {entry.model} · {entry.count}
                </Badge>
              ))}
            </div>
          ) : null}
        </SettingsRow>
      ) : null}
      {history.error ? (
        <SettingsRow title="Could not load history" description={history.error} />
      ) : null}
      {(history.data?.decisions ?? []).map((decision) => (
        <SettingsRow
          key={decision.id}
          title={<DecisionSummary decision={decision} />}
          description={formatRelativeTimeLabel(decision.createdAt)}
          control={
            <div className="flex items-center gap-0.5">
              <Button
                size="icon-xs"
                variant={decision.feedback === "good" ? "secondary" : "ghost-muted"}
                aria-label="Good routing decision"
                aria-pressed={decision.feedback === "good"}
                onClick={() => void rate(decision, "good")}
              >
                <ThumbsUpIcon />
              </Button>
              <Button
                size="icon-xs"
                variant={decision.feedback === "bad" ? "secondary" : "ghost-muted"}
                aria-label="Poor routing decision"
                aria-pressed={decision.feedback === "bad"}
                onClick={() => void rate(decision, "bad")}
              >
                <ThumbsDownIcon />
              </Button>
            </div>
          }
        />
      ))}
    </SettingsSection>
  );
}

export function AutoRoutingSettingsPanel() {
  const { scope, target } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedPreferences = useScopedSettingsMixed(["autoRoutingPreferences"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const routing = settings.autoRouting;
  const preferences = settings.autoRoutingPreferences;
  const updateRouting = (next: Partial<AutoRoutingSettings>) =>
    updateSettings({ autoRouting: { ...routing, ...next } });
  const updatePreferences = (next: Partial<typeof preferences>) =>
    updateSettings({ autoRoutingPreferences: { ...preferences, ...next } });
  const environmentId = target?.environmentId ?? null;
  const projectId = isProjectScope ? (target?.projectId ?? null) : null;

  return (
    <SettingsPageContainer>
      <SettingsSection id="auto-routing" title="Auto routing">
        {!isProjectScope ? (
          <>
            <SettingsRow
              serverScoped
              settingKeys={["autoRouting"]}
              {...searchableSetting("auto-routing-enabled")}
              description="Adds Auto to the model picker. Auto picks a Claude or Codex model for each turn using your existing subscriptions; other providers are never used."
              resetAction={
                routing.enabled !== DEFAULT_AUTO_ROUTING_SETTINGS.enabled ? (
                  <SettingResetButton
                    label="Auto routing"
                    onClick={() => updateRouting({ enabled: false })}
                  />
                ) : null
              }
              control={
                <Switch
                  aria-label="Enable Auto routing"
                  checked={routing.enabled}
                  onCheckedChange={(checked) => updateRouting({ enabled: Boolean(checked) })}
                />
              }
            />
            <SettingsRow
              serverScoped
              settingKeys={["autoRouting"]}
              {...searchableSetting("auto-routing-default-mode")}
              description="Whether new threads start in Auto or with your manual model. You can switch any thread from the model picker."
              control={
                <Select
                  value={routing.defaultMode}
                  onValueChange={(value) => {
                    if (value) updateRouting({ defaultMode: value });
                  }}
                >
                  <SelectTrigger size="sm" aria-label="New threads start in">
                    <SelectValue>{routing.defaultMode === "auto" ? "Auto" : "Manual"}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="auto">Auto</SelectItem>
                  </SelectPopup>
                </Select>
              }
            />
          </>
        ) : null}
        <SettingsRow
          serverScoped
          settingKeys={["autoRoutingPreferences"]}
          mixed={mixedPreferences}
          {...searchableSetting("auto-routing-profile")}
          description={
            isProjectScope
              ? "Routing profile for this project. Global exclusions and safety rules still apply."
              : "Default routing profile. Projects can override it."
          }
          resetAction={
            preferences.profile !== DEFAULT_AUTO_ROUTING_PREFERENCES.profile ? (
              <SettingResetButton
                label="routing profile"
                onClick={() => updatePreferences({ profile: "balanced" })}
              />
            ) : null
          }
          control={
            <ProfileSelect
              value={mixedPreferences ? null : preferences.profile}
              onChange={(profile) => updatePreferences({ profile })}
              label="Routing profile"
            />
          }
        />
      </SettingsSection>
      {!isProjectScope ? (
        <SettingsSection id="auto-routing-safety" title="Safety">
          <SafetyRows routing={routing} update={updateRouting} />
        </SettingsSection>
      ) : null}
      {environmentId !== null ? (
        <>
          <ModelsSection
            environmentId={environmentId}
            projectId={projectId}
            routing={routing}
            preferred={preferences.preferredModels}
            canEditGlobal={!isProjectScope}
            updateRouting={updateRouting}
            updatePreferred={(preferredModels) =>
              updatePreferences({ preferredModels: [...preferredModels] })
            }
          />
          <SimulatorSection environmentId={environmentId} projectId={projectId} />
          <HistorySection environmentId={environmentId} projectId={projectId} />
        </>
      ) : null}
    </SettingsPageContainer>
  );
}
