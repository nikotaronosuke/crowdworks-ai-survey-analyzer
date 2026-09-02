/**
 * 6. クロス集計セクション。
 *
 * 縦軸・横軸・表示モードを選ぶだけの薄い画面。集計自体は core/crosstab.ts に任せる。
 * 割合が独り歩きしないよう、母数（行・列の両方に有効回答した人数）を必ず添える。
 */

import { crossTabulate } from '../../core/crosstab.ts';
import type { CrossTabMode, QuestionDef } from '../../types.ts';
import type { AppContext, AppState, Section } from '../app.ts';
import { el, fmtInt } from '../components/dom.ts';
import { renderCrossTabTable } from '../components/table.ts';

/** 表示モードの日本語ラベル */
const MODE_LABELS: Record<CrossTabMode, string> = {
  count: '件数',
  row: '行%（行内の割合）',
  col: '列%（列内の割合）',
  total: '全体%（母数に対する割合）',
};

const MODE_ORDER: CrossTabMode[] = ['count', 'row', 'col', 'total'];

/**
 * クロス集計の軸に使える質問か判定する。
 * 自由記述と対象外は選択肢が定まらないため軸にできない。
 */
export function isCrossEligible(q: QuestionDef): boolean {
  return q.kind === 'single' || q.kind === 'multiple' || q.kind === 'numeric';
}

/**
 * クロス集計セクションを作る。
 * @param ctx 軸・表示モードの変更をストアへ書き戻すために使う
 */
export function createCrosstabSection(ctx: AppContext): Section {
  const controls = el('div', { class: 'row' });
  const body = el('div');

  const element = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', undefined, ['6. クロス集計'])]),
    controls,
    body,
  ]);

  /** 質問を選ぶセレクトを作る */
  function questionSelect(
    questions: QuestionDef[],
    selected: string,
    onChange: (key: string) => void,
  ): HTMLSelectElement {
    const select = el('select');
    for (const q of questions) {
      select.appendChild(el('option', { value: q.key }, [q.label]));
    }
    select.value = selected;
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  return {
    element,
    render(state: AppState): void {
      const ds = state.dataset;
      if (!ds) {
        controls.replaceChildren();
        body.replaceChildren(
          el('p', { class: 'empty' }, ['データを読み込むと、2つの質問を掛け合わせて比べられます。']),
        );
        return;
      }

      const eligible = ds.questions.filter(isCrossEligible);
      if (eligible.length < 2) {
        controls.replaceChildren();
        body.replaceChildren(
          el('p', { class: 'empty' }, [
            'クロス集計に使える質問（単一選択・複数選択・数値）が2つ以上必要です。',
          ]),
        );
        return;
      }

      const rowSelect = questionSelect(eligible, state.crossRow, (key) => {
        ctx.store.update((s) => ({ ...s, crossRow: key }));
      });
      const colSelect = questionSelect(eligible, state.crossCol, (key) => {
        ctx.store.update((s) => ({ ...s, crossCol: key }));
      });

      const modeSelect = el('select', { title: 'セルに表示する値を切り替えます' });
      for (const mode of MODE_ORDER) {
        modeSelect.appendChild(el('option', { value: mode }, [MODE_LABELS[mode]]));
      }
      modeSelect.value = state.crossMode;
      modeSelect.addEventListener('change', () => {
        const mode = modeSelect.value as CrossTabMode;
        ctx.store.update((s) => ({ ...s, crossMode: mode }));
      });

      controls.replaceChildren(
        el('span', { class: 'field' }, [el('span', { class: 'field-label' }, ['縦軸']), rowSelect]),
        el('span', { class: 'field' }, [el('span', { class: 'field-label' }, ['横軸']), colSelect]),
        el('span', { class: 'field' }, [el('span', { class: 'field-label' }, ['表示']), modeSelect]),
        el(
          'button',
          {
            class: 'btn',
            type: 'button',
            title: '縦軸と横軸を入れ替えます',
            on: {
              click: () =>
                ctx.store.update((s) => ({ ...s, crossRow: s.crossCol, crossCol: s.crossRow })),
            },
          },
          ['縦横を入れ替え'],
        ),
      );

      try {
        const result = crossTabulate(ds, state.crossRow, state.crossCol, state.crossMode);
        const included = ds.rows.reduce((n, r) => (r.included ? n + 1 : n), 0);
        body.replaceChildren(
          el('p', { class: 'note' }, [
            `母数（縦軸・横軸の両方に有効回答した人）: ${fmtInt(result.grandTotal)}件 ` +
              `／ 集計対象 ${fmtInt(included)}件中`,
          ]),
          renderCrossTabTable(result),
        );
      } catch (error) {
        body.replaceChildren();
        ctx.reportError('クロス集計に失敗しました', error);
      }
    },
  };
}
