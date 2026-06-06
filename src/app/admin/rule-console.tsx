"use client";

import { useEffect, useState, useTransition } from "react";
import { groupRulesBySlug } from "../../lib/rules/grouping";
import {
  applyRulePipelineEvent,
  createInitialPipelineState,
  startRulePipeline,
  type RulePipelineEvent,
  type RulePipelineStep
} from "../../lib/rules/pipeline-status";

type RuleHistoryItem = {
  id: string;
  source: string;
  slug: string;
  version: number;
  status: string;
  testResults: string | null;
  createdAt: string;
};

type LifecycleResponse =
  | {
      rule: RuleHistoryItem;
    }
  | {
      error: string;
    };

type StreamEvent = RulePipelineEvent;

export function RuleConsole() {
  const [prompt, setPrompt] = useState("");
  const [editingRule, setEditingRule] = useState<RuleHistoryItem | null>(null);
  const [rules, setRules] = useState<RuleHistoryItem[]>([]);
  const [finalMessage, setFinalMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerationRun, setHasGenerationRun] = useState(false);
  const [pipeline, setPipeline] = useState(createInitialPipelineState);
  const [isPending, startTransition] = useTransition();
  const groupedRules = groupRulesBySlug(rules);

  async function loadRules() {
    const response = await fetch("/api/rules", { cache: "no-store" });

    if (!response.ok) {
      setError("Could not load rule history.");
      return;
    }

    const data = (await response.json()) as { rules: RuleHistoryItem[] };
    setRules(data.rules);
  }

  useEffect(() => {
    void loadRules();
  }, []);

  function submitRule() {
    setError(null);
    setFinalMessage(null);
    setHasGenerationRun(true);
    setPipeline(startRulePipeline());
    setIsGenerating(true);

    void (async () => {
      const response = await fetch("/api/rules/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          editRuleId: editingRule?.id
        })
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as
          | { error: string }
          | null;
        setError(data?.error ?? "Rule generation failed.");
        setIsGenerating(false);
        return;
      }

      await readGenerationStream(response.body);
      setPrompt("");
      setEditingRule(null);
      await loadRules();
      setIsGenerating(false);
    })().catch((streamError: unknown) => {
      setError(
        streamError instanceof Error
          ? streamError.message
          : "Rule generation failed."
      );
      setIsGenerating(false);
    });
  }

  async function readGenerationStream(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim().length === 0) {
          continue;
        }

        handleStreamEvent(JSON.parse(line) as StreamEvent);
      }
    }
  }

  function handleStreamEvent(event: StreamEvent) {
    setPipeline((current) => applyRulePipelineEvent(current, event));

    if (event.type === "result") {
      setFinalMessage(
        event.result.accepted
          ? `${prompt} generated and enabled.`
          : `${prompt} was not enabled.`
      );
    }
  }

  function runLifecycleAction(rule: RuleHistoryItem, action: string) {
    setError(null);
    setFinalMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/rules/${rule.id}/${action}`, {
          method: "POST"
        });
        const data = (await response
          .json()
          .catch(() => null)) as LifecycleResponse | null;

        if (!response.ok || !data || "error" in data) {
          setError(data && "error" in data ? data.error : `${action} failed.`);
          return;
        }

        setFinalMessage(`${action} completed for v${data.rule.version}.`);
        await loadRules();
      } catch (lifecycleError: unknown) {
        setError(
          lifecycleError instanceof Error
            ? lifecycleError.message
            : `${action} failed.`
        );
      }
    });
  }

  return (
    <div className="rule-console">
      <form
        className="promotion-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitRule();
        }}
      >
        <label>
          <span>Promotion prompt</span>
          <textarea
            name="prompt"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Give 10% off tea when the basket total is over £30"
            rows={7}
            value={prompt}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        {editingRule ? (
          <p className="form-note">
            Editing v{editingRule.version} as a new version.
          </p>
        ) : null}
        <button
          disabled={isPending || isGenerating || prompt.trim() === ""}
          type="submit"
        >
          {isGenerating
            ? "Working..."
            : editingRule
              ? "Generate edited version"
              : "Generate rule"}
        </button>
        {editingRule ? (
          <button
            onClick={() => {
              setEditingRule(null);
              setPrompt("");
            }}
            type="button"
          >
            Cancel edit
          </button>
        ) : null}
      </form>

      {hasGenerationRun ? (
        <section className="rule-result rule-pipeline" aria-label="Generation status">
          <div className="rule-pipeline-status">
            <h2>Status</h2>
            <ol>
              {pipeline.steps.map((step) => (
                <PipelineStepItem key={step.id} step={step} />
              ))}
            </ol>
          </div>
          <div className="rule-console-output">
            <h2>{pipeline.consoleTitle}</h2>
            <pre>{pipeline.consoleOutput}</pre>
            {finalMessage ? (
              <p className="pipeline-final-message">{finalMessage}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rule-history" aria-label="Rule history">
        <h2>Rule history</h2>
        {rules.length === 0 ? (
          <p>No generated rules yet.</p>
        ) : (
          <div className="rule-groups">
            {groupedRules.map((group) => (
              <section className="rule-group" key={group.slug}>
                <div className="rule-group-heading">
                  <h3>
                    {group.activeRule?.source ?? group.versions[0]?.source}
                  </h3>
                  <span>
                    {group.versions.length} version
                    {group.versions.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="rule-version-list">
                  {group.versions.map((rule) => (
                    <article className="rule-version-row" key={rule.id}>
                      <div>
                        <p className="product-category">v{rule.version}</p>
                        <h4>{rule.source}</h4>
                      </div>
                      <span className="status-label">{rule.status}</span>
                      <RuleActions
                        isPending={isPending || isGenerating}
                        onEdit={() => {
                          setEditingRule(rule);
                          setPrompt(rule.source);
                        }}
                        onRunAction={(action) =>
                          runLifecycleAction(rule, action)
                        }
                        rule={rule}
                      />
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RuleActions({
  isPending,
  onEdit,
  onRunAction,
  rule
}: {
  isPending: boolean;
  onEdit: () => void;
  onRunAction: (action: string) => void;
  rule: RuleHistoryItem;
}) {
  return (
    <div className="rule-actions">
      {rule.status === "ACTIVE" ? (
        <button
          disabled={isPending}
          onClick={() => onRunAction("disable")}
          type="button"
        >
          Disable
        </button>
      ) : null}
      {rule.status === "DISABLED" ? (
        <button
          disabled={isPending}
          onClick={() => onRunAction("activate")}
          type="button"
        >
          Enable
        </button>
      ) : null}
      <button disabled={isPending} onClick={onEdit} type="button">
        Edit
      </button>
      <button
        disabled={isPending}
        onClick={() => onRunAction("delete")}
        type="button"
      >
        Delete
      </button>
    </div>
  );
}

function PipelineStepItem({ step }: { step: RulePipelineStep }) {
  return (
    <li className={`pipeline-step pipeline-step-${step.status.toLowerCase()}`}>
      <span aria-hidden="true">
        {step.status === "RUNNING" ? <i /> : statusSymbol(step.status)}
      </span>
      <div>
        <strong>{step.label}</strong>
        <small>{step.status}</small>
      </div>
    </li>
  );
}

function statusSymbol(status: RulePipelineStep["status"]): string {
  if (status === "PASSED") {
    return "✓";
  }

  if (status === "FAILED") {
    return "!";
  }

  if (status === "RUNNING") {
    return "•";
  }

  return "○";
}
