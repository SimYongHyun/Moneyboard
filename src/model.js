export const won = value => `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}원`;
export const monthOf = date => date.slice(0, 7);
export const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [y, m, d] = value.split('-').map(Number);
  const actual = new Date(y, m - 1, d);
  return actual.getFullYear() === y && actual.getMonth() + 1 === m && actual.getDate() === d;
}
export function integer(value, label = '금액') {
  const raw = String(value ?? '').trim();
  const display = raw.endsWith('원') ? raw.slice(0, -1).trim() : raw;
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(display)) throw Error(`${label}은 0 이상 1조 원 이하의 정수여야 합니다.`);
  const number = Number(display.replaceAll(',', ''));
  if (!Number.isSafeInteger(number) || number < 0 || number > 1000000000000) throw Error(`${label}은 0 이상 1조 원 이하의 정수여야 합니다.`);
  return number;
}
export function validateDelivery(record) {
  if (!(record.kind === 'investment' && record.workDate === '') && !validDate(record.workDate)) throw Error('올바른 날짜를 선택하세요.');
  if (record.kind === 'income') {
    if (!['쿠팡이츠', '배민커넥트'].includes(record.platform)) throw Error('플랫폼을 선택하세요.');
    integer(record.grossIncome, '수입');
    integer(record.deliveryCount, '부업 건수');
    if (record.deliveryCount > 1000000) throw Error('부업 건수를 확인하세요.');
    for (const key of ['workHours', 'distanceKm']) if (!Number.isFinite(record[key]) || record[key] < 0 || record[key] > 1000000) throw Error('시간과 거리를 확인하세요.');
  } else if (record.kind === 'expense' || record.kind === 'investment') {
    integer(record.amount);
    if (!record.category?.trim()) throw Error('유형을 입력하세요.');
  } else throw Error('기록 종류가 올바르지 않습니다.');
  if ((record.memo || '').length > 150) throw Error('메모는 150자 이내로 입력하세요.');
  if ((record.category || '').length > 80) throw Error('유형은 80자 이내로 입력하세요.');
  return record;
}
export function deliveryTotals(earnings, expenses, untilMonth, exactMonth = false) {
  const fits = r => exactMonth ? monthOf(r.workDate) === untilMonth : monthOf(r.workDate) <= untilMonth;
  const included = earnings.filter(fits), costs = expenses.filter(fits);
  const gross = included.reduce((a, r) => a + r.grossIncome, 0);
  const deductions = 0;
  const payout = gross;
  const operating = costs.reduce((a, r) => a + r.amount, 0);
  return { gross, deductions, payout, expenses: operating, net: payout - operating,
    deliveries: included.reduce((a, r) => a + r.deliveryCount, 0),
    hours: included.reduce((a, r) => a + r.workHours, 0),
    distance: included.reduce((a, r) => a + r.distanceKm, 0), count: included.length };
}
export function recovery(earnings, expenses, investments, untilMonth) {
  const cash = deliveryTotals(earnings, expenses, untilMonth).net;
  const capital = investments.filter(r => !r.workDate || monthOf(r.workDate) <= untilMonth).reduce((a, r) => a + r.amount, 0);
  const profit = cash - capital;
  return { cash, capital, profit, remaining: Math.max(0, capital - cash), percent: capital ? Math.min(100, Math.max(0, cash / capital * 100)) : 0, completed: capital > 0 && profit >= 0 };
}
export const expenseTypes = ['expense', 'loanInterest'];
export function householdTotals(transactions, key) {
  const records = transactions.filter(r => monthOf(r.date) === key);
  const sum = (items, type) => items.filter(r => type(r)).reduce((a, r) => a + r.amount, 0);
  const by = person => {
    const items = records.filter(r => r.person === person);
    const income = sum(items, r => r.type === 'income');
    const expense = sum(items, r => expenseTypes.includes(r.type));
    return { income, expense, balance: income - expense, items };
  };
  const y = by('y'), s = by('s');
  return { y, s, income: y.income + s.income, expense: y.expense + s.expense, balance: y.balance + s.balance, hasData: records.length > 0 };
}
export function validateTransaction(r) {
  if (!validDate(r.date)) throw Error('올바른 거래 날짜를 선택하세요.');
  if (!['y', 's'].includes(r.person)) throw Error('담당자를 선택하세요.');
  if (!['income', 'expense', 'savings', 'transfer', 'loanPrincipal', 'loanInterest'].includes(r.type)) throw Error('거래 분류를 선택하세요.');
  integer(r.amount);
  if (!r.title?.trim() || r.title.length > 100) throw Error('항목 이름을 확인하세요.');
  if ((r.memo || '').length > 150) throw Error('메모는 150자 이내로 입력하세요.');
  if (['category', 'paymentMethod', 'account'].some(key => (r[key] || '').length > 80)) throw Error('카테고리·결제 수단·계좌는 80자 이내로 입력하세요.');
  if (r.paidDate && !validDate(r.paidDate)) throw Error('실제 납부일을 확인하세요.');
  return r;
}
export function recurringOccurrences(rules, transactions, key) {
  return rules.filter(rule => rule.startMonth <= key && (!rule.endMonth || rule.endMonth >= key))
    .filter(rule => !rule.installments || (Number(key.slice(0, 4)) - Number(rule.startMonth.slice(0, 4))) * 12 + Number(key.slice(5)) - Number(rule.startMonth.slice(5)) < rule.installments)
    .filter(rule => !transactions.some(t => t.recurringRuleId === rule.id && monthOf(t.date) === key))
    .map(rule => ({ ...rule, id: `virtual:${rule.id}:${key}`, date: `${key}-${String(Math.min(rule.day, new Date(Number(key.slice(0, 4)), Number(key.slice(5)), 0).getDate())).padStart(2, '0')}`, virtual: true, paid: false }));
}
export function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
