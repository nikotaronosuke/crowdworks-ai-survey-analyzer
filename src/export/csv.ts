/**
 * CSV 出力。
 * すべて RFC4180 準拠（区切りはカンマ、改行は CRLF、"" によるエスケープ）で組み立てる。
 * BOM は付けない（Excel 向けの BOM 付与は download.ts の責務）。
 */

import type { AnalysisResult, CrossTabResult, Dataset } from '../types.ts';

/** クロス集計 CSV / 回答一覧 CSV で使う合計列の見出し */
const TOTAL_LABEL = '合計(実人数)';

/**
 * CSV の 1 セルをエスケープする。
 * 値にダブルクォート・カンマ・改行（CR/LF）が含まれる場合だけ `"` で囲み、
 * 内部の `"` は `""` に置き換える（RFC4180）。
 */
export function csvEscape(v: string | number): string {
  const s = typeof v === 'string' ? v : String(v);
  if (/["\r\n,]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 2 次元配列を CSV 文字列にする。
 * セルはカンマ結合、行は CRLF で連結する（末尾に改行は付けない）。
 */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

/**
 * summary.csv を作る。
 * ヘッダー: question,option,count,percentage,valid_responses,multiple_choice
 * 1 質問につき選択肢の数だけ行を出す。
 * 選択肢が無い質問（自由記述や、有効回答が 0 件の質問）も
 * 「質問が消える」ことがないよう 1 行だけ出力する。
 */
export function toSummaryCsv(a: AnalysisResult): string {
  const rows: (string | number)[][] = [
    ['question', 'option', 'count', 'percentage', 'valid_responses', 'multiple_choice'],
  ];

  for (const q of a.questions) {
    const multiple = q.multiple ? 'true' : 'false';
    if (q.items.length === 0) {
      // 自由記述は選択肢を持たないので回答件数のみを 1 行で示す。
      // それ以外（誰も回答していない質問）は「回答なし」として痕跡を残す。
      const isFree = q.kind === 'free';
      const label = isFree ? '(自由記述)' : '(回答なし)';
      const count = isFree ? q.validResponses : 0;
      const percentage = isFree && q.validResponses > 0 ? 100 : 0;
      rows.push([
        q.question,
        label,
        count,
        percentage.toFixed(2),
        q.validResponses,
        multiple,
      ]);
      continue;
    }
    for (const item of q.items) {
      rows.push([
        q.question,
        item.label,
        item.count,
        item.percentage.toFixed(2),
        q.validResponses,
        multiple,
      ]);
    }
  }

  return toCsv(rows);
}

/**
 * cross-tab.csv を作る。
 * 1 行目は集計条件を書いた `#` 始まりのコメント行（1 セル）。
 * 2 行目がヘッダー、最終行が列合計。
 */
export function toCrossTabCsv(c: CrossTabResult): string {
  const rows: (string | number)[][] = [];

  // コメント行は 1 セルだけの行として出す（読み込み側で `#` 始まりを無視できる）
  rows.push([
    `# 行: ${c.rowQuestion} / 列: ${c.colQuestion} / 有効回答者数: ${c.grandTotal} / 表示: ${c.mode}`,
  ]);

  rows.push([c.rowQuestion, ...c.colLabels, TOTAL_LABEL]);

  c.rowLabels.forEach((rowLabel, r) => {
    const counts = c.counts[r] ?? [];
    const cells: (string | number)[] = c.colLabels.map((_, ci) => counts[ci] ?? 0);
    rows.push([rowLabel, ...cells, c.rowTotals[r] ?? 0]);
  });

  const colTotals: (string | number)[] = c.colLabels.map((_, ci) => c.colTotals[ci] ?? 0);
  rows.push([TOTAL_LABEL, ...colTotals, c.grandTotal]);

  return toCsv(rows);
}

/**
 * responses.csv を作る。
 * 先頭に表示用の通し番号 "No"、末尾に集計対象かどうかの列を付け、
 * 間は元データの列をそのまま出す（編集後の状態を再現できるようにするため）。
 */
export function toResponsesCsv(ds: Dataset, hiddenColumns?: Iterable<number>): string {
  // 表示をOFFにした識別情報の列だけを落とす。設問の出力選択には影響されない
  // （このファイルは監査用なので、全設問・全回答を残すのが既定）。
  const hidden = new Set<number>(hiddenColumns ?? []);
  const columns: number[] = [];
  for (let i = 0; i < ds.headers.length; i++) {
    if (!hidden.has(i)) columns.push(i);
  }

  const rows: (string | number)[][] = [
    ['No', ...columns.map((i) => ds.headers[i] ?? ''), 'included'],
  ];

  // 監査・再確認用なので、除外した回答も削除せず全件そのまま残す。
  // 集計対象かどうかは included 列（true / false）で判別する。
  // No は ResponseRow.id 由来なので、列を落としても回答と元行の対応は崩れない。
  for (const row of ds.rows) {
    const values = columns.map((i) => row.values[i] ?? '');
    rows.push([row.id + 1, ...values, row.included ? 'true' : 'false']);
  }

  return toCsv(rows);
}
