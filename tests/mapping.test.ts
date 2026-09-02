/**
 * src/core/mapping/profiles.ts と src/core/mapping/registry.ts のテスト。
 *
 * とくに重視するのは「設問の取り違え」の回帰防止。
 * ai-tools / main-ai / ai-usage / ai-ratio / without-ai / client-ai-rule /
 * disclosed-ai は列名が部分一致で紛らわしいため、
 * 実際に来そうな設問文をそのまま渡して解決先を固定しておく。
 */

import { describe, expect, it } from 'vitest';
import { CROWDWORKS_PROFILES, type QuestionProfile } from '../src/core/mapping/profiles.ts';
import { PROFILE_SETS, findProfile } from '../src/core/mapping/registry.ts';
import { normalizeHeader } from '../src/core/text.ts';
import type { ChartKind, OptionOrder, QuestionKind } from '../src/types.ts';

/** SPEC の必須プロファイル表（key / label / kind / chart / order） */
const SPEC_PROFILES: ReadonlyArray<{
  key: string;
  label: string;
  kind: QuestionKind;
  chart: ChartKind;
  order: OptionOrder;
}> = [
  { key: 'age', label: '年齢', kind: 'single', chart: 'bar', order: 'preset' },
  { key: 'gender', label: '性別', kind: 'single', chart: 'pie', order: 'preset' },
  { key: 'occupation', label: '現在の職種', kind: 'single', chart: 'hbar', order: 'count' },
  {
    key: 'channel',
    label: '仕事を受注したサービス・経路',
    kind: 'multiple',
    chart: 'hbar',
    order: 'count',
  },
  {
    key: 'start-year',
    label: '仕事を受注・開始した年',
    kind: 'single',
    chart: 'bar',
    order: 'natural',
  },
  {
    key: 'start-month',
    label: '仕事を受注・開始した月',
    kind: 'single',
    chart: 'bar',
    order: 'preset',
  },
  {
    key: 'job-category',
    label: '仕事の主なカテゴリ',
    // 実CSV（Q7）は枝番なしの2列セット＝単一選択
    kind: 'single',
    chart: 'hbar',
    order: 'count',
  },
  { key: 'job-detail', label: '具体的に行った仕事内容', kind: 'free', chart: 'none', order: 'count' },
  { key: 'contract-type', label: '契約・報酬形式', kind: 'single', chart: 'hbar', order: 'count' },
  { key: 'reward', label: '報酬', kind: 'single', chart: 'bar', order: 'preset' },
  { key: 'work-hours', label: '実際の作業時間', kind: 'single', chart: 'bar', order: 'preset' },
  {
    key: 'ai-tools',
    label: '使用したAI・AIツール',
    kind: 'multiple',
    chart: 'hbar',
    order: 'count',
  },
  { key: 'main-ai', label: '一番使ったAI', kind: 'single', chart: 'hbar', order: 'count' },
  { key: 'ai-usage', label: 'AIを何に使ったか', kind: 'multiple', chart: 'hbar', order: 'count' },
  { key: 'ai-ratio', label: 'AI利用割合', kind: 'single', chart: 'bar', order: 'preset' },
  {
    key: 'human-edit',
    label: 'AI出力を人間がどれくらい修正したか',
    kind: 'single',
    chart: 'bar',
    order: 'preset',
  },
  {
    key: 'without-ai',
    label: 'AIがなければ仕事を受けたか',
    kind: 'single',
    chart: 'pie',
    order: 'preset',
  },
  {
    key: 'client-ai-rule',
    label: 'クライアント側のAI利用ルール',
    kind: 'single',
    chart: 'hbar',
    order: 'preset',
  },
  {
    key: 'disclosed-ai',
    label: 'AI利用をクライアントに伝えたか',
    kind: 'single',
    chart: 'pie',
    order: 'preset',
  },
  { key: 'revision-count', label: '修正回数', kind: 'single', chart: 'bar', order: 'preset' },
  { key: 'job-result', label: '仕事の結果', kind: 'single', chart: 'hbar', order: 'preset' },
  {
    key: 'repeat-intent',
    label: 'また同じような仕事を受けたいか',
    kind: 'single',
    chart: 'hbar',
    order: 'preset',
  },
  { key: 'free-comment', label: '自由記述', kind: 'free', chart: 'none', order: 'count' },
];

/** SPEC が presetOptions を必須としている項目とその期待値 */
const SPEC_PRESET_OPTIONS: ReadonlyArray<[string, string[]]> = [
  ['age', ['18～24', '25～34', '35～44', '45～54', '55～64', '65～74', '75以上']],
  ['gender', ['女性', '男性', 'その他', '回答しない']],
  [
    'start-month',
    ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  ],
  [
    'ai-ratio',
    [
      'ほとんど使っていない(1～20%程度)',
      '一部で使った(21～40%程度)',
      '半分くらい使った(41～60%程度)',
      '大部分で使った(61～80%程度)',
      'ほぼAIを使った(81～100%程度)',
    ],
  ],
  [
    'human-edit',
    [
      'ほぼ修正していない',
      '少し修正した',
      'かなり修正した',
      'ほぼ作り直した',
      '何度も作り直した',
      'AIは完成物の作成には使っていない',
    ],
  ],
  [
    'without-ai',
    ['受けていた', 'たぶん受けていた', 'たぶん受けていなかった', '受けていなかった', 'わからない'],
  ],
  [
    'client-ai-rule',
    [
      'AI利用可と明記されていた',
      '条件付きでAI利用可だった',
      'AI利用禁止だった',
      'AIについての記載はなかった',
    ],
  ],
  ['disclosed-ai', ['伝えた', '伝えていない', 'AI利用を伝える必要がなかった', 'わからない']],
  [
    'repeat-intent',
    [
      'ぜひ受けたい',
      '条件次第で受けたい',
      '受けてもよい',
      'どちらとも言えない',
      'あまり受けたくない',
      '受けたくない',
      'わからない',
    ],
  ],
  [
    'job-result',
    [
      '問題なく完了した',
      '修正後に完了した',
      '高評価だった',
      '修正が多かった',
      '契約解除・不採用になった',
    ],
  ],
  [
    'reward',
    [
      '200円未満',
      '200～499円',
      '500～999円',
      '1,000～2,999円',
      '3,000～4,999円',
      '5,000～9,999円',
      '10,000～29,999円',
      '30,000～49,999円',
      '50,000～99,999円',
      '100,000～149,999円',
    ],
  ],
  ['work-hours', ['〜1時間', '1〜3時間', '3〜5時間', '5〜10時間', '10〜20時間', '20時間以上']],
  ['revision-count', ['0回', '1回', '2回', '3回', '4回', '5回', '6回以上']],
];

/** key からプロファイルを引く。無ければテストを失敗させる */
function profileOf(key: string): QuestionProfile {
  const found = CROWDWORKS_PROFILES.find((p) => p.key === key);
  if (!found) throw new Error(`プロファイルがありません: ${key}`);
  return found;
}

/** findProfile の結果の key を返す（未解決なら undefined） */
function keyOf(header: string): string | undefined {
  return findProfile(header)?.key;
}

describe('CROWDWORKS_PROFILES', () => {
  it('SPEC の必須23項目がすべて存在する', () => {
    // 設問プロファイルは23件。識別情報・管理列（identity 付き）はこれとは別枠。
    const surveyProfiles = CROWDWORKS_PROFILES.filter((p) => !p.identity);
    expect(surveyProfiles).toHaveLength(23);
    expect(SPEC_PROFILES).toHaveLength(23);

    const keys = CROWDWORKS_PROFILES.map((p) => p.key);
    for (const spec of SPEC_PROFILES) {
      expect(keys).toContain(spec.key);
    }
  });

  it('識別情報・管理列は4件あり、すべて kind=ignore になっている', () => {
    const identities = CROWDWORKS_PROFILES.filter((p) => p.identity);

    expect(identities.map((p) => p.identity).sort()).toEqual([
      'approved-at',
      'worker-id',
      'worker-name',
      'worker-url',
    ]);
    // ignore 以外だと集計・グラフ・AI向け出力に載ってしまう
    for (const p of identities) {
      expect(p.kind).toBe('ignore');
      expect(p.chart).toBe('none');
    }
  });

  it('key が重複していない', () => {
    const keys = CROWDWORKS_PROFILES.map((p) => p.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('key は英小文字とハイフンだけで構成されている', () => {
    for (const profile of CROWDWORKS_PROFILES) {
      expect(profile.key).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it('label / kind / chart / order が SPEC の表と一致する', () => {
    for (const spec of SPEC_PROFILES) {
      const profile = profileOf(spec.key);
      expect({
        key: profile.key,
        label: profile.label,
        kind: profile.kind,
        chart: profile.chart,
        order: profile.order,
      }).toEqual(spec);
    }
  });

  it('SPEC が指定する presetOptions を持つ', () => {
    for (const [key, options] of SPEC_PRESET_OPTIONS) {
      expect(profileOf(key).presetOptions).toEqual(options);
    }
  });

  it('数値になりうる項目には unit が設定されている', () => {
    expect(profileOf('reward').unit).toBe('円');
    expect(profileOf('work-hours').unit).toBe('時間');
    expect(profileOf('revision-count').unit).toBe('回');
  });

  it('各項目に3個以上のエイリアスがあり、項目内で重複していない', () => {
    for (const profile of CROWDWORKS_PROFILES) {
      expect(profile.aliases.length).toBeGreaterThanOrEqual(3);
      expect(new Set(profile.aliases).size).toBe(profile.aliases.length);
    }
  });

  it('エイリアスは normalizeHeader を通した形で書かれている', () => {
    for (const profile of CROWDWORKS_PROFILES) {
      for (const alias of profile.aliases) {
        expect(normalizeHeader(alias)).toBe(alias);
      }
    }
  });

  it('エイリアスが別項目と重複していない（完全一致で奪い合わない）', () => {
    const owner = new Map<string, string>();
    for (const profile of CROWDWORKS_PROFILES) {
      for (const alias of profile.aliases) {
        expect(owner.get(alias)).toBeUndefined();
        owner.set(alias, profile.key);
      }
    }
  });
});

describe('findProfile（AI関連設問の取り違え防止）', () => {
  it('"Q12. 使用したAI・AIツールをすべて選んでください" は ai-tools', () => {
    expect(keyOf('Q12. 使用したAI・AIツールをすべて選んでください')).toBe('ai-tools');
  });

  it('"一番使ったAIを教えてください" は main-ai', () => {
    expect(keyOf('一番使ったAIを教えてください')).toBe('main-ai');
  });

  it('"AIを何に使いましたか" は ai-usage', () => {
    expect(keyOf('AIを何に使いましたか')).toBe('ai-usage');
  });

  it('"AI利用割合" は ai-ratio', () => {
    expect(keyOf('AI利用割合')).toBe('ai-ratio');
  });

  it('"AIがなければこの仕事を受けましたか" は without-ai', () => {
    expect(keyOf('AIがなければこの仕事を受けましたか')).toBe('without-ai');
  });

  it('設問番号や敬体が付いた実データの列名でも取り違えない', () => {
    expect(keyOf('Q13. 一番よく使ったAIツールを1つ選んでください')).toBe('main-ai');
    expect(keyOf('Q14. AIを何に使いましたか（複数選択可）')).toBe('ai-usage');
    expect(keyOf('Q15. 作業全体のうちAIが担った割合はどのくらいですか？')).toBe('ai-ratio');
    expect(keyOf('Q16. AIの出力をどれくらい修正しましたか')).toBe('human-edit');
    expect(keyOf('Q18. クライアント側のAI利用ルールはありましたか')).toBe('client-ai-rule');
    expect(keyOf('Q19. AIを使ったことをクライアントに伝えましたか')).toBe('disclosed-ai');
  });
});

describe('findProfile（一般の設問）', () => {
  it('代表的な設問文が期待する key に解決される', () => {
    expect(keyOf('Q1. あなたの年齢を教えてください')).toBe('age');
    expect(keyOf('Q2. 性別')).toBe('gender');
    expect(keyOf('Q3. 現在の職種を教えてください')).toBe('occupation');
    expect(keyOf('Q4. 仕事を受注したサービス・経路（複数選択可）')).toBe('channel');
    expect(keyOf('Q5. 仕事を受注・開始した年')).toBe('start-year');
    expect(keyOf('Q6. 仕事を受注・開始した月')).toBe('start-month');
    expect(keyOf('Q7. 仕事の主なカテゴリ')).toBe('job-category');
    expect(keyOf('Q8. 具体的に行った仕事内容を教えてください')).toBe('job-detail');
    expect(keyOf('Q9. 契約・報酬形式')).toBe('contract-type');
    expect(keyOf('Q10. 受け取った報酬はいくらでしたか')).toBe('reward');
    expect(keyOf('Q11. 実際の作業時間')).toBe('work-hours');
    expect(keyOf('Q20. 修正回数は何回でしたか')).toBe('revision-count');
    expect(keyOf('Q21. 仕事の結果はどうなりましたか')).toBe('job-result');
    expect(keyOf('Q22. また同じような仕事を受けたいですか')).toBe('repeat-intent');
    expect(keyOf('Q23. 最後にご自由にコメントをどうぞ')).toBe('free-comment');
  });

  it('normalizeHeader 後の完全一致でも部分一致でも同じプロファイルに解決される', () => {
    expect(keyOf('年齢')).toBe('age');
    expect(keyOf('【必須】ご年齢は？')).toBe('age');
    expect(keyOf('あなたの年齢')).toBe('age');
  });

  it('どのエイリアスにも当たらなければ undefined', () => {
    expect(findProfile('タイムスタンプ')).toBeUndefined();
    expect(findProfile('メールアドレス')).toBeUndefined();
    expect(findProfile('')).toBeUndefined();
    expect(findProfile('   ')).toBeUndefined();
  });

  it('profiles 引数で照合対象を差し替えられる', () => {
    const custom: QuestionProfile[] = [
      {
        key: 'custom-key',
        label: 'カスタム設問',
        aliases: ['すきないろ'],
        kind: 'single',
        chart: 'bar',
        order: 'count',
      },
    ];

    expect(findProfile('Q1. すきないろ は？', custom)?.key).toBe('custom-key');
    // 差し替えたら CrowdWorks 側のプロファイルは参照されない
    expect(findProfile('年齢', custom)).toBeUndefined();
  });
});

describe('PROFILE_SETS', () => {
  it('crowdworks に CROWDWORKS_PROFILES が登録されている', () => {
    expect(PROFILE_SETS.crowdworks).toBe(CROWDWORKS_PROFILES);
  });
});
