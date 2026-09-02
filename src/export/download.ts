/**
 * ブラウザ内でのファイル保存。
 * データはすべてメモリ上の Blob から生成し、外部へ送信しない。
 */

/** UTF-8 テキストの先頭に付ける BOM (U+FEFF) */
const BOM = '\uFEFF';

/**
 * Blob を `<a download>` 経由でダウンロードさせる。
 * 生成した ObjectURL は少し遅らせて解放する
 * （click 直後に revoke するとブラウザによっては保存に失敗するため）。
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * テキストを UTF-8 のファイルとしてダウンロードさせる。
 * withBom=true のときは先頭に BOM を付ける
 * （Excel は BOM 無し UTF-8 の CSV を Shift_JIS と誤認して文字化けするため）。
 */
export function downloadText(
  filename: string,
  text: string,
  mime: string,
  withBom = false,
): void {
  const body = withBom ? BOM + text : text;
  const blob = new Blob([body], { type: `${mime};charset=utf-8` });
  downloadBlob(filename, blob);
}
