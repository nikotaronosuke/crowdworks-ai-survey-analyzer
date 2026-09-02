/**
 * エントリーポイント。
 * スタイルを読み込み、index.html の #app にアプリをマウントするだけ。
 * 実際の画面構築はすべて ui/app.ts が行う。
 */

import './style.css';
import { mountApp } from './ui/app.ts';

const root = document.getElementById('app');
if (root) {
  mountApp(root);
}
