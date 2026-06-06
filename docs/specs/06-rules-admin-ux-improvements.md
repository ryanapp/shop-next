# Specification: Rules Admin UX Improvements

## Objective

Improve the rules admin screen so a shop manager can watch Codex generate a rule, understand verification progress, and manage grouped rule versions from the main workspace.

## Scope

- Codex generation streaming in the admin UI.
- A single generation status section with an ordered pipeline checklist.
- A single console that shows the output for the current pipeline step.
- Hierarchical rule history grouped by slug family.
- Main-container layout for the prompt form, status/console workspace, and grouped rule history.

## Streaming Generation

The admin submit flow should show live progress while a rule is generated.

The stream should include:

- Codex text/progress output as it is received.
- Status changes for generation phases such as `POLICY_REVIEW`, `GENERATING`, `SOURCE_REVIEW`, `TESTING`, `ACTIVATING`, `ACTIVE`, and `FAILED`.
- The final generation result using the same accepted/failed semantics as `POST /api/rules`.

The runtime path must still call Codex/LLM. Streaming is additive; it must not replace the Codex generation requirement with a deterministic local fallback.

Implementation may use Server-Sent Events, a streamed `fetch` response, or a job/status endpoint pair. The chosen interface must remain gated by the same route-level `shop-manager` authorization rules as `/api/rules/**`.

## Status And Console Experience

The admin UI should not render separate panels for Codex output, generated tests, built-in tests, and latest result. Instead, it should render one status workspace after generation starts.

The status workspace contains:

- A `Status` checklist showing every pipeline activity in execution order.
- A single console showing the output for the current or most recently completed activity.
- A final message below the console when the pipeline finishes.

The checklist must include, at minimum:

- Prompt policy review.
- Codex rule generation.
- Source validation and policy review of generated source.
- Generated rule tests: the generated Vitest spec plus the system-owned safety test.
- Rule activation: registering the verified rule and disabling older active versions in the same slug family.
- Built-in app tests: the project's normal app test suite, currently `npm test`, unless a narrower documented app-test command is introduced.

Each checklist step should show one of:

- `PENDING`
- `RUNNING`
- `PASSED`
- `FAILED`

The status icon should communicate state visually:

- Pending: inactive outlined circle.
- Running: animated spinner/dot indicator inside the circle.
- Passed: checkmark inside the circle.
- Failed: failure marker inside the circle.

The console should not duplicate old panels. It should show the output for the current step only, replacing its content as the pipeline advances:

- Policy review step: policy review message or rejection reason.
- Codex generation step: streamed Codex text/progress output.
- Source validation step: source validation and policy-review message.
- Generated-rule tests step: command, exit code, stdout, and stderr for the generated Vitest command.
- Activation step: activation message.
- Built-in app tests step: command, exit code, stdout, and stderr for `npm test`.

When the pipeline finishes, show a short final message below the console:

- Success example: `{promotion prompt} generated and enabled.`
- Failure example: `{promotion prompt} was not enabled.`

Do not keep a separate `Latest result` panel. Lifecycle operations such as delete, enable, and disable may show concise completion/error feedback, but they must not make the generation status workspace appear or reset unless a generation is actually running.

Rule activation remains gated by the existing generated-rule verification requirement from spec 04. Built-in app test status is displayed to the merchant/operator; if implementation chooses to make built-in app test failure block activation, that behavior must be explicit in tests and UI copy.

Do not run `npm run build` from the runtime rule-generation request path. The live demo development server and Next production build both use `.next`; running production builds inside the active generation workflow can corrupt the dev server's chunk cache. `npm run build` remains a developer verification command, not a merchant-facing runtime status step.

## Hierarchical Rule View

Replace the flat rule history table with grouped rule families.

Grouping rules:

- Group by `slug`.
- Show the currently `ACTIVE` version at the top of the group.
- Show other versions below it, ordered by newest version first.
- If no version is active, show the newest version at the top.
- Preserve clear version labels, status labels, and lifecycle controls from spec 05.

Lifecycle controls continue to behave as before:

- Active versions can be disabled.
- Verified disabled versions can be enabled.
- Any version can be edited as a new version.
- Rules can be deleted.

## Layout

All capabilities in this spec must appear in the main admin container, not a sidebar.

The main workspace should include:

- Promotion prompt form.
- Single status checklist and console workspace, visible only after generation starts.
- Grouped rule history.

The layout should use the available admin width for scanning and comparison. Keep the interface operational and dense enough for repeated use; avoid landing-page or marketing composition.

The admin shell itself should not reuse the login page's two-column layout. The rule console must sit in the main content width, not a narrow right column.

## API And Data Shape

Add or extend API support for streaming/status without breaking existing lifecycle routes.

Acceptable approaches:

- Add `POST /api/rules/stream` returning a streamed response.
- Add a create-job endpoint plus `GET /api/rules/:id/events`.
- Extend `POST /api/rules` only if existing non-streaming behavior remains compatible for tests and callers.

The UI-facing generation/status payload should distinguish:

- phase/status events for policy review, Codex generation, source review, generated tests, activation, app tests, success, and failure
- streamed Codex text output
- generated test results
- built-in app test results
- final rule `status`
- final `accepted` value

All new `/api/rules/**` routes require route-level `shop-manager` checks.

## Dependencies

- [Discount Rule Engine And Codex Pipeline](04-discount-rule-engine-and-codex-pipeline.md)
- [Rule Lifecycle And Cart Recalculation](05-rule-lifecycle-and-cart-recalculation.md)

## Out Of Scope

- Merchant-authored JavaScript editing.
- Bulk rule operations.
- Replacing Codex with a non-LLM generator.
- Checkout/payment changes beyond using the existing shared active-rule pricing path.

## Acceptance Criteria

- The admin UI streams Codex output/progress while a rule is being generated.
- The admin UI renders a single status checklist and a single current-step console, not multiple output cards.
- The checklist includes policy review, Codex generation, source validation, generated-rule tests, activation, and built-in app tests.
- The currently running checklist step has an animated spinner/dot indicator inside its icon.
- Generated-rule test output and built-in app test output appear in the single console when those steps run.
- A final message appears under the console after completion, for example `{promotion prompt} generated and enabled.`
- There is no separate `Latest result` panel.
- Rule history is grouped by slug family.
- The active version appears first in each group.
- Lifecycle controls still work from the grouped view.
- Lifecycle controls do not show or reset the generation status workspace unless a generation actually starts.
- The streaming/status APIs are protected by route-level `shop-manager` authorization.
- The main admin workspace contains the prompt form, status/console workspace, and grouped rule view.
- Meaningful tests cover grouping/order, streaming/status authorization, pipeline status transitions, generated-test output mapping, app-test output mapping, and lifecycle controls in grouped history.
- `npm test` passes.
- `npm run build` is clean.
