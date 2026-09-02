/**
 * 5. グラフセクション。
 *
 * グラフだけでは読み取りを誤りやすいので、必ず同じカードの中に数値表を併記する。
 * 生成した Chart は Map<質問キー, Chart> に保持し、
 * 「すべてのグラフをPNG保存」（7. エクスポート）から参照できるようにしてある。
 * 再描画のたびに古い Chart は destroy する（canvas の使い回しとメモリリークを防ぐ）。
 */

import type { Chart } from 'chart.js';
import { downloadBlob } from '../../export/download.ts';
import { chartToPngBlob } from '../../export/png.ts';
import type { Aggregation, ChartKind, QuestionDef } from '../../types.ts';
import type { AppContext, AppState, Section } from '../app.ts';
import {
  applyChartColors,
  createChartFor,
  currentChartColors,
  suggestedChartHeight,
} from '../charts/chart.ts';
import { el, fmtInt } from '../components/dom.ts';
import { renderAggregationTable } from '../components/table.ts';

/** 表示中の Chart。キーは質問キー（PNG のファイル名にも使う） */
const chartRegistry = new Map<string, Chart>();

/**
 * 現在表示中の Chart インスタンス一覧を返す。
 * エクスポートセクションが「すべてのグラフをPNG保存」で使う。
 * 返すのは実体の Map なので、呼び出し側は書き換えないこと。
 */
export function getChartRegistry(): Map<string, Chart> {
  return chartRegistry;
}

// OS のライト／ダーク設定が表示中に切り替わったら、
// 描画済みのグラフの文字・目盛り色も追随させる（作り直しはしない）。
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const colors = currentChartColors();
    for (const chart of chartRegistry.values()) {
      applyChartColors(chart, colors);
      chart.update('none');
    }
  });
}

/** グラフ種別の日本語ラベル */
const CHART_KIND_LABELS: Record<ChartKind, string> = {
  bar: '縦棒',
  hbar: '横棒',
  pie: '円',
  line: '折れ線',
  none: '非表示',
};

const CHART_KIND_ORDER: ChartKind[] = ['bar', 'hbar', 'pie', 'line', 'none'];

/** 描画予定のグラフ（DOM に挿してから Chart を生成するため一旦ためる） */
interface PendingChart {
  key: string;
  canvas: HTMLCanvasElement;
  aggregation: Aggregation;
  kind: ChartKind;
  pngButton: HTMLButtonElement;
}

/**
 * グラフセクションを作る。
 * @param ctx グラフ種別の変更（QuestionDef.chart の書き換え）と PNG 保存の失敗表示に使う
 */
export function createChartsSection(ctx: AppContext): Section {
  const body = el('div');

  const element = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', undefined, ['5. グラフ']),
      el('span', { class: 'note' }, ['グラフの下に必ず同じ内容の数値表を出しています。']),
    ]),
    body,
  ]);

  /** 表示中の Chart をすべて破棄する */
  function destroyCharts(): void {
    for (const chart of chartRegistry.values()) {
      chart.destroy();
    }
    chartRegistry.clear();
  }

  /** グラフ種別のセレクトを作る */
  function chartKindSelect(q: QuestionDef): HTMLSelectElement {
    const select = el('select', { title: 'グラフの種類を変更します' });
    for (const kind of CHART_KIND_ORDER) {
      select.appendChild(el('option', { value: kind }, [CHART_KIND_LABELS[kind]]));
    }
    select.value = q.chart;
    select.addEventListener('change', () => {
      const next = select.value as ChartKind;
      if (q.chart === next) return;
      q.chart = next;
      ctx.refresh();
    });
    return select;
  }

  /** グラフ1件分のカードを作る（Chart 本体は DOM 挿入後に生成する） */
  function chartPanel(q: QuestionDef, agg: Aggregation, pending: PendingChart[]): HTMLElement {
    const canvas = el('canvas');
    const box = el('div', { class: 'chart-box' }, [canvas]);
    box.style.height = `${suggestedChartHeight(agg, q.chart)}px`;

    const pngButton = el('button', { class: 'btn small', type: 'button' }, ['PNG保存']);
    pngButton.disabled = true;
    pngButton.addEventListener('click', () => {
      const chart = chartRegistry.get(q.key);
      if (!chart) return;
      chartToPngBlob(chart)
        .then((blob) => downloadBlob(`${q.key}.png`, blob))
        .catch((error: unknown) => ctx.reportError(`「${q.label}」のPNG保存に失敗しました`, error));
    });

    pending.push({ key: q.key, canvas, aggregation: agg, kind: q.chart, pngButton });

    return el('div', { class: 'chart-panel' }, [
      el('div', { class: 'question-head' }, [
        el('h3', undefined, [q.label]),
        el('span', { class: 'field' }, [
          el('span', { class: 'field-label' }, ['グラフ']),
          chartKindSelect(q),
        ]),
        pngButton,
      ]),
      el('p', { class: 'chart-meta' }, [
        `有効回答 ${fmtInt(agg.validResponses)}件 / 未回答 ${fmtInt(agg.blankResponses)}件` +
          (agg.multiple ? ' ／ 複数回答（合計は100%を超えることがあります）' : ''),
      ]),
      box,
      renderAggregationTable(agg),
    ]);
  }

  return {
    element,
    render(state: AppState): void {
      destroyCharts();

      const ds = state.dataset;
      const analysis = state.analysis;
      if (!ds || !analysis) {
        body.replaceChildren(
          el('p', { class: 'empty' }, ['データを読み込むと、質問ごとのグラフが出ます。']),
        );
        return;
      }

      const byKey = new Map<string, Aggregation>();
      for (const agg of analysis.questions) {
        byKey.set(agg.key, agg);
      }

      const pending: PendingChart[] = [];
      const grid = el('div', { class: 'grid-2' });
      const hidden: QuestionDef[] = [];

      for (const q of ds.questions) {
        if (q.kind === 'ignore' || q.kind === 'free') continue;
        const agg = byKey.get(q.key);
        if (!agg || agg.items.length === 0) continue;
        if (q.chart === 'none') {
          hidden.push(q);
          continue;
        }
        grid.appendChild(chartPanel(q, agg, pending));
      }

      const children: Node[] = [];
      if (pending.length === 0) {
        children.push(el('p', { class: 'empty' }, ['表示するグラフがありません。']));
      } else {
        children.push(grid);
      }

      // 非表示にしたグラフも、戻せるようにセレクトだけ残す。
      if (hidden.length > 0) {
        children.push(el('h3', undefined, ['非表示にしているグラフ']));
        for (const q of hidden) {
          children.push(
            el('div', { class: 'row' }, [
              el('span', undefined, [q.label]),
              el('span', { class: 'field' }, [
                el('span', { class: 'field-label' }, ['グラフ']),
                chartKindSelect(q),
              ]),
            ]),
          );
        }
      }

      body.replaceChildren(...children);

      // canvas が DOM に入ってからでないと Chart.js がサイズを取れないため、ここで生成する。
      for (const item of pending) {
        try {
          const chart = createChartFor(item.canvas, item.aggregation, item.kind);
          if (chart) {
            chartRegistry.set(item.key, chart);
            item.pngButton.disabled = false;
          }
        } catch (error) {
          ctx.reportError(`「${item.aggregation.question}」のグラフ描画に失敗しました`, error);
        }
      }
    },
  };
}
