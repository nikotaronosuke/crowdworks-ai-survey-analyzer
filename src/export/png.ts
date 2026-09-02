/**
 * グラフの PNG 書き出し。
 * Chart.js のキャンバスは背景が透過なので、白（既定）で塗ってから描き直す。
 */

import type { Chart } from 'chart.js';
import { applyChartColors, CHART_COLORS, currentChartColors } from '../ui/charts/chart.ts';

/**
 * Chart のキャンバスを scale 倍・背景色付きの PNG Blob にする。
 *
 * 解像度の扱い:
 * Chart.js は devicePixelRatio を考慮して canvas の実ピクセル
 * （`canvas.width` / `canvas.height`）を CSS 表示サイズより大きく確保している。
 * ここで CSS サイズ（clientWidth など）を基準に拡大すると、
 * 実ピクセルより小さい元画像を引き伸ばすことになり、かえって粗くなる。
 * そのため常に実ピクセルを基準に取り、そこから scale 倍する。
 * 元画像自体の情報量は増えないため拡大分は補間になるが、
 * 実ピクセル基準にすることで少なくとも元の解像度は必ず維持される。
 */
export function chartToPngBlob(
  chart: Chart,
  scale = 2,
  background = '#ffffff',
): Promise<Blob> {
  const source = chart.canvas;

  // 実ピクセル。まだレイアウトされていない等で 0 のときは CSS サイズにフォールバックする。
  const baseWidth = source.width || Math.round(source.clientWidth) || 1;
  const baseHeight = source.height || Math.round(source.clientHeight) || 1;

  const ratio = scale > 0 ? scale : 1;
  const width = Math.max(1, Math.round(baseWidth * ratio));
  const height = Math.max(1, Math.round(baseHeight * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.reject(new Error('2D コンテキストを取得できませんでした'));
  }

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 出力先は白背景なので、画面がダークテーマでも文字・目盛りは濃色で描き直す。
  // ダークテーマの薄い文字色のまま書き出すと、白地の PNG でほぼ読めなくなるため。
  const screenColors = currentChartColors();
  const needsRecolor = screenColors !== CHART_COLORS.light;
  if (needsRecolor) {
    applyChartColors(chart, CHART_COLORS.light);
    chart.update('none');
  }
  try {
    ctx.drawImage(source, 0, 0, width, height);
  } finally {
    // 画面表示は元のテーマ色に戻す
    if (needsRecolor) {
      applyChartColors(chart, screenColors);
      chart.update('none');
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('PNG の生成に失敗しました'));
      }
    }, 'image/png');
  });
}
