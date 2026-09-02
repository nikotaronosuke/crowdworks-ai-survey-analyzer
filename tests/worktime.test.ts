/**
 * src/core/worktime.ts のテスト。
 *
 * 方針は「確実に読み取れる形だけ数値化する」。
 * 単位が無い値・意味が一意に定まらない記述は必ず null（解析不能）にする。
 * 実CSVに実在した表記を、成功例・失敗例の両方から採っている。
 */

import { describe, expect, it } from 'vitest';

import {
  UNPARSED_LABEL,
  WORK_MINUTES_BINS,
  parseWorkDays,
  parseWorkMinutes,
  workDaysCell,
  workMinutesCell,
  workMinutesBinLabel,
} from '../src/core/worktime.ts';

/** 実CSVと同じ「作業日数 / 合計作業時間」の2行形式を作る */
function cell(days: string, minutes: string): string {
  return `- 作業日数：${days}\n- 合計作業時間：${minutes}`;
}

describe('parseWorkDays', () => {
  it('明確な日数表記を数値にする', () => {
    expect(parseWorkDays('1日')).toBe(1);
    expect(parseWorkDays('１日')).toBe(1); // 全角
    expect(parseWorkDays('一日')).toBe(1); // 漢数字
    expect(parseWorkDays('3日')).toBe(3);
    expect(parseWorkDays('３日')).toBe(3);
    expect(parseWorkDays('10日')).toBe(10);
  });

  it('ラベル付きの行から取り出す', () => {
    expect(parseWorkDays(cell('1日', '3時間'))).toBe(1);
    expect(parseWorkDays(cell('５日', '15時間'))).toBe(5);
    expect(parseWorkDays(cell('一日', '3時間'))).toBe(1);
    // 全角空白が挟まっていても読める
    expect(parseWorkDays(cell('　1日', '10分'))).toBe(1);
  });

  it('ラベル直後の単位なし整数は日数として読む', () => {
    // 「作業日数」というラベルがある以上、単位が無くても日数と確定できる
    expect(parseWorkDays(cell('2', '1時間30分'))).toBe(2);
    expect(parseWorkDays(cell('7', '10時間'))).toBe(7);
  });

  it('意味が一意に決まらない記述は解析しない', () => {
    expect(parseWorkDays(cell('半日以下', '1時間程度'))).toBeNull();
    expect(parseWorkDays(cell('3週間', '15時間'))).toBeNull();
    expect(parseWorkDays(cell('3ヶ月 週5', '8時間'))).toBeNull();
    expect(parseWorkDays('約8時間')).toBeNull(); // 日数の記述が無い
    expect(parseWorkDays('1日〜2日')).toBeNull();
    expect(parseWorkDays('')).toBeNull();
  });

  it('ラベルが無い文章から数字を拾わない', () => {
    expect(
      parseWorkDays('応募に1分（AIに作ってもらったテンプレート使用）、作業に3分です。'),
    ).toBeNull();
    expect(parseWorkDays('6時間ほどかかりました。構成の確認に時間を使いました。')).toBeNull();
  });

  it('0日や負数は解析不能として扱う', () => {
    expect(parseWorkDays('0日')).toBeNull();
    expect(parseWorkDays(cell('0', '1時間'))).toBeNull();
  });
});

describe('parseWorkMinutes', () => {
  it('時間・分の表記を分に直す', () => {
    expect(parseWorkMinutes('30分')).toBe(30);
    expect(parseWorkMinutes('3時間')).toBe(180);
    expect(parseWorkMinutes('5時間30分')).toBe(330);
    expect(parseWorkMinutes('1時間30分')).toBe(90);
    expect(parseWorkMinutes('1時間半')).toBe(90);
    expect(parseWorkMinutes('1時間半程')).toBe(90);
    expect(parseWorkMinutes('約3時間')).toBe(180);
    expect(parseWorkMinutes('6時間ほど')).toBe(360);
    expect(parseWorkMinutes('1時間程度')).toBe(60);
  });

  it('全角数字にも対応する', () => {
    expect(parseWorkMinutes('３時間')).toBe(180);
    expect(parseWorkMinutes('３０分')).toBe(30);
    expect(parseWorkMinutes('１時間３０分')).toBe(90);
  });

  it('ラベル付きの行から取り出す', () => {
    expect(parseWorkMinutes(cell('1日', '3時間'))).toBe(180);
    expect(parseWorkMinutes(cell('3日', '5時間30分'))).toBe(330);
    expect(parseWorkMinutes(cell('2日', '1時間半程'))).toBe(90);
    // 日数が解析不能でも、合計作業時間は独立して読める
    expect(parseWorkMinutes(cell('半日以下', '1時間程度'))).toBe(60);
    expect(parseWorkMinutes(cell('3週間', '15時間'))).toBe(900);
  });

  it('単位が無い数字は解析しない', () => {
    expect(parseWorkMinutes(cell('2', '8'))).toBeNull();
    expect(parseWorkMinutes(cell('3', '１６'))).toBeNull();
    expect(parseWorkMinutes('8')).toBeNull();
  });

  it('複数の時間が別々の意味で並ぶ文章は解析しない', () => {
    expect(
      parseWorkMinutes('応募に1分（AIに作ってもらったテンプレート使用）、作業に3分です。'),
    ).toBeNull();
  });

  it('文章の途中から数字を拾わない', () => {
    expect(
      parseWorkMinutes('6時間ほどかかりました。構成の確認や情報収集に時間を使いました。'),
    ).toBeNull();
  });

  it('ラベルが無くても、値そのものだけの回答は読む', () => {
    expect(parseWorkMinutes('約8時間')).toBe(480);
  });

  it('分が60以上の不正な組み合わせは解析しない', () => {
    expect(parseWorkMinutes('1時間90分')).toBeNull();
  });

  it('空欄は解析しない', () => {
    expect(parseWorkMinutes('')).toBeNull();
    expect(parseWorkMinutes('   ')).toBeNull();
  });
});

describe('workMinutesBinLabel', () => {
  it('依頼された時間帯に割り当てる', () => {
    expect(workMinutesBinLabel(5)).toBe('30分未満');
    expect(workMinutesBinLabel(29)).toBe('30分未満');
    expect(workMinutesBinLabel(30)).toBe('30分~1時間未満');
    expect(workMinutesBinLabel(59)).toBe('30分~1時間未満');
    expect(workMinutesBinLabel(60)).toBe('1~2時間未満');
    expect(workMinutesBinLabel(119)).toBe('1~2時間未満');
    expect(workMinutesBinLabel(120)).toBe('2~3時間未満');
    expect(workMinutesBinLabel(180)).toBe('3~5時間未満');
    expect(workMinutesBinLabel(299)).toBe('3~5時間未満');
    expect(workMinutesBinLabel(300)).toBe('5~10時間未満');
    expect(workMinutesBinLabel(599)).toBe('5~10時間未満');
    expect(workMinutesBinLabel(600)).toBe('10~20時間未満');
    expect(workMinutesBinLabel(1199)).toBe('10~20時間未満');
    expect(workMinutesBinLabel(1200)).toBe('20時間以上');
  });

  it('返すラベルは必ず WORK_MINUTES_BINS のいずれか', () => {
    for (const m of [0, 1, 45, 90, 150, 240, 480, 900, 1500, 6000]) {
      expect(WORK_MINUTES_BINS).toContain(workMinutesBinLabel(m));
    }
  });
});

describe('派生セルの値', () => {
  it('解析できたら値、できなければ解析不能ラベル', () => {
    expect(workDaysCell(cell('3日', '4時間'))).toBe('3日');
    expect(workDaysCell(cell('半日以下', '1時間'))).toBe(UNPARSED_LABEL);
    // 3時間ちょうどは「3~5時間未満」に入る（各ビンは下限を含み上限を含まない）
    expect(workMinutesCell(cell('1日', '3時間'))).toBe('3~5時間未満');
    expect(workMinutesCell(cell('1日', '2時間30分'))).toBe('2~3時間未満');
    expect(workMinutesCell(cell('2', '8'))).toBe(UNPARSED_LABEL);
  });

  it('元の回答が空欄なら空文字（母数から外す）', () => {
    // 未回答と「回答はあるが解析できない」を混同しないための区別
    expect(workDaysCell('')).toBe('');
    expect(workDaysCell('   ')).toBe('');
    expect(workMinutesCell('')).toBe('');
  });

  it('解析不能を 0 や空時間として扱わない', () => {
    expect(workDaysCell(cell('3ヶ月 週5', '8時間'))).not.toBe('0日');
    expect(workDaysCell(cell('3ヶ月 週5', '8時間'))).not.toBe('');
    expect(workMinutesCell(cell('2', '8'))).not.toBe('30分未満');
    expect(workMinutesCell(cell('2', '8'))).not.toBe('');
  });
});
