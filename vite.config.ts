/// <reference types="vitest/config" />

/**
 * Vite / Vitest の設定。
 *
 * このアプリは「回答データを一切外へ出さない」ことが最優先要件なので、
 * ビルド設定もその方針に合わせてある。
 *  - 相対パス出力（base: './'）にして file:// で直接開けるようにする
 *  - アセットを可能な限りインライン化して、外部ファイルへの依存を減らす
 *  - build 時にだけ CSP の meta を注入して、成果物のネットワークアクセスを塞ぐ
 */

import { defineConfig, type Plugin } from 'vite';

/**
 * ビルド成果物の <head> 先頭に差し込む Content-Security-Policy。
 *
 * connect-src 'none' が要。fetch / XMLHttpRequest / WebSocket / sendBeacon が
 * すべてブラウザ側で遮断されるため、万一コードに通信が紛れ込んでも外へ出られない。
 * script-src / style-src に 'unsafe-inline' が必要なのは、
 * 単一HTML化（scripts/inline-build.mjs）で JS/CSS をインライン展開するため。
 * img-src の blob: は Chart.js のグラフを PNG 保存するときに使う。
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

/**
 * build 時にだけ CSP の meta タグを <head> の先頭へ注入するプラグイン。
 *
 * dev サーバーには適用しない（apply: 'build'）。
 * dev で同じ CSP を効かせると Vite の HMR クライアントとモジュール取得が
 * connect-src 'none' に阻まれて開発できなくなるため。
 */
function injectCsp(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml: {
      // Vite 本体がバンドル済みの <script> / <link> を挿し込んだ後に走らせ、
      // head-prepend で必ず <head> の最初の要素になるようにする。
      order: 'post',
      handler() {
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: CONTENT_SECURITY_POLICY,
            },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

export default defineConfig({
  // 相対パスでビルドする。dist/index.html も dist-standalone/index.html も
  // ローカルファイル（file://）から直接開けるようにするため。
  base: './',

  plugins: [injectCsp()],

  build: {
    // 依存（Chart.js / Papa Parse）と自前コードの両方が問題なく動く水準。
    // tsconfig の target とも揃えてある。
    target: 'es2022',
    // 100MB。画像・フォントなどのアセットを極力 data: URI としてインライン化し、
    // 成果物を1枚のHTMLにまとめやすくする（外部ファイル参照を残さないため）。
    assetsInlineLimit: 100_000_000,
  },

  test: {
    // 対象は純粋なロジック（core / export）。DOM を必要とするテストは書かない方針。
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
