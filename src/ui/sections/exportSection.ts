/**
 * 8. エクスポートセクション。
 *
 * ここで出るファイルはすべてブラウザ内の Blob から作られ、外部へは一切送信されない。
 * Excel の文字化けを避けるため、CSV には BOM を付けて保存する。
 */

import { crossTabulate } from '../../core/crosstab.ts';
import { hiddenIdentityColumns } from '../../core/identity.ts';
import { toCrossTabCsv, toResponsesCsv, toSummaryCsv } from '../../export/csv.ts';
import { downloadBlob, downloadText } from '../../export/download.ts';
import { toAnalysisJson } from '../../export/json.ts';
import { toFreeTextMarkdown, toMarkdown } from '../../export/markdown.ts';
import { chartToPngBlob } from '../../export/png.ts';
import type { AppContext, AppState, Section } from '../app.ts';
import { el, fmtInt } from '../components/dom.ts';
import { getChartRegistry } from './chartsSection.ts';

/** 1つのエクスポート操作の定義 */
interface ExportAction {
  label: string;
  description: string;
  run(): void;
}

/** 指定ミリ秒だけ待つ（連続ダウンロードをブラウザに弾かれにくくするため） */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * navigator.clipboard が使えないときのコピー手段。
 * 画面外の textarea を選択して execCommand('copy') を叩く（古いが確実な方法）。
 */
function copyByExecCommand(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/**
 * エクスポートセクションを作る。
 * @param ctx 現在の状態の読み取りと、失敗時のメッセージ表示に使う
 */
export function createExportSection(ctx: AppContext): Section {
  let current: AppState | null = null;

  /**
   * 出力に使う状態を取り出す。データ未読込なら null（各ボタンは disabled なので通常は起きない）。
   *
   * 描画時に受け取った `current` ではなくストアの最新値を読む。
   * クロス集計の軸だけを変えたときにこのセクションが再描画されなくても、
   * cross-tab.csv が「いま画面に出ている表」とずれないようにするため。
   */
  function ready(): AppState | null {
    const state = ctx.store.get() ?? current;
    if (!state || !state.dataset || !state.analysis) {
      ctx.setMessage('先にデータを読み込んでください。');
      return null;
    }
    return state;
  }

  /** survey-summary.md の本文を作る */
  function markdownText(state: AppState): string {
    return state.analysis ? toMarkdown(state.analysis) : '';
  }

  /** クリップボードへコピーする（失敗したら execCommand にフォールバック） */
  async function copyMarkdown(text: string): Promise<void> {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        ctx.setMessage('survey-summary.md の内容をクリップボードにコピーしました。');
        return;
      }
    } catch {
      // クリップボード API が拒否された場合は下のフォールバックへ進む
    }
    if (copyByExecCommand(text)) {
      ctx.setMessage('survey-summary.md の内容をクリップボードにコピーしました。');
    } else {
      ctx.setMessage(
        'クリップボードにコピーできませんでした。「survey-summary.md を保存」でファイルとして取り出してください。',
      );
    }
  }

  /** 表示中のグラフを順に PNG 保存する */
  async function saveAllCharts(): Promise<void> {
    const registry = getChartRegistry();
    if (registry.size === 0) {
      ctx.setMessage('保存できるグラフがありません。');
      return;
    }
    let saved = 0;
    for (const [key, chart] of registry) {
      try {
        const blob = await chartToPngBlob(chart);
        downloadBlob(`${key}.png`, blob);
        saved += 1;
        // 連続してダウンロードを開始するとブラウザに抑制されることがあるため少し待つ
        await delay(200);
      } catch (error) {
        ctx.reportError(`グラフ「${key}」のPNG保存に失敗しました`, error);
      }
    }
    ctx.setMessage(`${fmtInt(saved)}件のグラフをPNGで保存しました。`);
  }

  const actions: ExportAction[] = [
    {
      label: 'summary.csv を保存',
      description: '質問ごとの選択肢・人数・割合の一覧。Excel やスプレッドシートでそのまま開けます（BOM付き）。',
      run: () => {
        const state = ready();
        if (!state || !state.analysis) return;
        downloadText('summary.csv', toSummaryCsv(state.analysis), 'text/csv', true);
      },
    },
    {
      label: 'cross-tab.csv を保存',
      description: '「6. クロス集計」でいま表示している掛け合わせ表。母数の行・列も付きます（BOM付き）。',
      run: () => {
        const state = ready();
        if (!state || !state.dataset) return;
        const result = crossTabulate(
          state.dataset,
          state.crossRow,
          state.crossCol,
          state.crossMode,
        );
        downloadText('cross-tab.csv', toCrossTabCsv(result), 'text/csv', true);
      },
    },
    {
      label: 'responses.csv を保存',
      description:
        '除外した回答も含めた全回答。末尾の included 列が true=集計対象 / false=除外です。監査・再確認用（BOM付き）。',
      run: () => {
        const state = ready();
        if (!state || !state.dataset) return;
        downloadText(
          'responses.csv',
          toResponsesCsv(state.dataset, hiddenIdentityColumns(state.dataset, state.identityVisible)),
          'text/csv',
          true,
        );
      },
    },
    {
      label: 'analysis.json を保存',
      description: '集計結果をそのまま機械可読にしたもの。別のツールやスクリプトに渡すとき用です。',
      run: () => {
        const state = ready();
        if (!state || !state.analysis) return;
        downloadText('analysis.json', toAnalysisJson(state.analysis), 'application/json');
      },
    },
    {
      label: 'survey-summary.md を保存',
      description: 'ChatGPT や Claude にそのまま貼れる要約。自由記述の本文は含めていません（個人情報への配慮）。',
      run: () => {
        const state = ready();
        if (!state) return;
        downloadText('survey-summary.md', markdownText(state), 'text/markdown');
      },
    },
    {
      label: 'survey-free-text.md を保存',
      description:
        '集計対象の自由記述の本文だけをまとめたもの。定性分析を AI にさせるとき用です（除外した回答は含みません）。',
      run: () => {
        const state = ready();
        if (!state || !state.dataset) return;
        downloadText('survey-free-text.md', toFreeTextMarkdown(state.dataset), 'text/markdown');
      },
    },
    {
      label: 'survey-summary.md をコピー',
      description: '同じ内容をクリップボードへ。ファイルを経由せずチャットへ貼り付けたいとき用です。',
      run: () => {
        const state = ready();
        if (!state) return;
        void copyMarkdown(markdownText(state));
      },
    },
    {
      label: 'すべてのグラフをPNG保存',
      description: '「5. グラフ」に出ている図を、質問キー名のPNGとして1枚ずつ保存します。',
      run: () => {
        const state = ready();
        if (!state) return;
        void saveAllCharts();
      },
    },
  ];

  const buttons: HTMLButtonElement[] = [];
  const list = el('div');

  for (const action of actions) {
    const button = el(
      'button',
      { class: 'btn', type: 'button', on: { click: action.run } },
      [action.label],
    );
    button.disabled = true;
    buttons.push(button);
    list.appendChild(
      el('div', { class: 'question-block' }, [
        el('div', { class: 'row' }, [button]),
        el('p', { class: 'note' }, [action.description]),
      ]),
    );
  }

  const element = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', undefined, ['8. エクスポート'])]),
    list,
    el('p', { class: 'note' }, [
      'これらのファイルは端末内で生成され、外部には送信されません。保存先はブラウザのダウンロード先フォルダです。',
    ]),
  ]);

  return {
    element,
    render(state: AppState): void {
      current = state;
      const enabled = state.dataset !== null && state.analysis !== null;
      for (const button of buttons) {
        button.disabled = !enabled;
      }
    },
  };
}
