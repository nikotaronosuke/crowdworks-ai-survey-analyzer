# Design decisions

English | [日本語](design-decisions.md)

This document was organized retrospectively on 2026-09-20 from the published article and the existing specification. It is not a contemporaneous decision log. Each item is limited to claims that can be checked against the linked public material.

## 1. Treat the analysis unit as one job, not one person

The analyzed dataset contains 99 job records from 92 respondents because seven people submitted a second response about a different job.

The article therefore describes **99 jobs from 92 respondents**, not 99 independent people, and does not use an independence-based test across all 99 records as the basis for its claims.

**Evidence:** [published article](https://poimono.jp/articles/generative-ai-work-survey/)

## 2. Exclude the inconsistent record instead of repairing it by guess

One of the original 100 records could not make the reported job timing and AI-product release timing mutually consistent.

The date or product name was not rewritten into a plausible answer. The record was excluded from the article analysis. In the tool, exclusion is separate from deletion: the audit-oriented `responses.csv` keeps all rows and exports `included=true/false`.

**Evidence:** [published article](https://poimono.jp/articles/generative-ai-work-survey/) / [responses.csv contract](SPEC.md#srcexportcsvts)

## 3. Do not let the automatic work-time parser guess ambiguous values

Work time is free text. The automatic parser derives a value only from forms that can be interpreted unambiguously, such as `3 hours`.

Unitless values such as `8`, descriptions that cannot be reduced to a unique day count, and sentences containing multiple times with different meanings remain **unparsed**. They are not converted to zero or missing, and the source text is preserved.

The published article separately states that four unitless values were explicitly interpreted as hours for that analysis. That is an editorial analysis choice made outside the automatic parser, not silent inference by the parser itself.

**Evidence:** [work-time parser contract](SPEC.md#srccoreworktimets--実際の作業時間の派生値) / [published article](https://poimono.jp/articles/generative-ai-work-survey/)

## 4. Do not make computable metrics or associations stronger than the data supports

Compensation was often reported in bands, work time came from free text, and one record reported 210 hours.

The article therefore did not use average hourly pay as the headline metric. It focused more directly on compensation bands, work-time distributions, and the median.

Likewise, the cross-tab showing a higher share of "would not have accepted without AI" among higher-AI-usage jobs was described as an **association in this dataset**, not as causation. The 99 records came from 92 respondents, so an independence-based test across all records was not used as the rhetorical foundation.

**Evidence:** [published article](https://poimono.jp/articles/generative-ai-work-survey/)
