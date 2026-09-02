/**
 * 4. 基本集計セクション。
 *
 * 「7. 出力する項目」で選ばれている質問について、集計表（と数値要約）を並べる。
 * 自動判定はあくまで推定なので、見出し横の <select> でその場で種別を変更でき、
 * 変更すると Dataset の QuestionDef を書き換えて全体を再集計する。
 */

import { SAFE_DELIMITERS } from '../../core/splitter.ts';
import type { Aggregation, ChartKind, QuestionDef, QuestionKind } from '../../types.ts';
import type { AppContext, AppState, Section } from '../app.ts';
import { el } from '../components/dom.ts';
import { renderAggregationTable, renderNumericSummary } from '../components/table.ts';

/** 質問種別の日本語ラベル（列一覧・種別セレクトで共用する） */
export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  single: '単一選択',
  multiple: '複数選択',
  numeric: '数値',
  free: '自由記述',
  ignore: '対象外',
};

/** セレクトに並べる順序 */
const KIND_ORDER: QuestionKind[] = ['single', 'multiple', 'numeric', 'free', 'ignore'];

/** 種別を変えたときの既定グラフ。細かい調整は「5. グラフ」側で行う */
function defaultChartForKind(kind: QuestionKind): ChartKind {
  switch (kind) {
    case 'multiple':
      return 'hbar';
    case 'single':
    case 'numeric':
      return 'bar';
    case 'free':
    case 'ignore':
      return 'none';
  }
}

/**
 * 基本集計セクションを作る。
 * @param ctx 種別変更後の再集計に使う
 */
export function createSummarySection(ctx: AppContext): Section {
  const body = el('div');

  const element = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', undefined, ['4. 基本集計']),
      el('span', { class: 'note' }, ['種別を変えると、集計・グラフ・クロス集計がすべて作り直されます。']),
    ]),
    body,
  ]);

  /** 質問の種別を変更して再集計する */
  function applyKind(q: QuestionDef, kind: QuestionKind): void {
    if (q.kind === kind) return;
    q.kind = kind;
    // 複数回答にしたときだけセルを分割する。誤爆の少ない SAFE_DELIMITERS を使う。
    q.delimiters = kind === 'multiple' ? [...SAFE_DELIMITERS] : [];
    q.chart = defaultChartForKind(kind);
    ctx.refresh(`「${q.label}」の種別を「${QUESTION_KIND_LABELS[kind]}」に変更しました。`);
  }

  /** 種別変更用のセレクトを作る */
  function kindSelect(q: QuestionDef): HTMLSelectElement {
    const select = el('select', { title: 'この質問の集計方法を変更します' });
    for (const kind of KIND_ORDER) {
      select.appendChild(el('option', { value: kind }, [QUESTION_KIND_LABELS[kind]]));
    }
    select.value = q.kind;
    select.addEventListener('change', () => {
      applyKind(q, select.value as QuestionKind);
    });
    return select;
  }

  /** 質問1件分のブロックを作る */
  function questionBlock(q: QuestionDef, agg: Aggregation | undefined): HTMLElement {
    const head = el('div', { class: 'question-head' }, [
      el('h3', undefined, [q.label]),
      q.inferred
        ? el('span', { class: 'badge warn' }, ['自動推定'])
        : el('span', { class: 'badge ok' }, ['マッピング']),
      el('span', { class: 'field' }, [
        el('span', { class: 'field-label' }, ['種別']),
        kindSelect(q),
      ]),
    ]);

    const children: (Node | string)[] = [head];

    if (q.label !== q.header) {
      children.push(el('p', { class: 'note' }, [`元の列名: ${q.header}`]));
    }

    if (!agg) {
      children.push(el('p', { class: 'note' }, ['この質問は集計対象外です。']));
    } else {
      children.push(renderAggregationTable(agg));
      const numeric = renderNumericSummary(agg);
      if (numeric) children.push(numeric);
      if (agg.kind === 'free') {
        children.push(
          el('p', { class: 'note' }, [
            `自由記述のため度数集計は行いません（回答 ${agg.validResponses}件）。本文は画面上の「3. 回答一覧」で確認してください。`,
          ]),
        );
      }
    }

    return el('div', { class: 'question-block' }, children);
  }

  return {
    element,
    render(state: AppState): void {
      const ds = state.dataset;
      const analysis = state.analysis;
      if (!ds || !analysis) {
        body.replaceChildren(
          el('p', { class: 'empty' }, ['データを読み込むと、質問ごとの集計表が出ます。']),
        );
        return;
      }

      const byKey = new Map<string, Aggregation>();
      for (const agg of analysis.questions) {
        byKey.set(agg.key, agg);
      }

      const frag = document.createDocumentFragment();
      // 「7. 出力する項目」で外した設問は表を出さない（グラフ・各出力と足並みを揃える）。
      // 外した設問はそのセクションのチェックを入れ直せば戻る。
      const active = ds.questions.filter((q) => q.kind !== 'ignore' && q.selected);
      for (const q of active) {
        frag.appendChild(questionBlock(q, byKey.get(q.key)));
      }
      if (active.length === 0) {
        frag.appendChild(
          el('p', { class: 'empty' }, [
            '出力対象の設問がありません。「7. 出力する項目」でチェックを入れてください。',
          ]),
        );
      }

      // 対象外にした列も、種別セレクトだけは残しておく（戻せなくならないように）。
      // 識別情報・管理列は「出力する項目」で扱うので、ここの種別変更には出さない
      // （自由記述などに切り替えられると AI 向け出力へ個人情報が載ってしまうため）。
      const ignored = ds.questions.filter((q) => q.kind === 'ignore' && !q.identity);
      if (ignored.length > 0) {
        frag.appendChild(el('h3', undefined, ['集計対象外にした列']));
        for (const q of ignored) {
          frag.appendChild(
            el('div', { class: 'row' }, [
              el('span', undefined, [q.label]),
              el('span', { class: 'field' }, [
                el('span', { class: 'field-label' }, ['種別']),
                kindSelect(q),
              ]),
            ]),
          );
        }
      }

      body.replaceChildren(frag);
    },
  };
}
