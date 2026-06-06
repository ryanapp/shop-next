"use client";

import { useEffect, useState, useTransition } from "react";

type RuleHistoryItem = {
  id: string;
  source: string;
  slug: string;
  version: number;
  status: string;
  testResults: string | null;
  createdAt: string;
};

type GenerationResult = {
  id: string;
  status: string;
  accepted: boolean;
  testResults: string;
};

export function RuleConsole() {
  const [prompt, setPrompt] = useState("");
  const [editingRule, setEditingRule] = useState<RuleHistoryItem | null>(null);
  const [rules, setRules] = useState<RuleHistoryItem[]>([]);
  const [latestResult, setLatestResult] = useState<GenerationResult | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    setLatestResult(null);

    startTransition(async () => {
      const endpoint = editingRule
        ? `/api/rules/${editingRule.id}/edit`
        : "/api/rules";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt })
      });

      const data = (await response.json()) as
        | GenerationResult
        | { error: string };

      if (!response.ok || "error" in data) {
        setError("error" in data ? data.error : "Rule generation failed.");
        return;
      }

      setLatestResult(data);
      setPrompt("");
      setEditingRule(null);
      await loadRules();
    });
  }

  function runLifecycleAction(rule: RuleHistoryItem, action: string) {
    setError(null);
    setLatestResult(null);

    startTransition(async () => {
      const response = await fetch(`/api/rules/${rule.id}/${action}`, {
        method: "POST"
      });
      const data = (await response.json()) as
        | { rule: RuleHistoryItem }
        | { error: string };

      if (!response.ok || "error" in data) {
        setError("error" in data ? data.error : `${action} failed.`);
        return;
      }

      setLatestResult({
        id: data.rule.id,
        status: data.rule.status,
        accepted: data.rule.status === "ACTIVE",
        testResults: `${action} completed for v${data.rule.version}.`
      });
      await loadRules();
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
          <p className="form-note">Editing v{editingRule.version} as a new version.</p>
        ) : null}
        <button disabled={isPending || prompt.trim() === ""} type="submit">
          {isPending
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

      {latestResult ? (
        <section className="rule-result" aria-label="Latest generation result">
          <h2>Latest result</h2>
          <p>
            Status: <strong>{latestResult.status}</strong>
          </p>
          <pre>{latestResult.testResults}</pre>
        </section>
      ) : null}

      <section className="rule-history" aria-label="Rule history">
        <h2>Rule history</h2>
        {rules.length === 0 ? (
          <p>No generated rules yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Prompt</th>
                <th>Version</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.source}</td>
                  <td>v{rule.version}</td>
                  <td>
                    <span className="status-label">{rule.status}</span>
                  </td>
                  <td>
                    <div className="rule-actions">
                      {rule.status === "ACTIVE" ? (
                        <button
                          disabled={isPending}
                          onClick={() => runLifecycleAction(rule, "disable")}
                          type="button"
                        >
                          Disable
                        </button>
                      ) : null}
                      {rule.status === "DISABLED" ? (
                        <button
                          disabled={isPending}
                          onClick={() => runLifecycleAction(rule, "activate")}
                          type="button"
                        >
                          Enable
                        </button>
                      ) : null}
                      <button
                        disabled={isPending}
                        onClick={() => {
                          setEditingRule(rule);
                          setPrompt(rule.source);
                        }}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        disabled={isPending}
                        onClick={() => runLifecycleAction(rule, "delete")}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
