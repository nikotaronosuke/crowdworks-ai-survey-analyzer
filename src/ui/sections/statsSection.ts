/**
 * 2. 全体サマリーと「認識した列一覧」セクション。
 *
 * 何件を集計しているのか（母数）と、各列をツールがどう解釈したのかを
 * 最初に見せる。ここが合っていないと、以降の集計はすべて誤読になるため。
 */

import type { Aggregation, QuestionDef } from '../../types.ts';
import type { AppState, Section } from '../app.ts';
import { el, fmtInt } from '../components/dom.ts';
import { QUESTION_KIND_LABELS } from './summarySection.ts';

/** 区切り文字を人が読める形にする */
function delimiterLabel(delimiter: string): string {
  switch (delimiter) {
    case '\t':
      return 'タブ (TSV)';
    case ',':
      return 'カンマ (CSV)';
    case ';':
      return 'セミコロン';
    case '|':
      return 'パイプ';
    default:
      return delimiter === '' ? '（不明）' : `"${delimiter}"`;
  }
}

/** 数値タイルを1つ作る */
function statTile(label: string, value: string): HTMLElement {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'label' }, [label]),
    el('span', { class: 'value' }, [value]),
  ]);
}

/** 「選択肢数」列の表示。集計できない種別は "-" にする */
function optionCountText(q: QuestionDef, agg: Aggregation | undefined): string {
  if (q.kind === 'ignore' || q.kind === 'free') return '-';
  if (!agg) return '-';
  return `${fmtInt(agg.items.length)}種類`;
}

/** 認識した列一覧のテーブルを作る */
function buildColumnTable(questions: QuestionDef[], byKey: Map<string, Aggregation>): HTMLElement {
  const rows = questions.map((q) => {
    const nameCell: (Node | string)[] = [q.header];
    if (q.label !== q.header) {
      nameCell.push(el('span', { class: 'muted' }, [`（${q.label}）`]));
    }

    const originCell: (Node | string)[] = q.inferred
      ? [el('span', { class: 'badge warn' }, ['自動推定'])]
      : [
          el('span', { class: 'badge ok' }, ['マッピング']),
          el('span', { class: 'muted' }, [q.profileKey ?? '']),
        ];

    return el('tr', undefined, [
      el('th', { scope: 'row', class: 'wrap' }, nameCell),
      el('td', undefined, [QUESTION_KIND_LABELS[q.kind]]),
      el('td', undefined, originCell),
      el('td', { class: 'num' }, [optionCountText(q, byKey.get(q.key))]),
    ]);
  });

  const table = el('table', undefined, [
    el('caption', { class: 'table-caption' }, [
      '「種別」はこのあとの集計方法を決めます。誤っている列は「4. 基本集計」で変更できます。',
    ]),
    el('thead', undefined, [
      el('tr', undefined, [
        el('th', { scope: 'col' }, ['列名']),
        el('th', { scope: 'col' }, ['判定された種別']),
        el('th', { scope: 'col' }, ['判定の由来']),
        el('th', { scope: 'col', class: 'num' }, ['選択肢数']),
      ]),
    ]),
    el('tbody', undefined, rows),
  ]);

  return el('div', { class: 'table-wrap' }, [table]);
}

/**
 * サマリーセクションを作る。
 * 表示専用なので AppContext は受け取らない。
 */
export function createStatsSection(): Section {
  const body = el('div');

  const element = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', undefined, ['2. 読み込み結果と列の判定'])]),
    body,
  ]);

  return {
    element,
    render(state: AppState): void {
      const ds = state.dataset;
      if (!ds) {
        body.replaceChildren(
          el('p', { class: 'empty' }, ['データを読み込むと、ここに件数と列の判定結果が出ます。']),
        );
        return;
      }

      const included = ds.rows.reduce((n, r) => (r.included ? n + 1 : n), 0);
      const excluded = ds.rows.length - included;

      const byKey = new Map<string, Aggregation>();
      for (const agg of state.analysis?.questions ?? []) {
        byKey.set(agg.key, agg);
      }

      body.replaceChildren(
        el('div', { class: 'stats' }, [
          statTile('全回答数', `${fmtInt(ds.rows.length)}件`),
          statTile('集計対象', `${fmtInt(included)}件`),
          statTile('除外', `${fmtInt(excluded)}件`),
        ]),
        el('div', { class: 'row' }, [
          el('span', { class: 'badge' }, [`データ名: ${ds.sourceName}`]),
          el('span', { class: 'badge' }, [`区切り文字: ${delimiterLabel(ds.delimiter)}`]),
          el('span', { class: 'badge' }, [`列数: ${fmtInt(ds.headers.length)}`]),
          // CrowdWorks の2列セット構造を畳み込んだ場合は、その旨を明示する
          ds.sourceFormat === 'crowdworks'
            ? el('span', { class: 'badge ok' }, ['CrowdWorks形式を検出しました'])
            : null,
        ]),
        el('h3', undefined, ['認識した列一覧']),
        buildColumnTable(ds.questions, byKey),
      );
    },
  };
}
