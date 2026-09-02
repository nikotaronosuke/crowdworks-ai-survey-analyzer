/**
 * CrowdWorks 生成AI仕事アンケート用の質問プロファイル定義。
 *
 * ここに定義したプロファイルは registry.ts の findProfile が
 * 生の列名（設問文）と照合するために使う。
 * aliases は必ず text.ts の normalizeHeader を通した後の形
 * （NFKC・小文字・空白なし・記号なし）で書くこと。
 */

import type { ChartKind, IdentityKind, OptionOrder, QuestionKind } from '../../types.ts';

/** 1つの設問に対する既定の解釈（種別・グラフ・並び順・選択肢の正規化規則） */
export interface QuestionProfile {
  /** canonical key（英小文字とハイフン） */
  key: string;
  label: string;
  /** 列名の照合パターン。normalizeHeader 済みの文字列で書く */
  aliases: string[];
  kind: QuestionKind;
  chart: ChartKind;
  order: OptionOrder;
  presetOptions?: string[];
  optionAliases?: Record<string, string>;
  unit?: string;
  /** 複数回答のときの区切り文字（省略時 SAFE_DELIMITERS） */
  delimiters?: string[];
  /**
   * 識別情報・管理列のときだけ設定する。
   * 設定するプロファイルは kind を必ず 'ignore' にすること
   * （集計・グラフ・AI向け出力へ載せないため）。
   */
  identity?: IdentityKind;
}

/**
 * AI ツール名の表記ゆれ → 正規ラベル。
 * ai-tools（複数回答）と main-ai（単一回答）で同じ辞書を共有する。
 * キーは正規化前の生表記でよい（splitter.ts の canonicalizeOption が
 * normalizeKey ベースで照合するため、大文字小文字・全角半角は吸収される）。
 */
const AI_TOOL_OPTION_ALIASES: Record<string, string> = {
  // ChatGPT: 綴り・空白・カタカナ表記の揺れだけを寄せる。
  // "OpenAI" "GPT" "GPT-4" などは ChatGPT 以外を指しうるので変換しない。
  chatgpt: 'ChatGPT',
  'chat gpt': 'ChatGPT',
  'チャットgpt': 'ChatGPT',
  'チャット gpt': 'ChatGPT',
  // Claude
  claude: 'Claude',
  'claude ai': 'Claude',
  'クロード': 'Claude',
  // Gemini: Bard は当時の名称として保持する（受注年月との時系列比較に使うため変換しない）
  gemini: 'Gemini',
  'google gemini': 'Gemini',
  'ジェミニ': 'Gemini',
  // Copilot: 提供元が異なる別製品なので、明示されているものだけを正規化する。
  // 単独の "Copilot" は GitHub / Microsoft のどちらか判断できないため変換しない。
  'github copilot': 'GitHub Copilot',
  'microsoft copilot': 'Microsoft Copilot',
  // 綴りの揺れが起きやすいものだけ
  perplexity: 'Perplexity',
  midjourney: 'Midjourney',
  'stable diffusion': 'Stable Diffusion',
  notebooklm: 'NotebookLM',
  felo: 'Felo',
  'canva ai': 'Canva AI',
};

/*
 * 「13. 上記の中で一番使ったAIは何ですか？」は自由入力のため表記ゆれが実在する。
 * ここに1行足すだけで main-ai / ai-tools の集計に反映される。
 * キーは正規化前の生表記でよい（normalizeKey が大文字小文字・全角半角・空白を吸収する）。
 *
 * 追加してよいのは「同じ製品の明らかな綴り違い」だけ。
 * 意味を推測しないと分類できない回答（"OpenAI" "GPT" 単独の "Copilot" "Adobe" など）は
 * 元表記のまま残す。まとめたい場合は集計後の分析側で行うこと。
 */

/** 性別の表記ゆれ → 正規ラベル */
const GENDER_OPTION_ALIASES: Record<string, string> = {
  male: '男性',
  female: '女性',
  man: '男性',
  woman: '女性',
  '男': '男性',
  '女': '女性',
  '答えたくない': '回答しない',
  '回答したくない': '回答しない',
  '無回答': '回答しない',
  '未回答': '回答しない',
};

/**
 * CrowdWorks 生成AI仕事アンケート用のプロファイル一覧（23項目）。
 *
 * 配列の順序は findProfile の同点時の優先順位になる（先に定義したものが勝つ）。
 * エイリアスは「取り違え防止」を最優先に設計してある。とくに "ai" を含む
 * 7項目（ai-tools / main-ai / ai-usage / ai-ratio / without-ai /
 * disclosed-ai / client-ai-rule）は、判別語（一番・最も・何に使・割合・
 * なければ・伝え・ルール）を必ず含む長めのエイリアスにしている。
 * findProfile は「マッチしたエイリアスが最長のもの」を採るため、
 * 汎用的な語（例: 'aiツール'）より判別語つきの語が長くなるようにしてある。
 *
 * delimiters は意図的に未設定（＝SAFE_DELIMITERS）。'・' や '/' で割ると
 * "画像・動画生成" のような1つの選択肢を壊すため、既定では使わない。
 */
export const CROWDWORKS_PROFILES: QuestionProfile[] = [
  {
    key: 'age',
    label: '年齢',
    aliases: ['あなたの年齢', 'ご年齢', '年齢を教え', '年齢層', '年代', 'おいくつ'],
    kind: 'single',
    chart: 'bar',
    order: 'preset',
    // 実CSVの選択肢（波ダッシュは NFKC で半角化されるため、どちらの表記でも照合できる）
    presetOptions: ['18～24', '25～34', '35～44', '45～54', '55～64', '65～74', '75以上'],
  },
  {
    key: 'gender',
    label: '性別',
    aliases: ['あなたの性別', 'ご性別', '性別を教え', '性自認', 'gender'],
    kind: 'single',
    chart: 'pie',
    order: 'preset',
    presetOptions: ['女性', '男性', 'その他', '回答しない'],
    optionAliases: GENDER_OPTION_ALIASES,
  },
  {
    key: 'occupation',
    label: '現在の職種',
    aliases: ['現在の職種', '職種を教え', 'ご職種', '本業の職種', 'どんな職種', '職種', '職業'],
    kind: 'single',
    chart: 'hbar',
    order: 'count',
  },
  {
    key: 'channel',
    label: '仕事を受注したサービス・経路',
    aliases: [
      '受注したサービス',
      '受注したプラットフォーム',
      '仕事を受けたサービス',
      'どこで仕事を受注',
      'クラウドソーシング',
      '案件の獲得経路',
      'サービス経路',
      '受注経路',
    ],
    kind: 'multiple',
    chart: 'hbar',
    order: 'count',
  },
  {
    key: 'start-year',
    label: '仕事を受注・開始した年',
    aliases: [
      '受注開始した年',
      '仕事を始めた年',
      '受注した年',
      '開始した年',
      '着手した年',
      '受注年',
      '開始年',
      '西暦',
    ],
    kind: 'single',
    chart: 'bar',
    order: 'natural',
  },
  {
    key: 'start-month',
    label: '仕事を受注・開始した月',
    aliases: [
      '受注開始した月',
      '仕事を始めた月',
      '受注した月',
      '開始した月',
      '着手した月',
      '受注月',
      '開始月',
      '何月',
    ],
    kind: 'single',
    chart: 'bar',
    order: 'preset',
    presetOptions: [
      '1月',
      '2月',
      '3月',
      '4月',
      '5月',
      '6月',
      '7月',
      '8月',
      '9月',
      '10月',
      '11月',
      '12月',
    ],
  },
  {
    key: 'job-category',
    // 実CSV（Q7）は枝番なしの2列セット＝単一選択。52回答すべて1ラベルだけを持つ。
    label: '仕事の主なカテゴリ',
    aliases: [
      '仕事のカテゴリ',
      '案件のカテゴリ',
      '主なカテゴリ',
      '業務カテゴリ',
      '仕事のジャンル',
      '仕事の種類',
      '案件の種類',
      'カテゴリ',
    ],
    kind: 'single',
    chart: 'hbar',
    order: 'count',
  },
  {
    key: 'job-detail',
    label: '具体的に行った仕事内容',
    aliases: [
      '具体的に行った仕事',
      '具体的な仕事内容',
      'どのような仕事をした',
      '実際に行った作業',
      '仕事内容',
      '業務内容',
      '作業内容',
      '案件内容',
    ],
    kind: 'free',
    chart: 'none',
    order: 'count',
  },
  {
    key: 'contract-type',
    label: '契約・報酬形式',
    aliases: [
      '固定報酬か時間単価',
      '契約報酬の形式',
      '報酬形式',
      '報酬の形態',
      '契約形式',
      '契約形態',
      '契約の種類',
      '支払い形式',
    ],
    kind: 'single',
    chart: 'hbar',
    order: 'count',
  },
  {
    key: 'reward',
    label: '報酬',
    aliases: ['受け取った報酬', '報酬はいくら', '報酬の総額', '報酬金額', '報酬額', '金額', '単価', '売上'],
    kind: 'single',
    chart: 'bar',
    order: 'preset',
    unit: '円',
    // 実CSVの金額バンド。ラベルにカンマを含むが、単一選択なので分割されない
    presetOptions: [
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
  },
  {
    key: 'work-hours',
    label: '実際の作業時間',
    aliases: [
      '作業にかかった時間',
      '実際の作業時間',
      'かかった時間',
      '作業時間',
      '稼働時間',
      '所要時間',
      '制作時間',
      '何時間',
    ],
    kind: 'single',
    chart: 'bar',
    order: 'preset',
    unit: '時間',
    presetOptions: ['〜1時間', '1〜3時間', '3〜5時間', '5〜10時間', '10〜20時間', '20時間以上'],
  },
  {
    key: 'ai-tools',
    label: '使用したAI・AIツール',
    // 判別語を持つ他項目（main-ai など）に必ず負けるよう、短めの汎用語に留める
    aliases: [
      '使用したaiaiツール',
      '使用aiツール',
      '生成aiツール',
      'aiサービス',
      'aiツール',
      '使用したai',
      '利用したai',
      '使ったai',
    ],
    kind: 'multiple',
    chart: 'hbar',
    order: 'count',
    optionAliases: AI_TOOL_OPTION_ALIASES,
  },
  {
    key: 'main-ai',
    label: '一番使ったAI',
    // 「一番 / 最も / メイン」を必ず含み、ai-tools の汎用語より長くしてある
    aliases: [
      '一番使った生成ai',
      '最もよく使ったai',
      '一番よく使ったai',
      'メインで使ったai',
      '一番使用したai',
      '一番利用したai',
      '一番使ったai',
      '最も使ったai',
    ],
    kind: 'single',
    chart: 'hbar',
    order: 'count',
    optionAliases: AI_TOOL_OPTION_ALIASES,
  },
  {
    key: 'ai-usage',
    label: 'AIを何に使ったか',
    // 「何に使 / 用途 / 使い道」を必ず含める
    aliases: [
      '使用したaiの用途',
      'aiを使った業務',
      'どんな作業に使',
      'aiの活用場面',
      'aiの使い道',
      'aiの用途',
      'aiを何に',
      '何に使',
    ],
    kind: 'multiple',
    chart: 'hbar',
    order: 'count',
  },
  {
    key: 'ai-ratio',
    label: 'AI利用割合',
    // 「割合」に加えて、実CSVの設問文（15. 仕事全体のうち、AIをどのくらい使いましたか？）を拾う
    aliases: [
      'aiをどのくらい使い',
      'aiツールの利用割合',
      '仕事全体のうち',
      'aiが占めた割合',
      'aiの利用割合',
      'ai利用の割合',
      'ai利用割合',
      'aiの割合',
      '割合',
    ],
    kind: 'single',
    chart: 'bar',
    order: 'preset',
    presetOptions: [
      'ほとんど使っていない(1～20%程度)',
      '一部で使った(21～40%程度)',
      '半分くらい使った(41～60%程度)',
      '大部分で使った(61～80%程度)',
      'ほぼAIを使った(81～100%程度)',
    ],
  },
  {
    key: 'human-edit',
    label: 'AI出力を人間がどれくらい修正したか',
    aliases: [
      'aiが作ったものをどのくらい人間が修正',
      'aiが作ったものを',
      'ai出力をどれくらい修正',
      'aiの出力を修正',
      'ai出力の修正',
      'どれくらい修正',
      '修正の度合い',
      '人間が修正',
      '手直し',
    ],
    kind: 'single',
    chart: 'bar',
    order: 'preset',
    presetOptions: [
      'ほぼ修正していない',
      '少し修正した',
      'かなり修正した',
      'ほぼ作り直した',
      '何度も作り直した',
      'AIは完成物の作成には使っていない',
    ],
  },
  {
    key: 'without-ai',
    label: 'AIがなければ仕事を受けたか',
    // 「なければ / なかったら / なしで」を必ず含める
    aliases: [
      'aiを使わない場合',
      'aiなしでも受け',
      'aiがなかったら',
      'aiがなくても',
      'aiがない場合',
      'aiがなければ',
      'aiが無ければ',
      'aiなしでも',
    ],
    kind: 'single',
    chart: 'pie',
    order: 'preset',
    presetOptions: [
      '受けていた',
      'たぶん受けていた',
      'たぶん受けていなかった',
      '受けていなかった',
      'わからない',
    ],
  },
  {
    key: 'client-ai-rule',
    label: 'クライアント側のAI利用ルール',
    // 「ルール」を必ず含める
    aliases: [
      'ai利用に関するルール',
      'ai利用についてのルール',
      'クライアント側のai',
      'ai利用のルール',
      'aiの利用ルール',
      'ai利用ルール',
      'ai利用の可否',
      'ai利用の条件',
      'ルール',
    ],
    kind: 'single',
    chart: 'hbar',
    order: 'preset',
    presetOptions: [
      'AI利用可と明記されていた',
      '条件付きでAI利用可だった',
      'AI利用禁止だった',
      'AIについての記載はなかった',
    ],
  },
  {
    key: 'disclosed-ai',
    label: 'AI利用をクライアントに伝えたか',
    // 「伝え / 開示 / 申告」を必ず含める
    aliases: [
      'クライアントに伝え',
      'aiの利用を伝え',
      'ai利用を開示',
      'ai利用の開示',
      'ai利用を申告',
      'ai利用を伝え',
      'ai使用を伝え',
      '伝えましたか',
    ],
    kind: 'single',
    chart: 'pie',
    order: 'preset',
    presetOptions: ['伝えた', '伝えていない', 'AI利用を伝える必要がなかった', 'わからない'],
  },
  {
    key: 'revision-count',
    label: '修正回数',
    aliases: [
      '修正を求められた回数',
      '修正依頼の回数',
      'リテイク数',
      '修正の回数',
      '修正は何回',
      '何回修正',
      '修正回数',
      '修正依頼',
    ],
    kind: 'single',
    chart: 'bar',
    order: 'preset',
    unit: '回',
    presetOptions: ['0回', '1回', '2回', '3回', '4回', '5回', '6回以上'],
  },
  {
    key: 'job-result',
    label: '仕事の結果',
    aliases: [
      '受注した仕事の結果',
      'クライアントの評価',
      '評価はどうだった',
      '結果はどうなった',
      '仕事の成否',
      '納品の結果',
      '案件の結果',
      '仕事の結果',
    ],
    kind: 'single',
    chart: 'hbar',
    order: 'preset',
    presetOptions: [
      '問題なく完了した',
      '修正後に完了した',
      '高評価だった',
      '修正が多かった',
      '契約解除・不採用になった',
    ],
  },
  {
    key: 'repeat-intent',
    label: 'また同じような仕事を受けたいか',
    aliases: [
      '似たような仕事があった場合',
      'また同じように受けたい',
      '同じような仕事を受けたい',
      '継続して受けたい',
      '今後の受注意向',
      '次も受けたい',
      'また同じ仕事',
      'また受けたい',
      '再度受けたい',
    ],
    kind: 'single',
    chart: 'hbar',
    order: 'preset',
    presetOptions: [
      'ぜひ受けたい',
      '条件次第で受けたい',
      '受けてもよい',
      'どちらとも言えない',
      'あまり受けたくない',
      '受けたくない',
      'わからない',
    ],
  },
  {
    key: 'free-comment',
    label: '自由記述',
    aliases: [
      '何かあればこちらへ',
      'その他ご意見',
      '最後に一言',
      '自由回答',
      '何かあれば',
      'ご自由に',
      'コメント',
      'ご意見',
      '感想',
    ],
    kind: 'free',
    chart: 'none',
    order: 'count',
  },

  // ---- ここから下は CrowdWorks の識別情報・管理列（アンケートの設問ではない）----
  // kind は必ず 'ignore'。集計・グラフ・AI向け出力には構造的に載らない。
  // 回答一覧と responses.csv にだけ、UI のチェックで表示を切り替えて出す。
  {
    key: 'worker-name',
    label: '作業者名',
    // CrowdWorks の実CSVの列名は「作業者名」ではなく「作業者」。
    // '作業者' は '作業者ページurl' の部分文字列でもあるが、
    // findProfile は最長一致優先なので worker-url を奪わない。
    aliases: ['作業者名', '作業者', 'ワーカー名', '応募者名', '会員名', 'ユーザー名', 'ニックネーム'],
    kind: 'ignore',
    chart: 'none',
    order: 'count',
    identity: 'worker-name',
  },
  {
    key: 'worker-url',
    label: '作業者ページURL',
    aliases: [
      '作業者ページurl',
      '作業者ページ',
      'ワーカーページurl',
      'プロフィールurl',
      'ユーザーページurl',
      '会員ページurl',
    ],
    kind: 'ignore',
    chart: 'none',
    order: 'count',
    identity: 'worker-url',
  },
  {
    key: 'worker-id',
    label: '作業ID',
    aliases: ['作業id', '作業no', 'タスクid', 'ワークid', '応募id', '回答id'],
    kind: 'ignore',
    chart: 'none',
    order: 'count',
    identity: 'worker-id',
  },
  {
    key: 'approved-at',
    label: '承認日時',
    aliases: ['承認日時', '承認日', '検収日時', '検収日', '承認日付'],
    kind: 'ignore',
    chart: 'none',
    order: 'count',
    identity: 'approved-at',
  },
];

/*
 * 新しい設問を足すときの手順:
 * 1. CROWDWORKS_PROFILES の末尾（または関連項目の近く）に QuestionProfile を1つ追加する。
 *    key は英小文字とハイフンで、既存と重複しない canonical key にする。
 * 2. aliases は normalizeHeader を通した形（小文字・空白なし・記号なし）で4〜8個書く。
 *    実際の設問文に部分一致するよう、短めの特徴語も混ぜる。
 * 3. 似た設問（とくに "ai" を含むもの）と取り違えないか確認する。findProfile は
 *    「マッチしたエイリアスが最長」を採るので、判別語を含む長いエイリアスを与える。
 * 4. 選択肢式なら presetOptions（表示したい順）、表記ゆれがあれば optionAliases、
 *    数値項目なら unit を設定する。order は preset / count / natural から選ぶ。
 * 5. 追加後は registry.ts の findProfile に実際の設問文を渡して、意図した key に
 *    解決されること・既存の設問が奪われていないことをテストで確認する。
 */
