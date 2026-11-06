// 실행: node test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(core + '\nObject.assign(globalThis,{parseKakao,pickPair,analyze,median,fmtMin,headline,sampleText,sampleEvents,slowPct});', ctx);
const { parseKakao, pickPair, analyze, median, fmtMin, headline, sampleText, sampleEvents, slowPct } = ctx;

const T = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

test('네 가지 형식이 같은 결과', () => {
  const want = sampleEvents().map(e => `${e.t}|${e.who}`).sort().join();
  for (const f of ['pc', 'mobile-kr', 'mobile-dot', 'csv']) {
    const got = parseKakao(sampleText(f)).msgs.map(e => `${e.t}|${e.who}`).sort().join();
    assert.equal(got, want, f);
  }
});

test('오전 12시는 0시, 오후 12시는 12시', () => {
  const { msgs } = parseKakao(`--------------- 2026년 1월 2일 금요일 ---------------
[가] [오전 12:05] a
[나] [오후 12:05] b`);
  assert.equal(msgs[0].t, T(2026, 1, 2, 0, 5));
  assert.equal(msgs[1].t, T(2026, 1, 2, 12, 5));
});

test('여러 줄 메시지와 시스템 줄은 세지 않는다', () => {
  const { msgs } = parseKakao(`2026. 1. 2. 오후 3:00, 가 : 첫 줄
둘째 줄
2026. 1. 2. 오후 3:01: 나님이 들어왔습니다.
2026. 1. 2. 오후 3:02, 나 : 시간 : 내용`);
  assert.deepEqual(Array.from(msgs, m => m.who), ['가', '나']);
});

test('BOM, CRLF, 제목으로 상대 판별', () => {
  const p = parseKakao('﻿봄이 님과 카카오톡 대화\r\n2026. 1. 2. 오후 3:00, 봄이 : a\r\n2026. 1. 2. 오후 3:01, 민수 : b\r\n');
  assert.equal(p.title, '봄이');
  assert.equal(pickPair(p).me, '민수');
});

test('빈 파일, 한 사람, 단톡방은 막는다', () => {
  assert.match(pickPair(parseKakao('아무 글')).error, /찾지 못/);
  assert.match(pickPair(parseKakao('2026. 1. 2. 오후 3:00, 가 : a')).error, /한 사람/);
  const room = ['가', '나', '다'].map((w, i) => `2026. 1. 2. 오후 3:0${i}, ${w} : a`).join('\n');
  assert.match(pickPair(parseKakao(room)).error, /단톡방/);
});

test('지표를 손으로 계산한 값과 비교', () => {
  const m = [
    [T(2026, 1, 1, 10, 0), '나'],    // 첫 대화: 내가 시작
    [T(2026, 1, 1, 10, 10), '상대'], // 상대 답장 10분
    [T(2026, 1, 1, 10, 12), '상대'], // 연속 메시지: 답장 아님
    [T(2026, 1, 1, 10, 16), '나'],   // 내 답장 4분
    [T(2026, 1, 1, 23, 0), '상대'],  // 12시간 뒤: 상대 시작, 밤
    [T(2026, 1, 3, 1, 0), '나'],     // 26시간 뒤: 내가 재개, 밤
  ].map(([t, who]) => ({ t, who }));
  const r = analyze(m, '나');
  assert.deepEqual({ ...r.starts }, { me: 2, other: 1 });
  assert.deepEqual({ ...r.back }, { me: 1, other: 0 });
  assert.deepEqual([...r.rep.me], [4]);
  assert.deepEqual([...r.rep.other], [10]);
  assert.equal(r.night, 2);
  assert.equal(r.unit, 'week');
  assert.equal(r.buckets.reduce((s, b) => s + b.me + b.other, 0), 6);
});

test('예시는 처음보다 식는 이야기다', () => {
  const p = pickPair(parseKakao(sampleText()));
  assert.equal(p.me, '나');
  const r = analyze(p.msgs, '나');
  assert.equal(r.unit, 'month');
  assert.equal(r.buckets.reduce((s, b) => s + b.me + b.other, 0), r.total);
  assert.ok(r.moments.down && r.moments.up);
  assert.match(headline(r), /줄었습니다.*내가 먼저/);
});

test('중앙값과 시간 표기', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(fmtMin(0), '1분 안에');
  assert.equal(fmtMin(90), '1시간 30분');
  assert.equal(fmtMin(120), '2시간');
});

test('늦은 답장 비율', () => {
  assert.equal(slowPct([1, 2, 10, 30]), 50);
  assert.equal(slowPct([9.9]), 0);
  assert.equal(slowPct([]), null);
});

test('실제 형식: 날짜 줄에 시각이 붙고 요일이 없다', () => {
  const { msgs } = parseKakao(`봄이 님과 카카오톡 대화
저장한 날짜 : 2026년 10월 20일 오후 9:00


2026년 7월 3일 오전 12:10
2026년 7월 3일 오전 12:10, 봄이 : a
2026년 7월 3일 오후 12:11, 민수 : b`);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].t, T(2026, 7, 3, 0, 10));
  assert.equal(msgs[1].t, T(2026, 7, 3, 12, 11));
});

console.log(`\n${n}개 통과`);
