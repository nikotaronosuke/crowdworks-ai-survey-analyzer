/**
 * 7. 出力する項目セクション。
 *
 * 「どの設問を集計・グラフ・AI向け出力に載せるか」を選ぶだけの画面。
 *
 * ここでの選択（QuestionDef.selected）と、
 * 「3. 回答一覧」での集計対象／除外（ResponseRow.included）は別の概念。
 *   included … どの回答者を数えるか
 *   selected … どの設問を出すか
 *
 * 加えて、CrowdWorks の識別情報・管理列の表示切り替えもここに置く。
 * 識別情報は集計・グラフ・AI向け出力には構造的に載らず、
 * 回答一覧と responses.csv にだけ、ONのときに出る。
 */

import {
  IDENTITY_LABELS,
  TOGGLEABLE_IDENTITY_KINDS,
  identityQuestions,
} from '../../core/identity.ts';
import type { IdentityKind, QuestionDef } from '../../types.ts';
import type { AppContext, AppState, Section } from '../app.ts';
import { el, fmtInt } from '../components/dom.ts';

/** 出力対象に選べる設問（対象外にした列と識別情報は除く） */
function selectableQuestions(questions: QuestionDef[]): QuestionDef[] {
  return questions.filter((q) => q.kind !== 'ignore' && !q.identity);
}

/**
 * 出力する項目セクションを作る。
 * @param ctx 選択を変えたあとの再集計と、識別情報の表示状態の更新に使う
 */
export function createOutputSelectionSection(ctx: AppContext): Section {
  const controls = el('div', { class: 'row' });
  const body = el('div');
  const identityBody = el('div');

  const element = el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', undefined, ['7. 出力する項目']),
      el('span', { class: 'card-note' }, [
        'チェックした設問だけを 基本集計・グラフ・summary.csv・analysis.json・survey-summary.md に出します。',
      ]),
    ]),
    controls,
    body,
    identityBody,
  ]);

  /** 全設問の選択状態をまとめて切り替える */
  function setAll(selected: boolean): void {
    const ds = ctx.store.get().dataset;
    if (!ds) return;
    const targets = selectableQuestions(ds.questions);
    if (targets.length === 0) return;
    for (const q of targets) q.selected = selected;
    ctx.refresh(
      selected
        ? `${fmtInt(targets.length)}件の設問をすべて出力対象にしました。`
        : 'すべての設問を出力対象から外しました。',
    );
  }

  /** 1設問のチェックボックス */
  function questionCheckbox(q: QuestionDef): HTMLElement {
    const input = el('input', {
      type: 'checkbox',
      checked: q.selected,
      on: {
        change: (event) => {
          q.selected = (event.target as HTMLInputElement).checked;
          ctx.refresh(
            q.selected
              ? `「${q.label}」を出力対象にしました。`
              : `「${q.label}」を出力対象から外しました。`,
          );
        },
      },
    });
    input.dataset.checkKey = `q:${q.key}`;
    return el('label', { class: 'check-item', title: q.header }, [input, ' ', q.label]);
  }

  /** 識別情報1件のチェックボックス */
  function identityCheckbox(kind: IdentityKind, q: QuestionDef, state: AppState): HTMLElement {
    const input = el('input', {
      type: 'checkbox',
      checked: state.identityVisible[kind],
      on: {
        change: (event) => {
          const checked = (event.target as HTMLInputElement).checked;
          ctx.store.update((s) => ({
            ...s,
            identityVisible: { ...s.identityVisible, [kind]: checked },
            message: checked
              ? `${IDENTITY_LABELS[kind]}を回答一覧と responses.csv に表示します。`
              : `${IDENTITY_LABELS[kind]}を回答一覧と responses.csv から外しました。`,
          }));
        },
      },
    });
    input.dataset.checkKey = `identity:${kind}`;
    return el('label', { class: 'check-item', title: q.header }, [
      input,
      ' ',
      `${IDENTITY_LABELS[kind]}を表示・出力する`,
    ]);
  }

  /**
   * 再描画でチェックボックスの実体が入れ替わるとフォーカスが外れてしまう。
   * 項目数が多くキーボードで連続操作しうる画面なので、
   * 描き直したあとに同じ項目へフォーカスを戻す。
   */
  function focusedCheckKey(): string | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement)) return null;
    if (!element.contains(active)) return null;
    return active.dataset.checkKey ?? null;
  }

  /** focusedCheckKey で覚えたキーの項目へフォーカスを戻す */
  function restoreFocus(key: string | null): void {
    if (!key) return;
    const next = element.querySelector<HTMLInputElement>(`input[data-check-key="${key}"]`);
    next?.focus();
  }

  return {
    element,
    render(state: AppState): void {
      const focusKey = focusedCheckKey();
      const ds = state.dataset;
      if (!ds) {
        controls.replaceChildren();
        identityBody.replaceChildren();
        body.replaceChildren(
          el('p', { class: 'empty' }, ['データを読み込むと、出力する設問を選べます。']),
        );
        restoreFocus(focusKey);
        return;
      }

      const targets = selectableQuestions(ds.questions);
      const selectedCount = targets.filter((q) => q.selected).length;

      controls.replaceChildren(
        el('button', {
          class: 'btn ghost',
          type: 'button',
          disabled: targets.length === 0,
          on: { click: () => setAll(true) },
        }, ['すべて選択']),
        el('button', {
          class: 'btn ghost',
          type: 'button',
          disabled: targets.length === 0,
          on: { click: () => setAll(false) },
        }, ['すべて解除']),
        el('span', { class: 'muted' }, [
          `${fmtInt(selectedCount)} / ${fmtInt(targets.length)} 件を出力`,
        ]),
      );

      if (targets.length === 0) {
        body.replaceChildren(el('p', { class: 'empty' }, ['出力できる設問がありません。']));
      } else {
        const list = el('div', { class: 'check-grid' });
        const frag = document.createDocumentFragment();
        for (const q of targets) frag.appendChild(questionCheckbox(q));
        list.replaceChildren(frag);

        const note = el('p', { class: 'muted' }, [
          'responses.csv・survey-free-text.md・cross-tab.csv はここの選択の影響を受けません（監査・再分析用のため）。',
        ]);
        body.replaceChildren(list, note);
      }

      // 識別情報・管理列（データに含まれているものだけ出す）
      const identities = identityQuestions(ds).filter(
        (q) => q.identity && TOGGLEABLE_IDENTITY_KINDS.includes(q.identity),
      );
      if (identities.length === 0) {
        identityBody.replaceChildren();
        restoreFocus(focusKey);
        return;
      }

      const list = el('div', { class: 'check-grid' });
      const frag = document.createDocumentFragment();
      for (const q of identities) {
        if (!q.identity) continue;
        frag.appendChild(identityCheckbox(q.identity, q, state));
      }
      list.replaceChildren(frag);

      identityBody.replaceChildren(
        el('h3', undefined, ['識別情報・管理列']),
        el('p', { class: 'muted' }, [
          'CrowdWorks の管理列です。集計・グラフ・summary.csv・analysis.json・' +
            'survey-summary.md・survey-free-text.md・cross-tab.csv には一切含めません。' +
            'チェックを入れると、回答一覧と responses.csv にだけ表示されます。',
        ]),
        list,
      );
      restoreFocus(focusKey);
    },
  };
}
