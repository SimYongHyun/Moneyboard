import test from 'node:test';
import assert from 'node:assert/strict';
import { validDate, integer, validateDelivery, deliveryTotals, recovery, householdTotals, recurringOccurrences, expectedIncomeDate } from '../src/model.js';

const earning = (workDate, platform, grossIncome, settlementDeduction = 0) => ({ kind: 'income', workDate, platform, grossIncome, settlementDeduction, deliveryCount: 1, workHours: 1, distanceKm: 5, memo: '' });
const cost = (workDate, amount) => ({ kind: 'expense', workDate, amount, category: '주유비', memo: '' });
test('부업 날짜와 원화 금액 검증', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2026-10-31'), true);
  assert.throws(() => validateDelivery(earning('2026-02-30', '쿠팡이츠', 100)));
  assert.throws(() => validateDelivery(earning('2026-10-31', '쿠팡이츠', -1)));
  assert.throws(() => validateDelivery(earning('2026-10-31', '쿠팡이츠', 1.5)));
  assert.doesNotThrow(() => validateDelivery(earning('2026-10-31', '쿠팡이츠', 10, 11)));
});
test('플랫폼별 입금 예정일은 쿠팡 주간 정산과 배민 3영업일을 따른다', () => {
  assert.equal(expectedIncomeDate('쿠팡이츠', '2026-11-04'), '2026-11-13');
  assert.equal(expectedIncomeDate('쿠팡이츠', '2026-11-10'), '2026-11-13');
  assert.equal(expectedIncomeDate('배민커넥트', '2026-11-02'), '2026-11-05');
  assert.equal(expectedIncomeDate('배민커넥트', '2026-11-06'), '2026-11-11');
  assert.equal(expectedIncomeDate('배민커넥트', '2026-02-13'), '2026-02-23');
});

test('쉼표와 원 단위가 포함된 금액도 정수로 저장된다', () => {
  assert.equal(integer('1,000원'), 1000);
  assert.equal(integer('250,000'), 250000);
  assert.throws(() => integer('1,00원'));
});
test('월별 플랫폼 합계, 날짜 수정, 삭제가 누적 분석에 반영된다', () => {
  const first = earning('2026-11-02', '쿠팡이츠', 1000, 100);
  const second = earning('2026-11-02', '배민커넥트', 500);
  const earlier = earning('2026-10-31', '배민커넥트', 300);
  const earnings = [first, second, earlier], expenses = [cost('2026-11-02', 200)];
  assert.equal(deliveryTotals(earnings, expenses, '2026-11', true).payout, 1500);
  assert.equal(deliveryTotals(earnings, expenses, '2026-10').net, 300);
  assert.equal(recovery(earnings, expenses, [{ workDate: '2026-09-01', amount: 2000 }], '2026-10').percent, 15);
  earlier.workDate = '2026-09-30';
  assert.equal(deliveryTotals(earnings, expenses, '2026-10', true).payout, 0);
  earnings.pop();
  assert.equal(deliveryTotals(earnings, expenses, '2026-11', true).net, 1300);
});
test('가계 지출은 이체·저축·대출 원금의 중복 비용을 제외한다', () => {
  const row = (type, amount, person = 'y') => ({ date: '2026-11-02', type, amount, person });
  const totals = householdTotals([row('income', 2000), row('expense', 500), row('transfer', 500), row('savings', 200), row('loanPrincipal', 100), row('loanInterest', 50), row('income', 1000, 's')], '2026-11');
  assert.equal(totals.income, 3000); assert.equal(totals.expense, 550); assert.equal(totals.balance, 2450);
});
test('반복 거래는 지정월과 할부 회차에만 나타난다', () => {
  const rule = { id: 'r', startMonth: '2026-09', endMonth: '', day: 31, installments: 2, amount: 100 };
  assert.equal(recurringOccurrences([rule], [], '2026-09').length, 1);
  assert.equal(recurringOccurrences([rule], [], '2026-10').length, 1);
  assert.equal(recurringOccurrences([rule], [], '2026-11').length, 0);
  assert.equal(recurringOccurrences([rule], [{ recurringRuleId: 'r', date: '2026-10-31' }], '2026-10').length, 0);
});
