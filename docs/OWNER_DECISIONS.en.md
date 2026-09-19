# Owner Decision Log

[日本語](OWNER_DECISIONS.md) | English

The most important decisions in this project were about what the dataset could support as a claim. Four are worth keeping.

## 1. Described the dataset as 99 job records from 92 respondents

Seven people submitted a second response about a different job, so 99 analyzed records did not mean 99 independent people.

The analysis unit was one job, and independence-based testing across all 99 records was not used as the rhetorical foundation.

**Evidence:** [published article](https://poimono.jp/articles/generative-ai-work-survey/)

## 2. Excluded one inconsistent record instead of repairing it by guess

One of the original 100 records could not make the reported job timing and AI-product release timing mutually consistent.

The date or product name was not rewritten into a plausible answer. The record was excluded from the article analysis.

In the tool, exclusion is also separate from deletion: `responses.csv` preserves the row with `included=false`.

**Evidence:** [published article](https://poimono.jp/articles/generative-ai-work-survey/) / [responses.csv contract](SPEC.md#srcexportcsv)

## 3. Kept ambiguous work-time text as "unparsed"

Some free-text values were safe to interpret, such as "3 hours."

Others — a bare number, "3 weeks", or multiple different time values in one sentence — were not.

The parser does not grab the first number. Ambiguous values remain **unparsed**, separate from zero and missing, while the original text is preserved.

**Evidence:** [worktime parser contract](SPEC.md#srccoreworktimets--実際の作業時間の派生値)

## 4. Did not make average hourly pay or causal language the headline

Compensation was often reported in bands, work time came from free text, and one record reported 210 hours.

Average hourly pay was therefore not used as the main headline metric; the article emphasized compensation bands, time distributions, and the median.

Likewise, a cross-tab association between AI usage and "would not have accepted without AI" was described as an association in this dataset, not as causation.

**Evidence:** [published article](https://poimono.jp/articles/generative-ai-work-survey/)
