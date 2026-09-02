/**
 * Chart.js のラッパー。
 * 必要なコントローラ・要素・スケール・プラグインだけを register し、
 * Aggregation から表示用の Chart を組み立てる。
 * 配色は Chart.js の Colors プラグインを使わず、色覚特性に配慮した自前パレットを使う。
 */

import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import type { ChartConfiguration, ChartType, TooltipItem } from 'chart.js';
import type { Aggregation, ChartKind } from '../../types.ts';
import { fmtInt, fmtPct } from '../components/dom.ts';

// import 時に1回だけ登録する（tree-shaking のため必要なものだけ）。
Chart.register(
  BarController,
  BarElement,
  PieController,
  ArcElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Title,
);

/**
 * 自前の配色パレット（Okabe-Ito 系をベースにした10色）。
 * 色覚特性があっても隣接色を区別しやすい組み合わせを選んでいる。
 */
export const CHART_PALETTE: string[] = [
  '#0072B2', // 青
  '#E69F00', // 橙
  '#009E73', // 緑
  '#D55E00', // 朱
  '#CC79A7', // 桃
  '#56B4E9', // 空
  '#8C6D31', // 茶
  '#117733', // 深緑
  '#882255', // 葡萄
  '#666666', // 灰
];

/** Chart インスタンスと破棄関数のペア（呼び出し側で保持して差し替える用） */
export interface ChartHandle {
  chart: Chart;
  destroy(): void;
}

/**
 * Aggregation から既定のグラフ種別を決める。
 * schema.ts の推定（single は 6 種以下なら pie）と揃えてある。
 */
export function defaultChartKind(a: Aggregation): ChartKind {
  if (a.items.length === 0) return 'none';
  switch (a.kind) {
    case 'multiple':
      return 'hbar';
    case 'numeric':
      return 'bar';
    case 'single':
      return a.items.length <= 6 ? 'pie' : 'bar';
    case 'free':
    case 'ignore':
    default:
      return 'none';
  }
}

/**
 * ツールチップに「人数 (割合%)」を出すコールバックを作る。
 * 割合は集計済みの percentage をそのまま使う（グラフ側で再計算しない）。
 */
function makeTooltipLabel<TType extends ChartType>(a: Aggregation) {
  return (item: TooltipItem<TType>): string => {
    const oc = a.items[item.dataIndex];
    if (!oc) return '';
    return `${fmtInt(oc.count)}人 (${fmtPct(oc.percentage, 1)})`;
  };
}

/**
 * Chart を生成する。
 * Chart<'bar'> などの具体型は Chart<ChartType> と構造的に互換ではないため、
 * ここでだけ戻り値の型を緩めている（設定オブジェクト側は厳密に型付けされる）。
 */
function instantiate<TType extends ChartType>(
  canvas: HTMLCanvasElement,
  config: ChartConfiguration<TType, number[], string>,
): Chart {
  const chart = new Chart(canvas, config) as unknown as Chart;
  // 画面のテーマに合わせた文字・目盛り色を当てる（PNG 出力時は png.ts が差し替える）
  applyChartColors(chart, currentChartColors());
  chart.update('none');
  return chart;
}

/** 画面表示用（ライト／ダーク）と PNG 出力用の文字・目盛り色 */
export const CHART_COLORS = {
  /** ライトテーマの画面表示。PNG 出力（常に白背景に合成する）にもこれを使う */
  light: { text: '#3d454f', grid: 'rgba(0, 0, 0, 0.12)' },
  /** ダークテーマの画面表示 */
  dark: { text: '#c3cad3', grid: 'rgba(255, 255, 255, 0.16)' },
} as const;

/** いま画面に適用されているテーマの色を返す */
export function currentChartColors(): { text: string; grid: string } {
  const dark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? CHART_COLORS.dark : CHART_COLORS.light;
}

/**
 * Chart のテキスト・目盛り線の色をまとめて差し替える。
 *
 * 画面はテーマに合わせた色、PNG は白背景に合成するので常に濃色、と使い分けたい。
 * そのため色の適用を外から呼べる形にしてある（png.ts が出力の前後で使う）。
 * 呼び出し側で `chart.update('none')` すること。
 */
export function applyChartColors(chart: Chart, colors: { text: string; grid: string }): void {
  const options = chart.options as unknown as {
    color?: string;
    plugins?: { title?: { color?: string }; legend?: { labels?: { color?: string } } };
    scales?: Record<string, { ticks?: { color?: string }; grid?: { color?: string } }>;
  };
  options.color = colors.text;
  options.plugins ??= {};
  options.plugins.title ??= {};
  options.plugins.title.color = colors.text;
  options.plugins.legend ??= {};
  options.plugins.legend.labels ??= {};
  options.plugins.legend.labels.color = colors.text;
  for (const scale of Object.values(options.scales ?? {})) {
    scale.ticks ??= {};
    scale.ticks.color = colors.text;
    scale.grid ??= {};
    scale.grid.color = colors.grid;
  }
}

/**
 * Aggregation を1つのグラフに描く。
 *
 * - kind を渡せば種別を上書きできる（UI からの切り替え用）。省略時は defaultChartKind。
 * - 'none' または items が空なら null を返す。
 * - maintainAspectRatio:false なので、canvas の親要素に高さを与えること
 *   （hbar は項目数に応じて suggestedChartHeight を使う）。
 * - animation を切っているのは PNG 出力を安定させるためと、描画を速くするため。
 *
 * @param canvas 描画先。既に別の Chart が載っていれば破棄してから描く
 * @param a 集計結果
 * @param kind グラフ種別の上書き
 */
export function createChartFor(
  canvas: HTMLCanvasElement,
  a: Aggregation,
  kind?: ChartKind,
): Chart | null {
  const resolved: ChartKind = kind ?? defaultChartKind(a);
  if (resolved === 'none' || a.items.length === 0) return null;

  // 同じ canvas を使い回すときの "Canvas is already in use" を避ける。
  Chart.getChart(canvas)?.destroy();

  const labels = a.items.map((item) => item.label);
  const counts = a.items.map((item) => item.count);
  const colors = a.items.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]);

  if (resolved === 'pie') {
    const config: ChartConfiguration<'pie', number[], string> = {
      type: 'pie',
      data: {
        labels,
        datasets: [
          {
            label: '人数',
            data: counts,
            backgroundColor: colors,
            borderColor: '#ffffff',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        devicePixelRatio: 2,
        plugins: {
          title: { display: true, text: a.question },
          legend: { display: true, position: 'right' },
          tooltip: { callbacks: { label: makeTooltipLabel<'pie'>(a) } },
        },
      },
    };
    return instantiate(canvas, config);
  }

  if (resolved === 'line') {
    const config: ChartConfiguration<'line', number[], string> = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '人数',
            data: counts,
            borderColor: CHART_PALETTE[0],
            backgroundColor: CHART_PALETTE[0],
            borderWidth: 2,
            tension: 0.2,
            pointRadius: 3,
            pointHoverRadius: 5,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        devicePixelRatio: 2,
        plugins: {
          title: { display: true, text: a.question },
          legend: { display: false },
          tooltip: { callbacks: { label: makeTooltipLabel<'line'>(a) } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    };
    return instantiate(canvas, config);
  }

  // 'bar'（縦棒）と 'hbar'（横棒）は indexAxis だけが違う。
  const horizontal = resolved === 'hbar';
  const config: ChartConfiguration<'bar', number[], string> = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '人数',
          data: counts,
          backgroundColor: colors,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      devicePixelRatio: 2,
      indexAxis: horizontal ? 'y' : 'x',
      plugins: {
        title: { display: true, text: a.question },
        legend: { display: false },
        tooltip: { callbacks: { label: makeTooltipLabel<'bar'>(a) } },
      },
      scales: horizontal
        ? {
            // 横棒は項目名を全て表示する（高さは呼び出し側が項目数に応じて確保する）。
            x: { beginAtZero: true, ticks: { precision: 0 } },
            y: { ticks: { autoSkip: false } },
          }
        : {
            // 縦棒の x 軸ラベルの回転・省略は Chart.js の既定に任せる。
            y: { beginAtZero: true, ticks: { precision: 0 } },
          },
    },
  };
  return instantiate(canvas, config);
}

/**
 * グラフ領域の推奨高さ(px)。
 * 横棒は項目数に比例して伸ばし、それ以外は固定値。
 */
export function suggestedChartHeight(a: Aggregation, kind: ChartKind): number {
  if (kind !== 'hbar') return 320;
  const raw = 120 + a.items.length * 26;
  return Math.max(220, Math.min(900, raw));
}
