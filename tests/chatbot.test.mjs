import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, resolvePeriod } from '../src/chatbot.js';

const now = '2026-11-03';
const context = {
  status: 'ready', deliveryEnabled: true, offline: false, year: 2026, month: 11,
  transactions: [
    { id: 'salary-y', date: '2026-11-01', person: 'y', type: 'income', amount: 3000000, paid: true, title: '급여' },
    { id: 'salary-s', date: '2026-11-01', person: 's', type: 'income', amount: 2000000, paid: true, title: '급여' },
    { id: 'food-y', date: '2026-11-02', person: 'y', type: 'expense', amount: 500000, paid: true, title: '식비', category: '식비', paymentMethod: '카드' },
    { id: 'insurance-y', date: '2026-11-02', person: 'y', type: 'expense', amount: 200000, paid: false, title: '보험료', category: '보험' },
    { id: 'food-s', date: '2026-11-02', person: 's', type: 'expense', amount: 300000, paid: false, title: '식비', category: '식비' },
    { id: 'old-income', date: '2026-10-01', person: 'y', type: 'income', amount: 4000000, paid: true, title: '급여' },
    { id: 'old-expense', date: '2026-10-02', person: 'y', type: 'expense', amount: 1100000, paid: true, title: '생활비' }
  ],
  rules: [{ id: 'rent', person: 'y', type: 'expense', title: '월세', amount: 400000, category: '주거', startMonth: '2026-11', endMonth: '', day: 2, installments: 0 }],
  cardDetails: [
    { id: 'fuel', cardName: '신한카드', person: 'y', date: '2026-11-05', title: '주유비', category: '교통·차량', amount: 50000, paymentType: 'single', installmentMonths: 0, memo: '' },
    { id: 'repair', cardName: '신한카드', person: 'y', date: '2026-11-05', title: '차량 수리비', category: '교통·차량', amount: 200000, paymentType: 'installment', installmentMonths: 3, memo: '' }
  ],
  earnings: [
    { workDate: '2026-10-12', platform: '쿠팡이츠', grossIncome: 200000, deliveryCount: 8, workHours: 10, distanceKm: 100 },
    { workDate: '2026-11-02', platform: '쿠팡이츠', grossIncome: 100000, deliveryCount: 3, workHours: 4, distanceKm: 30 },
    { workDate: '2026-11-03', platform: '배민커넥트', grossIncome: 60000, deliveryCount: 2, workHours: 3, distanceKm: 20 }
  ],
  expenses: [{ workDate: '2026-10-12', amount: 50000 }, { workDate: '2026-11-02', amount: 20000 }],
  investments: [{ workDate: '2026-10-01', amount: 500000, category: '차량' }]
};
const ask = (question, data = context) => answerQuestion(question, data, now).text;

test('서울 시간과 화면 선택 연도를 기준으로 여러 기간을 해석한다', () => {
  assert.deepEqual(resolvePeriod('오늘', 2026, 11, now), { start: '2026-11-03', end: '2026-11-03', label: '오늘' });
  assert.equal(resolvePeriod('어제', 2026, 11, now).start, '2026-11-02');
  assert.equal(resolvePeriod('이번 주', 2026, 11, now).start, '2026-11-02');
  assert.equal(resolvePeriod('지난주', 2026, 11, now).end, '2026-11-01');
  assert.equal(resolvePeriod('지난달 지출', 2026, 11, now).start, '2026-10-01');
  assert.equal(resolvePeriod('지난달 대비 지출', 2026, 11, now).start, '2026-11-01');
  assert.equal(resolvePeriod('올해 수입', 2026, 11, now).start, '2026-01-01');
  assert.equal(resolvePeriod('작년 지출', 2026, 11, now).end, '2025-12-31');
  assert.equal(resolvePeriod('최근 3개월', 2026, 11, now).start, '2026-09-01');
  assert.equal(resolvePeriod('최근 6개월', 2026, 11, now).start, '2026-06-01');
  assert.equal(resolvePeriod('2027년 1월 수입', 2026, 11, now).start, '2027-01-01');
  assert.equal(resolvePeriod('1월부터 6월까지', 2026, 11, now).end, '2026-06-30');
  assert.equal(resolvePeriod('11월 지출', 2025, 4, now).start, '2025-11-01');
});

test('가계부 금액은 화면의 반복 예정 및 납부 상태 계산과 일치한다', () => {
  assert.match(ask('이번 달 우리집 총수입'), /5,000,000원/);
  assert.match(ask('이번 달 지출 얼마야?'), /1,400,000원/);
  assert.match(ask('이번 달 얼마나 썼어?'), /1,400,000원/);
  assert.match(ask('이번 달 남은 돈'), /3,600,000원/);
  assert.match(ask('실제 잔여 금액'), /4,500,000원/);
  assert.match(ask('용현 개인 지출'), /1,100,000원/);
  assert.match(ask('선영 개인 지출'), /300,000원/);
  assert.match(ask('미납 예정 금액'), /900,000원/);
  assert.match(ask('이번 달 카드값'), /500,000원/);
  assert.match(ask('보험료 합계'), /200,000원/);
  assert.match(ask('지난달 대비 지출 증감'), /300,000원 증가/);
  assert.match(ask('올해 누적 수입'), /9,000,000원/);
  assert.match(ask('올해 누적 지출'), /2,900,000원/);
  assert.match(ask('최근 3개월 지출 추이'), /10월 1,100,000원/);
  assert.match(ask('지출이 가장 많았던 달'), /11월이며 1,400,000원/);
  assert.match(ask('월별 지출 비교'), /11월 1,400,000원/);
});

test('카드 상세 내역과 할부 월 납입금을 선택 기간 기준으로 조회한다', () => {
  assert.match(ask('이번 달 주유비 얼마야'), /카드 상세 내역 기준 주유 관련 지출은 50,000원/);
  assert.match(ask('이번 달 카드 상세 지출'), /116,667원/);
  assert.match(ask('2026년 12월 교통비'), /66,667원/);
  assert.match(ask('이번 달 카드 상세 쇼핑 지출'), /기록이 없습니다/);
});

test('부업 발생일, 플랫폼, 운영비와 기존 회수율 계산을 따른다', () => {
  assert.match(ask('이번 달 부업 총수입'), /160,000원/);
  assert.match(ask('쿠팡 수익'), /100,000원/);
  assert.match(ask('배민커넥트 수익'), /60,000원/);
  assert.match(ask('플랫폼별 수익 비교'), /쿠팡이츠 100,000원 · 배민커넥트 60,000원/);
  assert.match(ask('이번 달 부업 건수'), /5건/);
  assert.match(ask('이번 달 정산 완료 금액'), /완료 여부는 구분할 수 없습니다/);
  assert.match(ask('이번 달 운영비'), /20,000원/);
  assert.match(ask('이번 달 부업 순수익'), /140,000원/);
  assert.match(ask('누적 부업 수익'), /360,000원/);
  assert.match(ask('누적 운영비'), /70,000원/);
  assert.match(ask('초기 투자금'), /500,000원/);
  assert.match(ask('투자금 회수율'), /58\.0%/);
  assert.match(ask('남은 투자금'), /210,000원/);
  assert.match(ask('누적 순현금손익'), /290,000원/);
  assert.match(ask('가장 수익이 높았던 달'), /10월이며 200,000원/);
  assert.match(ask('최근 3개월 부업 실적'), /11월 수익 160,000원 · 5건/);
  assert.match(ask('투자금 회수 예상 시점'), /최근 3개월 모두/);
});

test('미등록, 실제 0원, 권한, 오프라인, 쓰기 요청과 미지원 질문을 구별한다', () => {
  assert.match(ask('11월 부업 수익', { ...context, earnings: [], expenses: [] }), /수익 기록이 없습니다/);
  assert.match(ask('부업 수익', { ...context, earnings: [{ workDate: '2026-11-02', platform: '쿠팡이츠', grossIncome: 0, deliveryCount: 0 }], expenses: [] }), /0원/);
  assert.match(ask('지출', { ...context, transactions: [], rules: [] }), /기록이 없습니다/);
  assert.match(ask('부업 수익', { ...context, deliveryEnabled: false }), /접근 권한이 없습니다/);
  assert.match(ask('지출', { ...context, status: 'signedOut' }), /로그인/);
  assert.match(ask('지출', { ...context, status: 'denied' }), /승인되지 않은/);
  assert.match(ask('지출', { ...context, status: 'error' }), /불러오지 못했습니다/);
  assert.match(ask('지출', { ...context, offline: true }), /오프라인 캐시/);
  assert.match(ask('부업 수익 5만 원 등록해 줘'), /조회만 할 수 있습니다/);
  assert.match(ask('주말 날씨 알려줘'), /아직 해당 질문은 지원하지 않습니다/);
  assert.match(ask('8월부터 2월까지 지출'), /월 범위를 확인/);
});
