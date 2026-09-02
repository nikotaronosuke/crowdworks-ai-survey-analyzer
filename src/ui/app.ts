/**
 * アプリ全体の組み立て。
 *
 * 役割は3つだけに絞っている。
 *  1. アプリ状態（AppState）を1か所のストアに持つ
 *  2. Dataset を書き換えたあとの再集計（aggregateAll）をまとめて行う
 *  3. 状態のどこが変わったかを見て、必要なセクションだけ再描画する
 *
 * 回答データはこのモジュールが持つストア＝メモリ上にしか存在しない。
 * localStorage などの永続化も、外部への送信も一切行わない。
 */

import { aggregateAll } from '../core/aggregate.ts';
import { createStore } from '../state/store.ts';
import type { Store } from '../state/store.ts';
import { defaultIdentityVisibility } from '../core/identity.ts';
import type { IdentityVisibility } from '../core/identity.ts';
import type { AnalysisResult, CrossTabMode, Dataset } from '../types.ts';
import { clear, el } from './components/dom.ts';
import { createChartsSection } from './sections/chartsSection.ts';
import { createCrosstabSection, isCrossEligible } from './sections/crosstabSection.ts';
import { createExportSection } from './sections/exportSection.ts';
import { createLoadSection } from './sections/loadSection.ts';
import { createResponsesSection } from './sections/responsesSection.ts';
import { createOutputSelectionSection } from './sections/outputSelectionSection.ts';
import { createStatsSection } from './sections/statsSection.ts';
import { createSummarySection } from './sections/summarySection.ts';

/** 画面全体の状態。ここにしか回答データを置かない（永続化しない） */
export interface AppState {
  /** 読み込み済みデータ。未読込なら null */
  dataset: Dataset | null;
  /** 現在の集計結果。dataset が変わるたびに作り直す */
  analysis: AnalysisResult | null;
  /** クロス集計の縦軸（質問キー） */
  crossRow: string;
  /** クロス集計の横軸（質問キー） */
  crossCol: string;
  /** クロス集計の表示モード */
  crossMode: CrossTabMode;
  /** 回答一覧の検索文字列 */
  responseFilter: string;
  /**
   * 識別情報・管理列を回答一覧と responses.csv に出すか。
   * 個人を特定しうる列は既定で OFF。集計・グラフ・AI向け出力には元から載らない。
   */
  identityVisible: IdentityVisibility;
  /** 画面上部のメッセージ領域に出す文言（null なら非表示） */
  message: string | null;
}

/** 1セクションの実体。element を1度だけ DOM に挿し、以降は render で中身を作り直す */
export interface Section {
  /** セクションのルート要素（差し替えない） */
  element: HTMLElement;
  /** 現在の状態で中身を描き直す */
  render(state: AppState): void;
}

/** セクションからアプリ本体へ働きかけるための窓口 */
export interface AppContext {
  /** 状態ストア（読み取りと、副作用の無い項目の更新に使う） */
  store: Store<AppState>;
  /** 新しい Dataset を読み込み、集計・クロス軸の初期化まで行う */
  loadDataset(dataset: Dataset, message?: string | null): void;
  /**
   * 現在の Dataset を書き換えたあとに呼ぶ再集計。
   * message を渡すとメッセージ領域も更新する（省略時は据え置き）。
   */
  refresh(message?: string | null): void;
  /** メッセージ領域の文言を差し替える（null で消す） */
  setMessage(message: string | null): void;
  /** 例外を日本語のメッセージにしてメッセージ領域へ出す（alert は使わない） */
  reportError(prefix: string, error: unknown): void;
}

/** クロス集計の既定軸（このアンケートで最も見たい組み合わせ） */
const DEFAULT_CROSS_ROW = 'gender';
const DEFAULT_CROSS_COL = 'ai-tools';

/**
 * クロス集計に使える質問キーから、縦軸・横軸を決める。
 * 現在の選択が使えるならそれを尊重し、使えなくなっていれば
 * 'gender' × 'ai-tools'（無ければ先頭2つ）に戻す。
 */
function chooseCrossAxes(ds: Dataset, currentRow: string, currentCol: string): [string, string] {
  const keys = ds.questions.filter(isCrossEligible).map((q) => q.key);
  if (keys.length === 0) return ['', ''];

  let row = keys.includes(currentRow) ? currentRow : '';
  let col = keys.includes(currentCol) ? currentCol : '';

  if (!row) {
    row = keys.includes(DEFAULT_CROSS_ROW) ? DEFAULT_CROSS_ROW : keys[0];
  }
  if (!col) {
    col = keys.includes(DEFAULT_CROSS_COL) ? DEFAULT_CROSS_COL : keys.find((k) => k !== row) ?? row;
  }
  // 縦横が同じになってしまった場合は、別の質問へずらす（表として意味がないため）
  if (col === row && keys.length > 1) {
    col = keys.find((k) => k !== row) ?? row;
  }
  return [row, col];
}

/** 例外を利用者向けの日本語1行にする */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return '原因不明のエラーが発生しました。';
}

/**
 * アプリを root 要素にマウントする。
 * ヘッダー → メッセージ領域 → 8つのセクション → フッターの順に組み立てる。
 *
 * @param root マウント先（index.html の #app）
 */
export function mountApp(root: HTMLElement): void {
  clear(root);

  const initialState: AppState = {
    dataset: null,
    analysis: null,
    crossRow: '',
    crossCol: '',
    crossMode: 'count',
    responseFilter: '',
    identityVisible: defaultIdentityVisibility(),
    message: null,
  };

  const store = createStore<AppState>(initialState);
  // 直前の状態。どの項目が変わったかを見て再描画範囲を絞るために持つ。
  let prev: AppState = initialState;

  const messageBar = el('div', { class: 'card hidden' });

  /** メッセージ領域を描き直す */
  function renderMessage(message: string | null): void {
    clear(messageBar);
    if (!message) {
      messageBar.classList.add('hidden');
      return;
    }
    messageBar.classList.remove('hidden');
    messageBar.append(
      el('div', { class: 'row' }, [
        el('span', { class: 'badge' }, ['お知らせ']),
        el('span', undefined, [message]),
        el('span', { class: 'spacer' }),
        el(
          'button',
          {
            class: 'btn small',
            type: 'button',
            on: { click: () => setMessage(null) },
          },
          ['閉じる'],
        ),
      ]),
    );
  }

  /** メッセージ領域の文言を差し替える */
  function setMessage(message: string | null): void {
    store.update((s) => ({ ...s, message }));
  }

  /** 例外をメッセージ領域に出す */
  function reportError(prefix: string, error: unknown): void {
    setMessage(`${prefix}: ${describeError(error)}`);
  }

  /** 新しい Dataset を読み込む（集計・クロス軸・検索条件を初期化する） */
  function loadDataset(dataset: Dataset, message: string | null = null): void {
    try {
      const analysis = aggregateAll(dataset);
      const [crossRow, crossCol] = chooseCrossAxes(dataset, '', '');
      store.set({
        dataset,
        analysis,
        crossRow,
        crossCol,
        crossMode: store.get().crossMode,
        responseFilter: '',
        // 別のデータを読み込んだら、識別情報は既定（個人情報は伏せる）へ戻す
        identityVisible: defaultIdentityVisibility(),
        message,
      });
    } catch (error) {
      reportError('集計に失敗しました', error);
    }
  }

  /** 現在の Dataset を再集計する（行の集計対象切り替え・質問種別の変更後に呼ぶ） */
  function refresh(message?: string | null): void {
    const s = store.get();
    if (!s.dataset) return;
    try {
      const analysis = aggregateAll(s.dataset);
      const [crossRow, crossCol] = chooseCrossAxes(s.dataset, s.crossRow, s.crossCol);
      store.set({
        ...s,
        analysis,
        crossRow,
        crossCol,
        message: message === undefined ? s.message : message,
      });
    } catch (error) {
      reportError('再集計に失敗しました', error);
    }
  }

  const ctx: AppContext = { store, loadDataset, refresh, setMessage, reportError };

  const load = createLoadSection(ctx);
  const stats = createStatsSection();
  const responses = createResponsesSection(ctx);
  const summary = createSummarySection(ctx);
  const charts = createChartsSection(ctx);
  const crosstab = createCrosstabSection(ctx);
  const outputSelection = createOutputSelectionSection(ctx);
  const exporter = createExportSection(ctx);

  const header = el('header', { class: 'app-header' }, [
    el('h1', undefined, ['CrowdWorks 生成AIアンケート集計ツール']),
    el('p', { class: 'subtitle' }, [
      '完全ローカル処理・外部送信なし。読み込んだ回答はこのブラウザの中だけで集計され、' +
        'ネットワークへは一切送られません。',
    ]),
  ]);

  const footer = el('footer', { class: 'note' }, [
    '回答データはブラウザのメモリ上だけで処理され、リロードすると消えます。外部への送信・保存は行いません。',
  ]);

  root.append(
    header,
    messageBar,
    load.element,
    stats.element,
    responses.element,
    summary.element,
    charts.element,
    crosstab.element,
    outputSelection.element,
    exporter.element,
    footer,
  );

  // 変わった項目に応じて、必要なセクションだけ描き直す。
  store.subscribe((s) => {
    const datasetChanged = s.dataset !== prev.dataset;
    const analysisChanged = s.analysis !== prev.analysis;
    const filterChanged = s.responseFilter !== prev.responseFilter;
    const crossChanged =
      s.crossRow !== prev.crossRow || s.crossCol !== prev.crossCol || s.crossMode !== prev.crossMode;
    const identityChanged = s.identityVisible !== prev.identityVisible;
    const messageChanged = s.message !== prev.message;
    prev = s;

    if (messageChanged) renderMessage(s.message);
    if (datasetChanged) load.render(s);
    // 回答一覧は識別情報の表示切り替えでも列構成が変わる
    if (datasetChanged || filterChanged || identityChanged) responses.render(s);
    if (datasetChanged || analysisChanged) {
      stats.render(s);
      summary.render(s);
      charts.render(s);
    }
    // 出力する項目は、設問の選択（analysis に反映される）と
    // 識別情報の表示状態の両方でチェック状態が変わる。
    if (datasetChanged || analysisChanged || identityChanged) outputSelection.render(s);
    // エクスポートは cross-tab.csv が現在の軸に、responses.csv が識別情報の
    // 表示状態に追随する必要があるので、そのどちらでも描き直す。
    if (datasetChanged || analysisChanged || crossChanged || identityChanged) {
      crosstab.render(s);
      exporter.render(s);
    }
  });

  // 初回描画。canvas を含むセクションがあるため、DOM へ挿してから描く。
  renderMessage(initialState.message);
  for (const section of [
    load,
    stats,
    responses,
    summary,
    charts,
    crosstab,
    outputSelection,
    exporter,
  ]) {
    section.render(initialState);
  }
}
