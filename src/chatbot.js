import { won, monthKey, monthOf, householdTotals, recurringOccurrences, deliveryTotals, recovery } from './model.js';

const noSupport = '아직 해당 질문은 지원하지 않습니다. 아래 추천 질문 중 하나를 선택해 주세요.';
const seoulDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dateAt = iso => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoAt = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shiftMonth = (key, offset) => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + offset, 1); return monthKey(d.getFullYear(), d.getMonth() + 1); };
const endMonth = key => `${key}-${String(new Date(Number(key.slice(0, 4)), Number(key.slice(5)), 0).getDate()).padStart(2, '0')}`;
const range = (start, end, label) => ({ start, end, label });
const monthRange = key => range(`${key}-01`, endMonth(key), `${Number(key.slice(0, 4))}년 ${Number(key.slice(5))}월`);
const monthKeys = period => { const keys = []; for (let key = period.start.slice(0, 7); key <= period.end.slice(0, 7) && keys.length < 120; key = shiftMonth(key, 1)) keys.push(key); return keys; };
const inPeriod = (date, period) => date >= period.start && date <= period.end;
const normalized = question => question.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').replace(/쿠팡(?:이츠)?|쿠팡잇츠/g, '쿠팡이츠').replace(/배민(?:커넥트)?|배달의민족/g, '배민커넥트').replace(/이번달/g, '이번 달').replace(/지난달/g, '지난달').replace(/얼마나|얼마야|알려줘|보여줘|궁금해|현황|금액|총액|합계/g, ' ').trim();

export function resolvePeriod(question, selectedYear, selectedMonth, now = seoulDate()) {
  const q = normalized(question), today = dateAt(now), current = now.slice(0, 7), selected = monthKey(selectedYear, selectedMonth);
  const rangeMatch = q.match(/(\d{1,2})월\s*부터\s*(\d{1,2})월\s*까지/);
  if (rangeMatch) {
    const from = Number(rangeMatch[1]), to = Number(rangeMatch[2]);
    if (from < 1 || to > 12 || from > to) return { error: '월 범위를 확인해 주세요. 같은 연도에서 시작월이 종료월보다 앞서야 합니다.' };
    return range(`${monthKey(selectedYear, from)}-01`, endMonth(monthKey(selectedYear, to)), `${selectedYear}년 ${from}~${to}월`);
  }
  const exact = q.match(/(20\d{2})년\s*(1[0-2]|0?[1-9])월/);
  if (exact) return monthRange(monthKey(Number(exact[1]), Number(exact[2])));
  const recent = q.match(/최근\s*([36])개월/);
  if (recent) return range(`${shiftMonth(current, 1 - Number(recent[1]))}-01`, endMonth(current), `최근 ${recent[1]}개월`);
  if (/지난주|저번 주/.test(q)) { const monday = dateAt(now); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 7); const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6); return range(isoAt(monday), isoAt(sunday), '지난주'); }
  if (/이번 주|이번주/.test(q)) { const monday = dateAt(now); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); return range(isoAt(monday), now, '이번 주'); }
  if (/어제/.test(q)) { today.setDate(today.getDate() - 1); const date = isoAt(today); return range(date, date, '어제'); }
  if (/오늘/.test(q)) return range(now, now, '오늘');
  if (/지난달|저번 달|전월/.test(q)) return monthRange(/대비/.test(q) ? current : shiftMonth(current, -1));
  if (/이번 달|이번달|금월/.test(q)) return monthRange(current);
  if (/작년|지난해/.test(q)) { const year = Number(now.slice(0, 4)) - 1; return range(`${year}-01-01`, `${year}-12-31`, `${year}년`); }
  if (/올해|금년/.test(q)) { const year = Number(now.slice(0, 4)); return range(`${year}-01-01`, `${year}-12-31`, `${year}년`); }
  const year = q.match(/(20\d{2})년/);
  if (year) return range(`${year[1]}-01-01`, `${year[1]}-12-31`, `${year[1]}년`);
  const month = q.match(/(1[0-2]|0?[1-9])월/);
  if (month) return monthRange(monthKey(selectedYear, Number(month[1])));
  return monthRange(selected);
}

const ledgerRecords = (context, period) => monthKeys(period).flatMap(key => [
  ...context.transactions.filter(record => monthOf(record.date) === key),
  ...recurringOccurrences(context.rules, context.transactions, key)
]).filter(record => inPeriod(record.date, period));
const ledgerSums = (records, period) => monthKeys(period).reduce((total, key) => {
  const summary = householdTotals(records, key);
  total.income += summary.income; total.expense += summary.expense;
  total.y += summary.y.expense; total.s += summary.s.expense;
  return total;
}, { income: 0, expense: 0, y: 0, s: 0 });
const expenseRecords = records => records.filter(record => record.type === 'expense' || record.type === 'loanInterest');
const labelAmount = (label, amount) => `${label}: ${won(amount)}`;
const deliveryRows = (context, period) => ({
  earnings: context.earnings.filter(record => inPeriod(record.workDate, period)),
  expenses: context.expenses.filter(record => inPeriod(record.workDate, period))
});
const cardInstallmentElapsed = (record, key) => {
  const [startYear, startMonth] = record.date.slice(0, 7).split('-').map(Number), [year, month] = key.split('-').map(Number);
  return (year - startYear) * 12 + month - startMonth;
};
const cardInstallmentActive = (record, key) => record.paymentType === 'installment' && record.installmentMonths > 0 && cardInstallmentElapsed(record, key) >= 0 && cardInstallmentElapsed(record, key) < record.installmentMonths;
const cardMonthlyAmount = (record, key) => {
  if (!cardInstallmentActive(record, key)) return record.amount;
  const elapsed = cardInstallmentElapsed(record, key), regular = Math.round(record.amount / record.installmentMonths);
  return elapsed === record.installmentMonths - 1 ? record.amount - regular * (record.installmentMonths - 1) : regular;
};
const cardDetailRows = (context, period) => monthKeys(period).flatMap(key => (context.cardDetails || []).filter(record => monthOf(record.date) === key || cardInstallmentActive(record, key)).map(record => ({ ...record, amount: cardMonthlyAmount(record, key), month: key })));
const cardDetailTerms = ['주유', '기름', '교통', '차량', '식비', '장보기', '주거', '관리비', '통신', '구독', '쇼핑', '의료', '건강', '미용', '문화', '여가', '여행', '숙박', '경조사', '선물', '보험', '금융', '교육', '자기계발', '반려동물'];
const cardOwner = person => person === 's' ? '선영' : person === 'common' ? '공용' : '용현';
const monthSeries = (period, get) => monthKeys(period).map(key => ({ key, ...get(monthRange(key)) }));
const seriesText = (series, field) => series.map(row => `${Number(row.key.slice(5))}월 ${won(row[field])}`).join(' · ');
const bestMonth = (series, field) => series.reduce((best, row) => row[field] > (best?.[field] ?? -Infinity) ? row : best, null);
const comparablePeriod = (period, offset) => {
  const key = shiftMonth(period.start.slice(0, 7), offset);
  return monthRange(key);
};
const hasAnyDelivery = context => context.earnings.length || context.expenses.length || context.investments.length;
const answer = text => ({ text });

export function answerQuestion(question, context, now = seoulDate()) {
  if (context.status !== 'ready') return answer(context.status === 'denied' ? '승인되지 않은 계정에서는 가계부 데이터를 조회할 수 없습니다.' : context.status === 'signedOut' ? 'Google 로그인 후 사용할 수 있습니다.' : '데이터를 불러오지 못했습니다. 연결 상태를 확인해 주세요.');
  const raw = String(question || '').trim().slice(0, 500);
  if (!raw) return answer('질문을 입력해 주세요.');
  const q = normalized(raw);
  if (/등록|추가|수정|삭제|지워|저장|입력해|바꿔/.test(q) && /해\s*줘|해줘|해\s*주세요|할래|시켜|해라|부탁/.test(q)) return answer('챗봇은 조회만 할 수 있습니다. 가계부 기록은 부부 가계부의 + 지출 등록, 부업 수익은 부업의 + 기록에서 등록해 주세요.');
  const period = resolvePeriod(raw, context.year, context.month, now);
  if (period.error) return answer(period.error);
  const delivery = /배달|부업|쿠팡이츠|배민커넥트|플랫폼|운영비|투자금|오토바이|회수|정산|수익|순현금|주행|초기 비용/.test(q);
  if (delivery && !context.deliveryEnabled) return answer('공동 부업 장부 접근 권한이 없습니다.');
  const cardResult = delivery ? null : cardDetailAnswer(q, context, period);
  const result = delivery ? deliveryAnswer(q, context, period, now) : cardResult || householdAnswer(q, context, period);
  return context.offline ? answer(`${result.text}\n오프라인 캐시 기준이며 최신 기록이 아닐 수 있습니다.`) : result;
}

function cardDetailAnswer(q, context, period) {
  const cards = context.cardDetails || [];
  if (!cards.length) return null;
  const terms = cardDetailTerms.filter(term => q.includes(term));
  const cardNames = cards.map(record => record.cardName).filter(Boolean);
  const compact = value => String(value || '').replace(/\s+/g, '');
  const questionKey = compact(q);
  const commonCardRequested = /생활비카드|공용카드|생활비공용|공용생활비/.test(questionKey);
  const requestedCard = commonCardRequested
    ? { key: 'living-common', label: '생활비 카드 · 공용' }
    : cardNames.map(name => ({ name, key: compact(name.replace('카드', '')) })).find(card => card.key && questionKey.includes(card.key));
  const explicit = /할부|일시불|카드\s*상세|상세.*지출/.test(q) || Boolean(requestedCard);
  const intent = explicit || terms.length > 0;
  if (!intent) return null;
  const allRows = cardDetailRows(context, period);
  const cardRows = requestedCard
    ? allRows.filter(record => requestedCard.key === 'living-common' ? record.cardKey === 'living-common' || record.person === 'common' : compact(record.cardName).includes(requestedCard.key))
    : allRows;
  const rows = terms.length ? cardRows.filter(record => terms.some(term => [record.title, record.category, record.memo, record.cardName].join(' ').includes(term))) : cardRows;
  const detail = [requestedCard?.label, terms.length ? terms.join('·') : '카드 상세 지출'].filter(Boolean).join(' ');
  if (!rows.length) return explicit ? answer(`${period.label} 카드 상세 내역에 ${detail} 기록이 없습니다.`) : null;
  const total = rows.reduce((sum, record) => sum + record.amount, 0);
  const byCard = Object.values(rows.reduce((all, record) => {
    const label = `${record.cardName || '카드'} · ${cardOwner(record.person)}`;
    all[label] = all[label] || { label, amount: 0, count: 0 };
    all[label].amount += record.amount; all[label].count += 1;
    return all;
  }, {}));
  const label = terms.length === 1 ? `${terms[0]} 관련 지출` : detail;
  return answer(`${period.label} 카드 상세 내역 기준 ${label}은 ${won(total)}입니다.\n${byCard.map(item => `${item.label} ${won(item.amount)} · ${item.count}건`).join('\n')}`);
}

function householdAnswer(q, context, period) {
  const records = ledgerRecords(context, period), sums = ledgerSums(records, period), expenses = expenseRecords(records);
  const prefix = `${period.label} 가계부`;
  const noRecords = records.length === 0;
  const monthly = key => ledgerSums(ledgerRecords(context, monthRange(key)), monthRange(key));
  if (/가장.*(지출|썼|소비).*달|지출.*가장.*달/.test(q)) {
    const year = Number(period.start.slice(0, 4)), series = monthSeries(range(`${year}-01-01`, `${year}-12-31`, `${year}년`), p => ({ ...monthly(p.start.slice(0, 7)), count: ledgerRecords(context, p).length }));
    const best = bestMonth(series, 'expense');
    return answer(series.every(row => !row.count) ? `${year}년에는 가계부 기록이 없습니다.` : `${year}년 지출이 가장 많았던 달은 ${Number(best.key.slice(5))}월이며 ${won(best.expense)}입니다.`);
  }
  if (/추이|월별.*비교|월별.*지출|지출.*월별/.test(q)) {
    const scope = period.start.slice(0, 7) === period.end.slice(0, 7) ? range(`${context.year}-01-01`, `${context.year}-12-31`, `${context.year}년`) : period;
    const series = monthSeries(scope, p => ({ ...monthly(p.start.slice(0, 7)), count: ledgerRecords(context, p).length }));
    return answer(series.every(row => !row.count) ? `${scope.label} 가계부 기록이 없습니다.` : `${scope.label} 월별 지출입니다.\n${seriesText(series, 'expense')}\n기록이 없는 월은 0원으로 표시했습니다.`);
  }
  if (/지난달.*대비|전월.*대비|대비.*지난달/.test(q)) {
    const target = period.start.slice(0, 7) === period.end.slice(0, 7) ? period : monthRange(monthKey(context.year, context.month));
    const previous = comparablePeriod(target, -1), currentRows = ledgerRecords(context, target), previousRows = ledgerRecords(context, previous);
    if (!currentRows.length || !previousRows.length) return answer(`${target.label}과 ${previous.label}의 지출을 비교하려면 두 달 모두 가계부 기록이 필요합니다.`);
    const current = ledgerSums(currentRows, target).expense, before = ledgerSums(previousRows, previous).expense, delta = current - before;
    return answer(`${target.label} 지출 ${won(current)}은 ${previous.label} ${won(before)}보다 ${won(Math.abs(delta))} ${delta > 0 ? '증가' : delta < 0 ? '감소' : '변동 없음'}했습니다.`);
  }
  if (/카드값|카드.*(지출|사용|결제|대금)/.test(q)) {
    const rows = expenses.filter(record => /카드/.test([record.title, record.category, record.paymentMethod].join(' ')));
    return answer(rows.length ? `${prefix} 카드 관련 지출은 ${won(rows.reduce((sum, row) => sum + row.amount, 0))}입니다. 등록된 카드 사용 거래 ${rows.length}건 기준입니다.` : `${period.label}에 카드 관련 지출 기록이 없습니다.`);
  }
  if (/보험/.test(q)) {
    const rows = expenses.filter(record => /보험/.test([record.title, record.category].join(' ')));
    return answer(rows.length ? `${prefix} 보험료 지출은 ${won(rows.reduce((sum, row) => sum + row.amount, 0))}입니다. ${rows.length}건 기준입니다.` : `${period.label}에 보험료 지출 기록이 없습니다.`);
  }
  if (/미납|미완료|아직.*납부|납부.*예정/.test(q)) {
    const rows = expenses.filter(record => !record.paid);
    return answer(rows.length ? `${prefix} 미납 예정 금액은 ${won(rows.reduce((sum, row) => sum + row.amount, 0))}입니다. ${rows.length}건이며 반복 예정 거래를 포함합니다.` : noRecords ? `${period.label} 가계부 기록이 없습니다.` : `${period.label} 미납 예정 지출이 없습니다.`);
  }
  if (/실제.*(잔여|남은|잔액)|납부.*(남은|잔여)/.test(q)) {
    if (noRecords) return answer(`${period.label} 가계부 기록이 없습니다.`);
    const received = records.filter(record => record.type === 'income' && record.paid).reduce((sum, record) => sum + record.amount, 0);
    const paid = expenses.filter(record => record.paid).reduce((sum, record) => sum + record.amount, 0);
    return answer(`${prefix} 실제 잔여 금액은 ${won(received - paid)}입니다.\n입금 완료 수입 ${won(received)} − 납부 완료 지출 ${won(paid)} 기준입니다.`);
  }
  if (/용현|선영/.test(q) && /지출|썼|소비|나간/.test(q)) {
    if (noRecords) return answer(`${period.label} 가계부 기록이 없습니다.`);
    return answer(`${prefix} ${/선영/.test(q) ? '선영' : '용현'} 지출은 ${won(/선영/.test(q) ? sums.s : sums.y)}입니다. 예정 지출을 포함합니다.`);
  }
  if (/잔여|잔액|남은 돈|남았|남는 돈/.test(q)) return answer(noRecords ? `${period.label} 가계부 기록이 없습니다.` : `${prefix} 예상 잔여 금액은 ${won(sums.income - sums.expense)}입니다.\n${labelAmount('전체 수입', sums.income)}\n${labelAmount('예정 지출', sums.expense)}`);
  if (/수입.*지출|지출.*수입/.test(q)) return answer(noRecords ? `${period.label} 가계부 기록이 없습니다.` : `${prefix} 요약입니다.\n${labelAmount('전체 수입', sums.income)}\n${labelAmount('예정 지출', sums.expense)}\n${labelAmount('예상 잔여', sums.income - sums.expense)}`);
  if (/수입|벌었|들어온 돈|입금/.test(q)) return answer(noRecords ? `${period.label} 가계부 기록이 없습니다.` : `${prefix} 전체 수입은 ${won(sums.income)}입니다.`);
  if (/지출|썼|소비|나간 돈|쓴 돈/.test(q)) return answer(noRecords ? `${period.label} 가계부 기록이 없습니다.` : `${prefix} 예정 지출은 ${won(sums.expense)}입니다. 납부 완료와 미완료를 모두 포함합니다.`);
  return answer(noSupport);
}

function deliveryAnswer(q, context, period, now) {
  const rows = deliveryRows(context, period), sums = deliveryTotals(rows.earnings, rows.expenses, period.end.slice(0, 7), false);
  const prefix = `${period.label} 부업`;
  const empty = rows.earnings.length + rows.expenses.length === 0;
  const noRows = `${period.label} 부업 수익·운영비 기록이 없습니다.`;
  const platform = /쿠팡이츠/.test(q) ? '쿠팡이츠' : /배민커넥트/.test(q) ? '배민커넥트' : '';
  const byPlatform = name => rows.earnings.filter(record => record.platform === name).reduce((sum, record) => sum + record.grossIncome, 0);
  const totalUntil = period.end.slice(0, 7);
  const cumulative = deliveryTotals(context.earnings, context.expenses, totalUntil);
  const capital = recovery(context.earnings, context.expenses, context.investments, totalUntil);
  const noCapital = '등록된 초기·추가 투자비가 없어 회수율을 계산할 수 없습니다.';
  const series = scope => monthSeries(scope, p => {
    const each = deliveryRows(context, p);
    return { ...deliveryTotals(each.earnings, each.expenses, p.start.slice(0, 7), true), count: each.earnings.length + each.expenses.length };
  });
  if (/회수.*(예상|시점|언제)|언제.*회수/.test(q)) {
    if (!capital.capital) return answer(noCapital);
    if (capital.completed) return answer('현재 등록된 기록 기준으로 투자금을 전액 회수했습니다.');
    const current = now.slice(0, 7), last = series(range(`${shiftMonth(current, -2)}-01`, endMonth(current), '최근 3개월'));
    if (last.some(row => !row.count || row.net <= 0)) return answer('최근 3개월 모두 부업 실적과 양의 순수익이 있어야 회수 예상 시점을 계산할 수 있습니다.');
    const average = last.reduce((sum, row) => sum + row.net, 0) / 3, months = Math.ceil(capital.remaining / average);
    if (months < 1 || months > 120) return answer('현재 실적으로는 신뢰할 만한 회수 예상 시점을 표시하기 어렵습니다.');
    const expected = shiftMonth(current, months);
    return answer(`최근 3개월 월평균 순수익 ${won(Math.round(average))}이 유지된다면 ${Number(expected.slice(0, 4))}년 ${Number(expected.slice(5))}월쯤 남은 투자금 ${won(capital.remaining)}을 회수할 것으로 추정합니다.`);
  }
  if (/가장.*(수익|벌었).*달|수익.*가장.*달/.test(q)) {
    const year = Number(period.start.slice(0, 4)), monthly = series(range(`${year}-01-01`, `${year}-12-31`, `${year}년`)), best = bestMonth(monthly, 'payout');
    return answer(monthly.every(row => !row.count) ? `${year}년 부업 기록이 없습니다.` : `${year}년 부업 수익이 가장 높았던 달은 ${Number(best.key.slice(5))}월이며 ${won(best.payout)}입니다.`);
  }
  if (/추이|최근.*실적|월별.*수익/.test(q)) {
    const scope = period.start.slice(0, 7) === period.end.slice(0, 7) ? range(`${context.year}-01-01`, `${context.year}-12-31`, `${context.year}년`) : period;
    const monthly = series(scope);
    return answer(monthly.every(row => !row.count) ? `${scope.label} 부업 기록이 없습니다.` : `${scope.label} 월별 부업 실적입니다.\n${monthly.map(row => `${Number(row.key.slice(5))}월 수익 ${won(row.payout)} · ${row.deliveries}건`).join('\n')}\n기록이 없는 월은 0원으로 표시했습니다.`);
  }
  if (/투자금|회수|원금|초기 비용/.test(q)) {
    if (/초기.*(투자|비용)|투자.*(합계|총|얼마)|오토바이.*투자/.test(q) && !/회수|남았|남은/.test(q)) return answer(context.investments.length ? `${totalUntil}까지 등록된 초기·추가 투자비는 ${won(capital.capital)}입니다.` : `${totalUntil}까지 등록된 투자비가 없습니다.`);
    if (!capital.capital) return answer(noCapital);
    if (/남았|남은|잔여/.test(q)) return answer(`현재 남은 투자금은 ${won(capital.remaining)}입니다. 회수율은 ${capital.percent.toFixed(1)}%입니다.`);
    return answer(`투자금 회수율은 ${capital.percent.toFixed(1)}%입니다.\n누적 운영 순현금수익 ${won(capital.cash)} / 투자비 ${won(capital.capital)}\n남은 투자금 ${won(capital.remaining)} · 투자비 차감 손익 ${won(capital.profit)}`);
  }
  if (/누적.*(순현금|손익|순수익)/.test(q)) return answer(hasAnyDelivery(context) ? `${totalUntil}까지 누적 운영 순현금수익은 ${won(cumulative.net)}, 투자비 차감 손익은 ${won(capital.profit)}입니다.` : '등록된 부업 기록이 없습니다.');
  if (/누적.*운영비/.test(q)) return answer(context.expenses.length ? `${totalUntil}까지 누적 운영비는 ${won(cumulative.expenses)}입니다.` : '등록된 운영비 기록이 없습니다.');
  if (/누적.*(수익|수입)/.test(q)) return answer(context.earnings.length ? `${totalUntil}까지 누적 부업 수익은 ${won(cumulative.payout)}입니다.` : '등록된 부업 수익 기록이 없습니다.');
  if (/플랫폼.*비교|쿠팡이츠.*배민커넥트|배민커넥트.*쿠팡이츠/.test(q)) return answer(rows.earnings.length ? `${prefix} 플랫폼별 수익입니다.\n쿠팡이츠 ${won(byPlatform('쿠팡이츠'))} · 배민커넥트 ${won(byPlatform('배민커넥트'))}` : `${period.label} 부업 수익 기록이 없습니다.`);
  if (platform) return answer(rows.earnings.some(row => row.platform === platform) ? `${prefix} ${platform} 수익은 ${won(byPlatform(platform))}입니다. 수익 발생일 기준입니다.` : `${period.label} ${platform} 수익 기록이 없습니다.`);
  if (/정산.*완료/.test(q)) return answer(rows.earnings.length ? `${prefix} 등록된 실정산액은 ${won(sums.payout)}입니다. 현재 장부에는 별도의 정산 완료 상태가 없어 완료 여부는 구분할 수 없습니다.` : `${period.label} 부업 수익 기록이 없습니다.`);
  if (/건수|몇 건|배달.*(횟수|실적)/.test(q)) return answer(rows.earnings.length ? `${prefix} 등록된 부업 건수는 ${sums.deliveries.toLocaleString('ko-KR')}건입니다.` : `${period.label} 부업 수익 기록이 없습니다.`);
  if (/운영비|비용|기름값|주유/.test(q)) return answer(rows.expenses.length ? `${prefix} 운영비는 ${won(sums.expenses)}입니다.` : `${period.label} 운영비 기록이 없습니다.`);
  if (/순수익|순현금|순이익/.test(q)) return answer(empty ? noRows : `${prefix} 순현금수익은 ${won(sums.net)}입니다.\n수익 ${won(sums.payout)} − 운영비 ${won(sums.expenses)} 기준입니다.`);
  if (/수익|수입|벌었|배달료|정산/.test(q)) return answer(rows.earnings.length ? `${prefix} 수익 현황입니다.\n총 부업 수익 ${won(sums.payout)}\n쿠팡이츠 ${won(byPlatform('쿠팡이츠'))} · 배민커넥트 ${won(byPlatform('배민커넥트'))}\n운영비 ${won(sums.expenses)}\n순현금수익 ${won(sums.net)}` : `${period.label} 부업 수익 기록이 없습니다.`);
  return answer(noSupport);
}
