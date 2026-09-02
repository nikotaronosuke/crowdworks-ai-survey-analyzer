/**
 * 3. 回答一覧セクション。
 *
 * 1行ずつ中身を確認しながら、テスト回答や明らかな不正回答を
 * チェックボックスで集計から外せるようにする。
 * チェックを変えるとその場で再集計され、基本集計・グラフ・クロス集計に反映される。
 */

import type { ResponseRow } from '../../types.ts';
import { visibleColumnIndexes } from '../../core/identity.ts';
import type { AppContext, AppState, Section } from '../app.ts';
import { el, fmtInt } from '../components/dom.ts';

/** 一度に描画する最大行数。これを超える分は検索で絞ってもらう */
const MAX_VISIBLE_ROWS = 200;

/** セル表示を省略する文字数。全文は title 属性に入れる */
const CELL_LIMIT = 40;

/**
 * 回答一覧セクションを作る。
 * @param ctx 再集計（ctx.refresh）を呼ぶために使う
 */
export function createResponsesSection(ctx: AppContext): Section {
  // 直近の状態。ボタン操作から参照するので保持しておく。
  let current: AppState | null = null;
  // 表を作り直しても見ている位置が変わらないよう、スクロール量を覚えておく。
  let scrollTop = 0;
  let scrollLeft = 0;

  const counters = el('span', { class: 'note' });
  const tableHost = el('div');

  const search = el('input', {
    type: 'search',
    placeholder: '全列を対象に検索（大文字・小文字は区別しません）',
    size: 36,
  });

  search.addEventListener('input', () => {
    ctx.store.update((s) => ({ ...s, responseFilter: search.value }));
  });

  /** 検索条件に合う行を返す */
  function filterRows(state: AppState): ResponseRow[] {
    const ds = state.dataset;
    if (!ds) return [];
    const needle = state.responseFilter.trim().toLowerCase();
    if (needle === '') return ds.rows;
    return ds.rows.filter((row) => row.values.some((v) => v.toLowerCase().includes(needle)));
  }

  /** 件数表示を更新する（チェック操作のたびに呼ぶ） */
  function updateCounters(state: AppState, visibleCount: number): void {
    const ds = state.dataset;
    if (!ds) {
      counters.textContent = '';
      return;
    }
    const included = ds.rows.reduce((n, r) => (r.included ? n + 1 : n), 0);
    counters.textContent =
      `全 ${fmtInt(ds.rows.length)}件 / 検索一致 ${fmtInt(visibleCount)}件 / ` +
      `集計対象 ${fmtInt(included)}件 / 除外 ${fmtInt(ds.rows.length - included)}件`;
  }

  /** 1行分の <tr> を作る */
  function buildRow(
    row: ResponseRow,
    columns: number[],
    state: AppState,
    visibleCount: number,
  ): HTMLTableRowElement {
    const checkbox = el('input', {
      type: 'checkbox',
      checked: row.included,
      title: 'チェックを外すとこの回答を集計から除外します',
    });

    const cells: HTMLTableCellElement[] = [
      el('td', undefined, [checkbox]),
      el('td', { class: 'num' }, [String(row.id + 1)]),
    ];

    for (const i of columns) {
      const raw = row.values[i] ?? '';
      const shown = raw.length > CELL_LIMIT ? `${raw.slice(0, CELL_LIMIT)}…` : raw;
      cells.push(el('td', raw === '' ? undefined : { title: raw }, [shown]));
    }

    const tr = el('tr', row.included ? undefined : { class: 'excluded' }, cells);

    checkbox.addEventListener('change', () => {
      row.included = checkbox.checked;
      tr.classList.toggle('excluded', !row.included);
      updateCounters(state, visibleCount);
      ctx.refresh();
    });

    return tr;
  }

  /** 表本体を作り直す（スクロール位置は復元する） */
  function renderTable(state: AppState): void {
    const ds = state.dataset;
    if (!ds) {
      tableHost.replaceChildren(
        el('p', { class: 'empty' }, ['データを読み込むと、ここに回答一覧が出ます。']),
      );
      updateCounters(state, 0);
      return;
    }

    const matched = filterRows(state);
    const visible = matched.slice(0, MAX_VISIBLE_ROWS);
    updateCounters(state, matched.length);

    // 表示をOFFにした識別情報の列は出さない。
    // 値は Dataset 側に残るので、集計対象／除外の切り替えには影響しない。
    const columns = visibleColumnIndexes(ds, state.identityVisible);

    const headerCells: HTMLTableCellElement[] = [
      el('th', { scope: 'col', title: 'チェックを外すと集計から除外します' }, ['対象']),
      el('th', { scope: 'col', class: 'num' }, ['No']),
      ...columns.map((i) => {
        const h = ds.headers[i] ?? '';
        return el('th', { scope: 'col', title: h }, [
          h.length > CELL_LIMIT ? `${h.slice(0, CELL_LIMIT)}…` : h,
        ]);
      }),
    ];

    const tbody = el('tbody');
    if (visible.length === 0) {
      tbody.appendChild(
        el('tr', undefined, [
          el('td', { class: 'empty', colSpan: columns.length + 2 }, [
            '検索条件に一致する回答がありません。',
          ]),
        ]),
      );
    } else {
      // 行数が多いので、一度 DocumentFragment に組んでから1回だけ挿す。
      const frag = document.createDocumentFragment();
      for (const row of visible) {
        frag.appendChild(buildRow(row, columns, state, matched.length));
      }
      tbody.appendChild(frag);
    }

    const table = el('table', undefined, [
      el('thead', undefined, [el('tr', undefined, headerCells)]),
      tbody,
    ]);

    const wrap = el('div', { class: 'table-wrap' }, [table]);
    wrap.addEventListener('scroll', () => {
      scrollTop = wrap.scrollTop;
      scrollLeft = wrap.scrollLeft;
    });

    const children: Node[] = [];
    if (matched.length > MAX_VISIBLE_ROWS) {
      children.push(
        el('p', { class: 'note warn' }, [
          `一致した ${fmtInt(matched.length)}件のうち、先頭 ${fmtInt(MAX_VISIBLE_ROWS)}件だけを表示しています。` +
            '先に検索で絞り込んでください（「すべて対象」「すべて除外」は表示外の回答にも効きます）。',
        ]),
      );
    }
    children.push(wrap);
    tableHost.replaceChildren(...children);

    wrap.scrollTop = scrollTop;
    wrap.scrollLeft = scrollLeft;
  }

  /** 全行、または検索一致行の集計対象を一括で切り替える */
  function bulkSet(target: 'all' | 'matched', included: boolean): void {
    const state = current;
    if (!state || !state.dataset) return;
    const rows = target === 'all' ? state.dataset.rows : filterRows(state);
    for (const row of rows) {
      row.included = included;
    }
    renderTable(state);
    ctx.refresh(
      `${fmtInt(rows.length)}件の回答を${included ? '集計対象に' : '集計から除外に'}しました。`,
    );
  }

  const buttons = [
    el('button', { class: 'btn', type: 'button', on: { click: () => bulkSet('all', true) } }, [
      'すべて対象',
    ]),
    el('button', { class: 'btn', type: 'button', on: { click: () => bulkSet('all', false) } }, [
      'すべて除外',
    ]),
    el('button', { class: 'btn', type: 'button', on: { click: () => bulkSet('matched', true) } }, [
      '表示中をすべて対象',
    ]),
    el('button', { class: 'btn', type: 'button', on: { click: () => bulkSet('matched', false) } }, [
      '表示中をすべて除外',
    ]),
  ];

  const element = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', undefined, ['3. 回答一覧（集計対象の選択）']),
      counters,
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'field' }, [el('span', { class: 'field-label' }, ['検索']), search]),
      ...buttons,
    ]),
    tableHost,
    el('p', { class: 'note' }, [
      'チェックを外した回答は、基本集計・グラフ・クロス集計・エクスポートのすべてから外れます。長いセルはマウスを載せると全文が出ます。',
    ]),
  ]);

  return {
    element,
    render(state: AppState): void {
      current = state;
      // 入力中のカーソル位置を壊さないよう、値が違うときだけ書き戻す。
      if (search.value !== state.responseFilter) search.value = state.responseFilter;
      for (const button of buttons) {
        button.disabled = state.dataset === null;
      }
      renderTable(state);
    },
  };
}
