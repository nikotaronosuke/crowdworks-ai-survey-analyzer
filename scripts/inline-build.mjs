/**
 * dist/ のビルド成果物を「1枚のHTML」にまとめて dist-standalone/index.html を作る。
 *
 * 目的:
 *   ダブルクリック（file://）で開けて、サーバーも通信も一切要らない配布物を作ること。
 *   file:// では type="module" の外部 JS が CORS で読めないため、
 *   JS と CSS を HTML 内へ展開してしまう必要がある。
 *
 * 依存は Node 標準の fs / path / url のみ（追加パッケージなし）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const OUT_DIR = path.join(ROOT_DIR, 'dist-standalone');
const IN_HTML = path.join(DIST_DIR, 'index.html');
const OUT_HTML = path.join(OUT_DIR, 'index.html');

/** インライン化しないで放置してよい参照先のスキーム */
const INERT_REF = /^(data:|blob:|https?:|mailto:|tel:|javascript:|#|about:)/i;

/** 分かりやすい日本語エラーを出して終了する */
function fail(message, hint) {
  console.error(`\n[inline-build] エラー: ${message}`);
  if (hint) console.error(`  → ${hint}`);
  console.error('');
  process.exit(1);
}

/** バイト数を KB 表記にする */
function toKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * HTML 属性の href / src をビルド出力ディレクトリ内の実ファイルパスへ解決する。
 * base: './' でビルドしているため "./assets/index-xxxx.js" のような値が来る。
 * クエリ・ハッシュは落とす。外部URLや data: なら null を返す。
 */
function resolveDistPath(ref) {
  if (!ref || INERT_REF.test(ref)) return null;
  const clean = ref.split('#')[0].split('?')[0];
  if (clean === '') return null;
  const relative = clean.replace(/^\.?\//, '');
  return path.join(DIST_DIR, relative);
}

/** 属性文字列から指定属性の値を取り出す（"..." / '...' の両方に対応） */
function attrValue(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  if (!m) return undefined;
  return m[2] !== undefined ? m[2] : m[3];
}

/** ファイルを読む。無ければ分かりやすく落とす */
function readAsset(filePath, ref) {
  if (!fs.existsSync(filePath)) {
    fail(
      `ビルド成果物 "${ref}" が見つかりません（${filePath}）。`,
      'dist/ が壊れている可能性があります。`npm run build` をやり直してください。',
    );
  }
  return fs.readFileSync(filePath, 'utf8');
}

// ---------------------------------------------------------------------------
// 1. 入力チェック
// ---------------------------------------------------------------------------

if (!fs.existsSync(DIST_DIR)) {
  fail(
    'dist ディレクトリがありません。',
    '先に `npm run build:only`（または `vite build`）でビルドしてください。',
  );
}
if (!fs.existsSync(IN_HTML)) {
  fail(
    'dist/index.html がありません。',
    'ビルドが途中で失敗している可能性があります。`npm run build:only` を実行し直してください。',
  );
}

let html = fs.readFileSync(IN_HTML, 'utf8');

/** インライン化したファイルの記録（最後にまとめて表示する） */
const inlined = [];

/** インライン化した CSS の中身（url() の残存チェックに使う） */
const inlinedCss = [];

// ---------------------------------------------------------------------------
// 2. modulepreload の <link> を削除する
//    単一HTMLでは先読み対象の外部ファイルが存在しなくなるため、残すと 404 になる。
// ---------------------------------------------------------------------------

html = html.replace(/[ \t]*<link\b[^>]*\brel\s*=\s*["']modulepreload["'][^>]*>\s*\n?/gi, '');

// ---------------------------------------------------------------------------
// 3. <link rel="stylesheet" href="..."> を <style>…</style> へ展開する
// ---------------------------------------------------------------------------

html = html.replace(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi, (tag) => {
  const href = attrValue(tag, 'href');
  const filePath = resolveDistPath(href);
  // 外部URL・data: などはそのまま残す（本来ここには来ない想定）
  if (!filePath) return tag;

  const css = readAsset(filePath, href);
  inlined.push({ kind: 'CSS', ref: href, bytes: Buffer.byteLength(css, 'utf8') });
  inlinedCss.push(css);
  // CSS 中に "</style" があると <style> が閉じてしまうのでエスケープする。
  // 元の大文字小文字を保つため、バックスラッシュだけを挿し込む。
  const safe = css.replace(/<\/(style)/gi, (_m, tag) => `<\\/${tag}`);
  return `<style>\n${safe}\n</style>`;
});

// ---------------------------------------------------------------------------
// 4. <script src="..."></script> を <script type="module">…</script> へ展開する
// ---------------------------------------------------------------------------

html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs) => {
  const src = attrValue(attrs, 'src');
  if (src === undefined) return tag;
  const filePath = resolveDistPath(src);
  if (!filePath) return tag;

  const js = readAsset(filePath, src);
  inlined.push({ kind: 'JS', ref: src, bytes: Buffer.byteLength(js, 'utf8') });
  // 文字列やコメント中の "</script" で <script> が閉じるのを防ぐ。
  // 元の大文字小文字を保つため、バックスラッシュだけを挿し込む。
  const safe = js.replace(/<\/(script)/gi, (_m, tag) => `<\\/${tag}`);
  return `<script type="module">\n${safe}\n</script>`;
});

if (inlined.length === 0) {
  fail(
    'dist/index.html にインライン化できる <script src> / <link rel="stylesheet"> がありませんでした。',
    'ビルド設定（vite.config.ts）が想定と変わっていないか確認してください。',
  );
}

// ---------------------------------------------------------------------------
// 5. crossorigin 属性を削除する
//    file:// では origin が null になり、crossorigin が付いていると読み込みに失敗する。
// ---------------------------------------------------------------------------

html = html.replace(/\s+crossorigin(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');

// ---------------------------------------------------------------------------
// 6. 残った相対参照を検出して警告する
//    file:// で開いたときに壊れうるのはここだけなので、必ず目に見える形で出す。
// ---------------------------------------------------------------------------

const remaining = [];

// 属性のチェックは <script> / <style> の中身を除いた HTML に対して行う。
// バンドルされた JS の文字列リテラルに含まれる src= / href= を
// 誤検出しないようにするため。
const markupOnly = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');

for (const m of markupOnly.matchAll(/\b(?:src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
  const value = m[2] !== undefined ? m[2] : m[3];
  if (!value || INERT_REF.test(value)) continue;
  remaining.push(`HTML 属性: ${value}`);
}
// url() は実際にインライン化した CSS だけを見る
for (const css of inlinedCss) {
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]+))\s*\)/gi)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!value || INERT_REF.test(value)) continue;
    remaining.push(`CSS url(): ${value}`);
  }
}

// ---------------------------------------------------------------------------
// 7. 書き出し
// ---------------------------------------------------------------------------

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_HTML, html, 'utf8');

const outBytes = Buffer.byteLength(html, 'utf8');

console.log('\n[inline-build] 単一HTMLを生成しました。');
for (const item of inlined) {
  console.log(`  埋め込み ${item.kind.padEnd(3)} : ${item.ref} (${toKb(item.bytes)})`);
}
console.log(`  出力ファイル : ${OUT_HTML}`);
console.log(`  サイズ       : ${toKb(outBytes)}`);

if (remaining.length > 0) {
  const unique = [...new Set(remaining)];
  console.warn(
    `\n[inline-build] 警告: 外部ファイルへの相対参照が ${unique.length} 件残っています。`,
  );
  console.warn('  file:// で開いたときに読み込めない可能性があります。');
  for (const ref of unique) console.warn(`    - ${ref}`);
  console.warn(
    '  → vite.config.ts の build.assetsInlineLimit を上げるか、該当アセットを data: URI にしてください。',
  );
} else {
  console.log('  外部ファイルへの相対参照: なし（file:// で直接開けます）');
}

console.log('');
