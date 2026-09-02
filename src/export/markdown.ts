/**
 * Markdown 出力。
 * ChatGPT / Claude にそのまま貼り付けて分析させることを想定し、
 * 「割合の分母が何か」を必ず本文中に明記する（誤読を防ぐため）。
 * 自由記述の本文は個人情報配慮のため一切出力しない。
 */

import type {
  AnalysisResult,
  Aggregation,
  CrossTabResult,
  Dataset,
  NumericSummary,
} from '../types.ts';
import { cellValue } from '../core/aggregate.ts';
import { formatCell } from '../core/crosstab.ts';
import { isBlank } from '../core/text.ts';

/** クロス集計表の合計行・合計列の見出し */
const TOTAL_LABEL = '合計(実人数)';

/** 表示モードの説明文 */
const MODE_LABELS: Record<CrossTabResult['mode'], string> = {
  count: '実数（人）',
  row: '実数（行%）… 割合の分母は各行の該当者数',
  col: '実数（列%）… 割合の分母は各列の該当者数',
  total: '実数（全体%）… 割合の分母は対象者数の合計',
};

/** 整数部に 3 桁区切りを入れる */
function groupDigits(s: string): string {
  const minus = s.startsWith('-');
  const body = minus ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const intPart = dot >= 0 ? body.slice(0, dot) : body;
  const rest = dot >= 0 ? body.slice(dot) : '';
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (minus ? '-' : '') + grouped + rest;
}

/**
 * 数値を 3 桁区切りの文字列にする。
 * decimals を省略した場合は、整数ならそのまま、小数なら小数第 1 位まで。
 */
function formatNumber(v: number, decimals?: number): string {
  if (!Number.isFinite(v)) return '-';
  const d = decimals ?? (Number.isInteger(v) ? 0 : 1);
  return groupDigits(v.toFixed(d));
}

/** 数値 + 単位。単位が無ければ数値のみ */
function withUnit(v: number, unit: string | undefined, decimals?: number): string {
  return formatNumber(v, decimals) + (unit ?? '');
}

/**
 * Markdown 表のセル内で崩れる文字を無害化する。
 * `|` は表の区切りとして解釈されるためエスケープし、改行はセル内に置けないので空白に潰す。
 */
function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ');
}

/** 「有効回答数: N件（未回答 M件 / 集計対象 K件）」の母数行 */
function baseLine(q: Aggregation): string {
  const target = q.validResponses + q.blankResponses;
  return `有効回答数: ${formatNumber(q.validResponses)}件（未回答 ${formatNumber(
    q.blankResponses,
  )}件 / 集計対象 ${formatNumber(target)}件）`;
}

/** 数値項目の要約統計を箇条書きにする */
function numericLines(s: NumericSummary): string[] {
  const unit = s.unit;
  const countLine =
    s.unparsed > 0
      ? `- 件数: ${formatNumber(s.n)}件（うち数値として読み取れなかった回答 ${formatNumber(
          s.unparsed,
        )}件）`
      : `- 件数: ${formatNumber(s.n)}件`;
  return [
    countLine,
    `- 平均: ${withUnit(s.mean, unit, 1)}`,
    `- 中央値: ${withUnit(s.median, unit, 1)}`,
    `- 最小: ${withUnit(s.min, unit)}`,
    `- 最大: ${withUnit(s.max, unit)}`,
    `- 第1四分位: ${withUnit(s.p25, unit)}`,
    `- 第3四分位: ${withUnit(s.p75, unit)}`,
  ];
}

/** 選択肢の度数表（| 選択肢 | 人数 | 割合 |） */
function optionTable(q: Aggregation): string[] {
  const lines: string[] = ['| 選択肢 | 人数 | 割合 |', '|---|---:|---:|'];
  for (const item of q.items) {
    lines.push(
      `| ${escapeCell(item.label)} | ${formatNumber(item.count)} | ${item.percentage.toFixed(1)}% |`,
    );
  }
  return lines;
}

/** 1 質問分の Markdown ブロック */
function questionBlock(q: Aggregation): string[] {
  const lines: string[] = [`## ${q.question}`, ''];

  if (q.multiple) {
    lines.push('※複数回答（合計が100%を超えることがあります）', '');
  }

  // 母数はどの種別でも必ず書く（割合や件数の解釈に必須のため）
  lines.push(baseLine(q), '');

  if (q.kind === 'free') {
    lines.push(
      `回答件数: ${formatNumber(q.validResponses)}件（本文は個人情報配慮のため出力しません）`,
      '',
    );
    return lines;
  }

  if (q.kind === 'numeric' && q.numeric) {
    lines.push(...numericLines(q.numeric), '');
  }

  if (q.items.length === 0) {
    lines.push('（集計対象となる回答がありません）', '');
    return lines;
  }

  lines.push(...optionTable(q), '');
  return lines;
}

/**
 * 自由記述だけを集めた Markdown（survey-free-text.md）。
 *
 * survey-summary.md は度数集計用で自由記述の本文を出さないため、
 * 定性分析を ChatGPT / Claude にさせるための本文をこちらに分ける。
 *
 * - 集計対象（included）の回答だけを出力する。除外した回答は含めない。
 * - 本文は元データのまま出力し、要約も加工もしない。
 *   氏名・連絡先などを新たに付け足すことはしない（元データにある文字列のみ）。
 * - 見出しの番号は responses.csv の No 列と同じ通し番号なので、
 *   気になる回答を元データで引き直せる。
 * - 自由記述の設問が複数ある場合だけ、本文の前にどの設問かを太字で示す。
 */
export function toFreeTextMarkdown(ds: Dataset): string {
  const freeQuestions = ds.questions.filter((q) => q.kind === 'free');
  const included = ds.rows.filter((row) => row.included);
  const labelEachBody = freeQuestions.length > 1;

  // 回答ごとに「設問ラベルと本文」の組を集める
  const entries = included
    .map((row) => ({
      no: row.id + 1,
      bodies: freeQuestions
        .map((q) => ({ label: q.label, text: cellValue(row, q) }))
        .filter((b) => !isBlank(b.text)),
    }))
    .filter((entry) => entry.bodies.length > 0);

  const lines: string[] = ['# 自由記述回答', ''];
  lines.push(`集計対象回答数: ${included.length}件`);
  lines.push(`自由記述あり: ${entries.length}件`);
  if (freeQuestions.length > 0) {
    lines.push(`対象の設問: ${freeQuestions.map((q) => q.label).join(' / ')}`);
  }
  lines.push('');

  if (freeQuestions.length === 0) {
    lines.push('（自由記述として扱っている設問がありません）', '');
    return lines.join('\n');
  }
  if (entries.length === 0) {
    lines.push('（集計対象の回答に自由記述がありません）', '');
    return lines.join('\n');
  }

  for (const entry of entries) {
    lines.push(`## 回答 ${entry.no}`, '');
    for (const body of entry.bodies) {
      if (labelEachBody) lines.push(`**${body.label}**`, '');
      lines.push(body.text, '');
    }
  }

  return lines.join('\n');
}

/**
 * 集計結果全体を Markdown 化する。
 * 見出し → メタ情報 → 質問ごとの表 → 集計仕様の注記、の順。
 */
export function toMarkdown(a: AnalysisResult): string {
  const lines: string[] = [
    '# 生成AI仕事利用アンケート 集計結果',
    '',
    `- データ名: ${a.sourceName || '（不明）'}`,
    `- 生成日時: ${a.generatedAt}`,
    `- 出力元: ${a.generator}`,
    `- 全回答数: ${formatNumber(a.totalResponses)}件`,
    `- 有効回答数(集計対象): ${formatNumber(a.includedResponses)}件`,
    `- 除外回答数: ${formatNumber(a.excludedResponses)}件`,
    '',
  ];

  for (const q of a.questions) {
    lines.push(...questionBlock(q));
  }

  lines.push(
    '---',
    '',
    '**集計仕様**',
    '',
    '- 割合の分母は各質問の有効回答数（集計対象のうち、その質問に回答した人数）です。未回答は分母に含めていません。',
    '- 複数回答の質問は回答者ベース（延べ選択数ではなく、その選択肢を選んだ実人数）で数えているため、割合の合計は100%を超えます。',
    '- 集計対象から除外した回答は、すべての集計に含めていません。',
    '- 自由記述の本文は個人情報配慮のため出力していません（件数のみ）。',
    '',
  );

  return lines.join('\n');
}

/**
 * クロス集計を Markdown 表にする。
 * セルの表示は crosstab.ts の formatCell に合わせ、画面と同じ内容になるようにする。
 */
export function crossTabToMarkdown(c: CrossTabResult): string {
  const lines: string[] = [
    `## クロス集計: ${c.rowQuestion} × ${c.colQuestion}`,
    '',
    `対象者数（行・列の両方に有効回答）: ${formatNumber(c.grandTotal)}件`,
    `表示: ${MODE_LABELS[c.mode]}`,
    '',
  ];

  if (c.rowMultiple) {
    lines.push('※行の質問は複数回答のため、1人が複数の行に含まれます（行の合計は対象者数を超えます）', '');
  }
  if (c.colMultiple) {
    lines.push('※列の質問は複数回答のため、1人が複数の列に含まれます（列の合計は対象者数を超えます）', '');
  }

  if (c.rowLabels.length === 0 || c.colLabels.length === 0) {
    lines.push('（集計対象となる回答がありません）', '');
    return lines.join('\n');
  }

  const header = [escapeCell(c.rowQuestion), ...c.colLabels.map(escapeCell), TOTAL_LABEL];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|---${c.colLabels.map(() => '|---:').join('')}|---:|`);

  c.rowLabels.forEach((rowLabel, r) => {
    const cells = c.colLabels.map((_, ci) => formatCell(c, r, ci));
    lines.push(
      `| ${escapeCell(rowLabel)} | ${cells.join(' | ')} | ${formatNumber(c.rowTotals[r] ?? 0)} |`,
    );
  });

  const totals = c.colLabels.map((_, ci) => formatNumber(c.colTotals[ci] ?? 0));
  lines.push(`| ${TOTAL_LABEL} | ${totals.join(' | ')} | ${formatNumber(c.grandTotal)} |`);
  lines.push('');

  return lines.join('\n');
}
