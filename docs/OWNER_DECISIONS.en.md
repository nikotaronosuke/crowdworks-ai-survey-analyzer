# Owner Decision Log

[日本語](OWNER_DECISIONS.md) | English

CrowdWorks Survey Analyzer is not just a dashboard for making survey data look clean.

The important part of this project is the boundary between:

> **what the data supports**

and

> **what would require guessing, rewriting, or overclaiming**

This document highlights the project-owner decisions behind that boundary.

---

## 1. Distinguish 99 job records from 92 respondents

### Problem

The analysis unit was not "one person = one row."

Seven respondents submitted a second response about a different job.

Therefore, the final 99 analyzed records came from 92 people.

Calling the dataset "99 respondents" would confuse response count with respondent count.

### Decision

The public article explicitly described the dataset as:

> **99 job records submitted by 92 respondents**

The main analysis unit is one actual job performed with generative AI.

Because some people contributed more than one record, I also avoided using a statistical test that assumes all 99 records are independent as a primary basis for the article's claims.

**Evidence:** [published article](https://poimono.jp/articles/generative-ai-work-survey/)

---

## 2. Exclude an inconsistent record instead of rewriting it into something plausible

### Problem

The survey originally collected 100 job records.

One record could not make all of the following mutually consistent:

- reported job start timing
- reported job period
- release timing of the AI product reported as used for that job

It would have been possible to "repair" the row by guessing a different date or product.

### Decision

I did **not** rewrite the respondent's answer.

That record was excluded from the article analysis.

The analyzer itself also separates:

> exclude from statistics

from:

> delete the original row

Excluded rows disappear from aggregates, charts, cross-tabs, and summary outputs,
but remain in the audit-oriented `responses.csv` with `included=false`.

**Evidence:** README exclusion behavior / `responses.csv` contract / [published article](https://poimono.jp/articles/generative-ai-work-survey/)

---

## 3. Do not put real survey responses in the public repository

### Problem

The CrowdWorks export can contain:

- worker name
- worker profile URL
- work / task id
- free-text answers

Public reproducibility does not require publishing those real records.

### Decision

The repository contains **no real response dataset**.

Samples and test fixtures are synthetic:

- deterministic fixed-seed generation
- fictional worker names
- `example.invalid` URLs
- private-data paths excluded by `.gitignore`

Reproducibility is provided through code and synthetic fixtures,
not by exposing the source respondents.

**Evidence:** README — data handling

---

## 4. Make "fully local" an architectural property, not only a privacy-policy sentence

### Problem

A tool can claim "local processing" while still containing:

- analytics
- network calls
- CDN runtime dependencies
- persistent browser storage

That would require users to inspect implementation details to know what "local" actually means.

### Decision

The runtime intentionally avoids:

- external AI API calls
- `fetch`
- `XMLHttpRequest`
- `WebSocket`
- `navigator.sendBeacon`
- analytics / telemetry
- `localStorage`
- `sessionStorage`
- IndexedDB
- cookies
- CDN runtime dependencies

The standalone build also uses a restrictive CSP including `connect-src 'none'`.

Loaded responses live in process / browser memory and disappear when the page is closed.

**Evidence:** README — local processing / SPEC — privacy prohibitions

---

## 5. Remove worker identity from the analysis path structurally, not only visually

### Problem

Hiding worker names in the UI is not enough.

If identity columns still behave like ordinary survey questions,
they can leak later through another export or AI-facing Markdown.

### Decision

CrowdWorks management columns are typed separately from survey questions.

Identity-bearing fields are treated as ignored analysis fields,
so they are structurally excluded from:

- summary statistics
- charts
- cross-tabs
- `summary.csv`
- `analysis.json`
- `survey-summary.md`
- `survey-free-text.md`

Worker name / profile URL / work id are also hidden by default in the response view.

The distinction is:

> **not shown in this screen**

versus

> **not part of the statistical / AI-facing data model**

I chose the latter.

**Evidence:** SPEC — `src/core/identity.ts`

---

## 6. Use each question's valid-response count as its denominator

### Problem

Different questions can have different numbers of unanswered rows.

Using the total dataset size as every denominator would mix two different questions:

- "what percentage of everyone in the dataset?"
- "what percentage of people who answered this question?"

Multi-select questions add another complication because one respondent may legitimately count in several options.

### Decision

For normal question percentages, the denominator is:

> **valid responses to that question**

Unanswered rows are excluded from that question's denominator.

For multi-select questions:

- counting is respondent-based
- duplicate occurrences of the same option for one respondent are deduplicated
- totals can exceed 100%

The denominator is displayed together with the statistic.

**Evidence:** README — aggregation rules / SPEC — `aggregate.ts`

---

## 7. Isolate CrowdWorks' 321-column export format in one adapter

### Problem

CrowdWorks does not export selection questions as a simple "one question = one column" table.

Its export can contain pairs such as:

- option number column
- human-readable label column

and repeat those pairs for multi-select branches.

A real file examined during development had 321 columns.

If every downstream component understood that layout,
platform-specific parsing would spread across the entire application.

### Decision

The CrowdWorks adapter normalizes the input to:

> **one logical survey question = one logical column**

before aggregation, charting, crosstabs, and export.

The response row count is preserved.

CrowdWorks-specific structure remains inside `src/core/adapters/crowdworks.ts`.

**Evidence:** README — CrowdWorks CSV format / SPEC — CrowdWorks adapter

---

## 8. Treat ambiguous free-text parsing as "unparsed", not zero or a guessed number

### Problem

The work-time question was free text.

Some forms are safe enough to parse:

- 3 hours
- 1.5 hours
- about 3 hours

Others are not:

- bare `8` with no unit
- "3 weeks"
- "1 minute to apply, 3 minutes to do the task"

Grabbing the first number would produce a larger dataset but can assign the wrong meaning.

### Decision

Only explicitly supported forms produce a derived numeric / categorical value.

Anything else becomes:

> **unparsed**

It is not zero.
It is not missing.
It is not silently coerced.

The original free-text answer remains unchanged in `responses.csv`.

This makes parsing failure visible as part of the analysis instead of hiding it.

**Evidence:** README — Q11 derived fields / SPEC — `worktime.ts`

---

## 9. Normalize AI product names conservatively

### Problem

Free-text product names contain spelling variants.

Some are clearly the same product:

- ChatGPT
- chat gpt
- チャットGPT

Other strings are ambiguous or historically meaningful:

- Bard vs Gemini
- bare Copilot
- OpenAI
- GPT-4

Aggressively merging them would create a cleaner chart at the cost of changing what respondents actually wrote.

### Decision

Normalization is limited to **obvious spelling variants of the same product**.

Examples of deliberate non-merges:

- Bard is not silently changed to Gemini
- bare Copilot is not guessed as GitHub Copilot or Microsoft Copilot
- generic OpenAI / GPT labels are not automatically turned into ChatGPT

Cleaning the category labels is less important than avoiding invented meaning.

**Evidence:** README — AI-name normalization policy

---

## 10. Pair every chart with the underlying numeric table

### Problem

Charts are useful for scanning patterns, but visual choices can influence perception:

- axis
- order
- color
- area
- scale

A PNG alone can also make later auditing harder.

### Decision

Every chart is paired with the numeric table it represents.

Exports also include machine-readable / tabular forms such as:

- `summary.csv`
- `cross-tab.csv`
- `analysis.json`
- `survey-summary.md`

Visualization is an interface to the result, not a replacement for the numbers.

**Evidence:** README — chart behavior / SPEC — UI requirements

---

## 11. Do not make average hourly pay the headline metric just because it can be calculated

### Problem

The dataset contains compensation and work-time information,
so an average hourly-rate estimate can be computed.

But the inputs include:

- free-text time
- ambiguous units in some responses
- a very large 210-hour answer
- compensation bands rather than exact pay for many jobs

A single mean can hide those assumptions and outliers.

### Decision

The public article did **not** use average hourly pay as the primary headline metric.

It focused instead on observable distributions such as:

- compensation bands
- share of jobs taking 3+ / 5+ / 10+ hours
- median work time
- explicit notes about parsing and outliers

The decision was:

> **a metric being computable does not automatically make it the most defensible summary**

**Evidence:** [published article](https://poimono.jp/articles/generative-ai-work-survey/)

---

## 12. Describe cross-tab associations without turning them into causal claims

### Problem

The analysis found that the high-AI-usage group also had a higher share of responses saying:

> "I probably would not have accepted this job without AI."

It would be tempting to write:

> using more AI makes people able to accept more jobs

But the survey cannot establish that causal direction.

The reverse explanation is also plausible:
jobs that are especially AI-suitable may both use more AI and be less likely to have been accepted without it.

### Decision

The article stated the observed relationship only:

> **in these 99 job records, the higher-AI-usage groups had a higher share of that response**

It did not claim causation.

Because the 99 job records came from 92 people and subgroup sizes were limited,
independence-based statistical testing was also not used as the main rhetorical foundation.

The crosstab is a tool for examining relationships,
not an automatic conclusion generator.

**Evidence:** [published article](https://poimono.jp/articles/generative-ai-work-survey/) / SPEC — crosstab

---

## What this project prioritizes

CrowdWorks Survey Analyzer prioritizes:

- not confusing records with people
- not rewriting inconsistent source answers
- keeping excluded records auditable
- not publishing real respondent data
- structurally excluding identity from statistics and AI-facing exports
- showing the denominator behind each percentage
- respondent-based counting for multi-select questions
- visible "unparsed" states instead of forced numeric conversion
- conservative normalization
- numeric tables behind visual charts
- defensible metrics over attention-grabbing metrics
- observed association over unsupported causal language

AI-assisted implementation and analysis were used during the project.

The important part I wanted the repository to preserve is **where the analysis stops making claims**.
