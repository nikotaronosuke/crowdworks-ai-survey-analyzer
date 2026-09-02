/**
 * 集計表・クロス集計表の描画。
 * 「母数（何人中の割合か）」を必ず表に添えることで、
 * 割合だけが独り歩きしないようにしている。
 */

import type { Aggregation, CrossTabMode, CrossTabResult } from '../../types.ts';
import { formatCell } from '../../core/crosstab.ts';
import { el, fmtInt, fmtNum, fmtPct } from './dom.ts';

/** 空表示のメッセージ行を作る（colSpan 付きの1行だけの tbody 用） */
function emptyRow(colSpan: number, message: string): HTMLTableRowElement {
  return el('tr', undefined, [
    el('td', { class: 'empty', colSpan }, [message]),
  ]);
}

/** 数値と単位を読みやすい形にする（整数はそのまま、小数は第1位まで） */
function fmtValueWithUnit(value: number, unit?: string): string {
  const text = Number.isInteger(value) ? fmtInt(value) : fmtNum(value, 1);
  return unit ? `${text}${unit}` : text;
}

/**
 * 1質問の集計表を描画する。
 * 列は「選択肢 / 人数 / 割合」。caption に有効回答数・未回答数・延べ選択数を出し、
 * 複数回答なら "※複数回答" バッジを付ける（割合の合計が100%を超えるため）。
 */
export function renderAggregationTable(a: Aggregation): HTMLElement {
  const captionChildren: (Node | string)[] = [
    `有効回答数: ${fmtInt(a.validResponses)}件 / 未回答 ${fmtInt(a.blankResponses)}件 / ` +
      `延べ選択数 ${fmtInt(a.totalSelections)}件`,
  ];
  if (a.multiple) {
    captionChildren.push(
      el('span', { class: 'badge', title: '1人が複数の選択肢を選べるため、割合の合計は100%を超えることがあります' }, [
        '※複数回答',
      ]),
    );
  }

  const caption = el('caption', { class: 'table-caption' }, captionChildren);

  const thead = el('thead', undefined, [
    el('tr', undefined, [
      el('th', { scope: 'col' }, ['選択肢']),
      el('th', { scope: 'col', class: 'num' }, ['人数']),
      el('th', { scope: 'col', class: 'num' }, ['割合']),
    ]),
  ]);

  const bodyRows: HTMLTableRowElement[] =
    a.items.length === 0
      ? [emptyRow(3, '（集計対象の選択肢がありません）')]
      : a.items.map((item) =>
          el('tr', undefined, [
            el('th', { scope: 'row' }, [item.label]),
            el('td', { class: 'num' }, [fmtInt(item.count)]),
            el('td', { class: 'num' }, [fmtPct(item.percentage, 1)]),
          ]),
        );

  const tbody = el('tbody', undefined, bodyRows);

  const children: (Node | string)[] = [caption, thead, tbody];

  if (a.items.length > 0) {
    // 複数回答は延べ数の合計になるため、100%超をそのまま出す（丸めて隠さない）。
    const countSum = a.items.reduce((sum, item) => sum + item.count, 0);
    const pctSum = a.items.reduce((sum, item) => sum + item.percentage, 0);
    children.push(
      el('tfoot', undefined, [
        el('tr', undefined, [
          el('th', { scope: 'row' }, [a.multiple ? '合計（延べ）' : '合計']),
          el('td', { class: 'num' }, [fmtInt(countSum)]),
          el('td', { class: 'num' }, [fmtPct(pctSum, 1)]),
        ]),
      ]),
    );
  }

  const table = el('table', { class: 'agg-table' }, children);
  return el('div', { class: 'table-wrap' }, [table]);
}

/** 表示モードの日本語ラベル */
function modeLabel(mode: CrossTabMode): string {
  switch (mode) {
    case 'count':
      return '実数';
    case 'row':
      return '行内%';
    case 'col':
      return '列内%';
    case 'total':
      return '全体%';
  }
}

/**
 * クロス集計表を描画する。
 * 左上セルは "行質問 \ 列質問"、行ヘッダーは class 'rowhead'（CSS で sticky）。
 * 各セルは crosstab.ts の formatCell に任せ、行末・最終行に実人数の合計を出す。
 */
export function renderCrossTabTable(c: CrossTabResult): HTMLElement {
  if (c.rowLabels.length === 0 || c.colLabels.length === 0) {
    return el('div', { class: 'table-wrap' }, [
      el('p', { class: 'empty' }, ['（クロス集計できるデータがありません）']),
    ]);
  }

  const captionChildren: (Node | string)[] = [
    `行: ${c.rowQuestion} / 列: ${c.colQuestion} / ` +
      `有効回答者数: ${fmtInt(c.grandTotal)}件 / 表示: ${modeLabel(c.mode)}`,
  ];
  if (c.rowMultiple || c.colMultiple) {
    captionChildren.push(
      el('span', { class: 'badge', title: '複数回答を含むため、セルの合計は実人数と一致しません' }, [
        '※複数回答',
      ]),
    );
  }

  const headerCells: HTMLTableCellElement[] = [
    el('th', { class: 'corner', scope: 'col' }, [`${c.rowQuestion} \\ ${c.colQuestion}`]),
    ...c.colLabels.map((label) => el('th', { scope: 'col', class: 'num' }, [label])),
    el('th', { scope: 'col', class: 'num' }, ['合計(実人数)']),
  ];

  const thead = el('thead', undefined, [el('tr', undefined, headerCells)]);

  const bodyRows = c.rowLabels.map((rowLabel, r) =>
    el('tr', undefined, [
      el('th', { class: 'rowhead', scope: 'row' }, [rowLabel]),
      ...c.colLabels.map((_, colIndex) =>
        el('td', { class: 'num' }, [formatCell(c, r, colIndex)]),
      ),
      el('td', { class: 'num total' }, [fmtInt(c.rowTotals[r] ?? 0)]),
    ]),
  );

  const tfoot = el('tfoot', undefined, [
    el('tr', undefined, [
      el('th', { class: 'rowhead', scope: 'row' }, ['合計(実人数)']),
      ...c.colLabels.map((_, colIndex) =>
        el('td', { class: 'num total' }, [fmtInt(c.colTotals[colIndex] ?? 0)]),
      ),
      el('td', { class: 'num total' }, [fmtInt(c.grandTotal)]),
    ]),
  ]);

  const table = el('table', { class: 'crosstab-table' }, [
    el('caption', { class: 'table-caption' }, captionChildren),
    thead,
    el('tbody', undefined, bodyRows),
    tfoot,
  ]);

  return el('div', { class: 'table-wrap crosstab-wrap' }, [table]);
}

/**
 * 数値項目の要約統計を定義リストで描画する。
 * numeric が無い集計（single / multiple / free など）では null を返す。
 */
export function renderNumericSummary(a: Aggregation): HTMLElement | null {
  const s = a.numeric;
  if (!s) return null;

  const unit = s.unit;
  const entries: [string, string][] = [
    ['件数', `${fmtInt(s.n)}件`],
    ['平均', fmtValueWithUnit(s.mean, unit)],
    ['中央値', fmtValueWithUnit(s.median, unit)],
    ['最小', fmtValueWithUnit(s.min, unit)],
    ['最大', fmtValueWithUnit(s.max, unit)],
    ['第1四分位', fmtValueWithUnit(s.p25, unit)],
    ['第3四分位', fmtValueWithUnit(s.p75, unit)],
    ['合計', fmtValueWithUnit(s.sum, unit)],
  ];
  if (s.unparsed > 0) {
    // 数値化できなかった回答があることを隠さず出す（母数の透明性のため）。
    entries.push(['数値化できず', `${fmtInt(s.unparsed)}件`]);
  }

  const dlChildren: Node[] = [];
  for (const [term, value] of entries) {
    dlChildren.push(el('dt', undefined, [term]));
    dlChildren.push(el('dd', undefined, [value]));
  }

  return el('div', { class: 'numeric-summary' }, [el('dl', undefined, dlChildren)]);
}
