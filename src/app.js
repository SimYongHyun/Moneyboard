import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, onSnapshot, query, limit, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';
import { won, monthKey, monthOf, validDate, integer, validateDelivery, deliveryTotals, recovery, householdTotals, validateTransaction, recurringOccurrences, csvCell } from './model.js';

const root = document.getElementById('app');
const dialog = document.getElementById('recordDialog');
const formContainer = document.getElementById('recordFormContainer');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const initialYear = Number(today.slice(0, 4));
const state = { page: 'home', year: initialYear, month: Number(today.slice(5, 7)), calendarMonth: null, status: 'loading', user: null, access: null, household: null, transactions: [], rules: [], auditLogs: [], cardDetails: [], earnings: [], expenses: [], investments: [], settings: {}, loaded: {}, error: '', filter: 'all', cardKey: 'shinhan-y' };
const collectionNames = { transactions: 'transactions', rules: 'recurringRules', auditLogs: 'auditLogs', cardDetails: 'cardDetails', earnings: 'deliveryEarnings', expenses: 'deliveryExpenses', investments: 'deliveryInvestments' };
let auth, db, unsubs = [], busy = false, toastTimer, chatWidget, chatLoading;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const selectedMonth = () => monthKey(state.year, state.month);
const displayedCalendarMonth = () => state.calendarMonth || selectedMonth();
const shiftCalendarMonth = offset => {
  const [year, month] = displayedCalendarMonth().split('-').map(Number), date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const deliveryOwnerUid = () => state.household?.ownerUid || '';
const hasDelivery = () => Boolean(deliveryOwnerUid() && state.household?.members?.includes(state.user?.uid));
const currencyInput = value => {
  const digits = String(value ?? '').replaceAll(',', '').replaceAll('원', '').replace(/\D/g, '');
  return digits ? `${Number(digits).toLocaleString('ko-KR')}원` : '';
};
const currencyNumber = value => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? Number(digits) : 0;
};
const allTransactions = key => [...state.transactions.filter(t => monthOf(t.date) === key), ...recurringOccurrences(state.rules, state.transactions, key)];
const house = key => householdTotals(allTransactions(key), key);
const money = value => won(value);
const byDate = (a, b) => (b.workDate || b.date).localeCompare(a.workDate || a.date);
function notify(message) { const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 4000); }
function failure(error) { console.error(error); notify(error?.message || '작업 중 오류가 발생했습니다.'); }
function accessMessage() { return state.status === 'denied' ? '승인되지 않은 계정입니다. 관리자에게 UID 등록을 요청하세요.' : state.status === 'setup' ? 'Firebase 웹 설정을 입력해 주세요.' : state.error || '데이터를 불러오는 중입니다.'; }
function applyBranding() {
  root.querySelectorAll('.sidebar .logo').forEach(element => { element.textContent = '사이드 메뉴바'; });
  root.querySelectorAll('.section-heading h3').forEach(element => {
    if (element.textContent === '배달 부업 · 투자금과 기록') element.textContent = '부업 · 투자금과 기록';
  });
  if (state.status === 'ready') root.querySelectorAll('.side-footer').forEach(element => {
    if (!element.querySelector('[data-audit]')) element.insertAdjacentHTML('afterbegin', '<button class="pill-btn" data-audit>수정 이력</button>');
  });
  const recurring = [...root.querySelectorAll('details.card')].find(element => element.querySelector('summary')?.textContent.includes('반복 거래'));
  recurring?.querySelectorAll('.investment-list > .between').forEach((row, index) => {
    const rule = state.rules[index], text = row.querySelector(':scope > span:first-child');
    if (!rule || !text || text.querySelector('.rule-owner')) return;
    const tag = document.createElement('span');
    tag.className = `tag rule-owner ${rule.person === 'y' ? 'blue' : 'red'}`;
    tag.textContent = rule.person === 'y' ? '용현' : '선영';
    text.prepend(tag, ' ');
  });
  root.querySelectorAll('.ledger-columns .ledger-table tbody tr').forEach(row => {
    const edit = row.querySelector('[data-ledger-edit]'), id = edit?.dataset.ledgerEdit;
    if (id) {
      row.draggable = true; row.dataset.dragId = id; row.title = id.startsWith('virtual:') ? '반복 예정 항목끼리 끌어 놓아 순서를 변경하세요' : '끌어 놓아 순서를 변경하세요';
      if (!row.querySelector('.drag-control')) row.insertAdjacentHTML('afterbegin', `<td class="drag-control"><span class="drag-handle" draggable="true" title="끌어 놓아 순서 변경">⠿</span><button type="button" data-move-up="${escapeHtml(id)}" aria-label="위로 이동">↑</button><button type="button" data-move-down="${escapeHtml(id)}" aria-label="아래로 이동">↓</button></td>`);
    }
  });
}
function authScreen() {
  chatWidget?.destroy(); chatWidget = null;
  const loading = state.status === 'loading';
  document.querySelector('.notice-right').textContent = state.status === 'setup' ? 'Firebase 설정 필요' : state.status === 'signedOut' ? '로그인 필요' : state.status === 'denied' ? '접근 불가' : loading ? '연결 상태 확인 중' : '연결 오류';
  root.innerHTML = `<div class="mock-app vA"><div class="app-shell side-shell"><aside class="sidebar"><div class="logo">◈ 머니보드</div><div class="side-footer"><b>우리집 공동 가계부</b>승인된 두 계정만 사용</div></aside><main class="app-main"><section class="card" style="max-width:510px;margin:12vh auto;width:100%;padding:29px"><span class="tag blue">우리집 머니보드</span><h2 style="margin:16px 0 9px">${loading ? '연결 중입니다' : state.status === 'signedOut' ? 'Google 계정으로 로그인' : '접근 상태 확인'}</h2><p class="sectionsub" style="font-size:12px">${escapeHtml(loading ? '인증 및 권한을 확인하고 있습니다.' : state.status === 'signedOut' ? '승인된 가족 계정으로 로그인하면 공동 가계부가 열립니다.' : accessMessage())}</p>${state.user ? `<p class="sectionsub">계정: ${escapeHtml(state.user.email || '')}<br>UID: ${escapeHtml(state.user.uid)}</p>` : ''}<div class="inline" style="margin-top:20px">${state.status === 'signedOut' ? '<button class="pill-btn primary" data-login>Google 로그인</button>' : ''}${state.user ? '<button class="pill-btn" data-logout>로그아웃</button>' : ''}</div></section></main></div></div>`;
  applyBranding();
}
function clearSubscriptions() { for (const stop of unsubs) stop(); unsubs = []; state.loaded = {}; state.transactions = []; state.rules = []; state.auditLogs = []; state.cardDetails = []; state.earnings = []; state.expenses = []; state.investments = []; state.settings = {}; }
function subscribe(key, path) {
  state.loaded[key] = false;
  const unsubscribe = onSnapshot(query(collection(db, ...path), limit(5000)), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.docs.length >= 5000) { state.status = 'error'; state.error = `${key} 기록이 5,000건에 도달했습니다. 백업 후 데이터 범위를 나누어야 합니다.`; authScreen(); return; }
    state[key] = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    if (key === 'earnings') state[key] = state[key].map(record => ({ ...record, settlementDeduction: 0 }));
    state.loaded[key] = true;
    state.offline = snapshot.metadata.fromCache;
    if (Object.values(state.loaded).every(Boolean)) { state.status = 'ready'; render(); }
  }, error => { state.status = 'error'; state.error = `${key}: ${error.message}`; authScreen(); });
  unsubs.push(unsubscribe);
}
function subscribeSettings() {
  state.loaded.settings = false;
  const unsubscribe = onSnapshot(doc(db, 'users', state.user.uid, 'settings', 'app'), snapshot => {
    state.settings = snapshot.exists() ? snapshot.data() : {};
    state.loaded.settings = true;
    if (Object.values(state.loaded).every(Boolean)) { state.status = 'ready'; render(); }
  }, error => { state.status = 'error'; state.error = error.message; authScreen(); });
  unsubs.push(unsubscribe);
}
async function authorize(user) {
  clearSubscriptions(); state.user = user; state.access = null; state.household = null;
  if (!user) { state.status = 'signedOut'; authScreen(); return; }
  state.status = 'loading'; authScreen();
  try {
    const accessDoc = await getDoc(doc(db, 'allowedUsers', user.uid));
    if (!accessDoc.exists()) { state.status = 'denied'; authScreen(); return; }
    state.access = accessDoc.data();
    if (!state.access.householdId) throw Error('가구 ID가 설정되지 않았습니다.');
    const householdDoc = await getDoc(doc(db, 'households', state.access.householdId));
    if (!householdDoc.exists() || !householdDoc.data().members?.includes(user.uid)) throw Error('가구 구성원 권한이 없습니다.');
    state.household = householdDoc.data();
    subscribeSettings();
    subscribe('transactions', ['households', state.access.householdId, 'transactions']);
    subscribe('rules', ['households', state.access.householdId, 'recurringRules']);
    subscribe('auditLogs', ['households', state.access.householdId, 'auditLogs']);
    subscribe('cardDetails', ['households', state.access.householdId, 'cardDetails']);
    if (hasDelivery()) {
      subscribe('earnings', ['users', deliveryOwnerUid(), 'deliveryEarnings']);
      subscribe('expenses', ['users', deliveryOwnerUid(), 'deliveryExpenses']);
      subscribe('investments', ['users', deliveryOwnerUid(), 'deliveryInvestments']);
    }
  } catch (error) { state.status = 'error'; state.error = error.message; authScreen(); }
}
if (Object.values(firebaseConfig).some(value => String(value).includes('REPLACE_ME'))) { state.status = 'setup'; authScreen(); }
else {
  const app = initializeApp(firebaseConfig); auth = getAuth(app); db = getFirestore(app);
  onAuthStateChanged(auth, user => authorize(user));
}
function yearMonth() { const years = Array.from({ length: 11 }, (_, i) => initialYear - 5 + i); if (!years.includes(state.year)) years.push(state.year); years.sort((a, b) => a - b); return `<div class="yearbar"><select aria-label="연도 선택" data-year>${years.map(y => `<option value="${y}" ${y === state.year ? 'selected' : ''}>${y}년</option>`).join('')}</select><select aria-label="월 선택" data-month>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === state.month ? 'selected' : ''}>${i + 1}월</option>`).join('')}</select></div>`; }
const menu = [['home', '⌂', '홈'], ['ledger', '▤', '부부 가계부'], ['cards', '▣', '카드 상세 내역'], ['side', '◉', '부업']];
function shell(content) {
  const menus = menu.map(([page, icon, label]) => `<button type="button" data-page="${page}" class="${state.page === page ? 'active' : ''}"><span class="navic">${icon}</span><span class="navtext">${label}</span></button>`).join('');
  return `<div class="mock-app vA"><div class="app-shell side-shell"><aside class="sidebar"><div class="logo">◈ 머니보드</div><div class="side-nav">${menus}</div><div class="side-footer"><b>우리집 공동 가계부</b>${escapeHtml(state.settings.displayName || state.user?.email || '')}<br><button class="pill-btn" data-settings>설정</button> <button class="pill-btn" data-logout>로그아웃</button></div></aside><main class="app-main">${content}<div class="note">${state.offline ? '오프라인 캐시를 표시하고 있습니다. 연결 상태를 확인하세요.' : 'Firebase 실시간 동기화 중'}</div><div class="inline mobile-logout"><button class="pill-btn" data-settings>설정</button><button class="pill-btn" data-logout>로그아웃</button></div></main><nav class="bottom-nav" aria-label="화면 메뉴">${menus}</nav></div></div>`;
}
function heading(title, description) { return `<div class="app-title"><div><h2>${title}</h2><p>${description}</p></div>${yearMonth()}</div>`; }
function family() {
  const t = house(selectedMonth()), shown = t.hasData;
  const value = n => shown ? money(n) : '—';
  return `<section class="card family-card feature"><div class="family-top"><div><span class="tag blue">우리집 가계부 현황</span><div class="sectionsub">${state.year}년 ${state.month}월 · 부부 합산</div></div><button class="pill-btn soft" type="button" data-page="ledger">상세 장부 ↗</button></div><div class="family-headline"><div class="micro">이번 달 예상 잔여 금액</div><strong class="primary-amount mono">${value(t.balance)}</strong></div><div class="family-kpis"><div><div class="micro">이번 달 수령</div><strong class="mono">${value(t.income)}</strong></div><div><div class="micro">지출 예정</div><strong class="mono">${value(t.expense)}</strong></div><div><div class="micro">예상 잔여액</div><strong class="mono plus">${value(t.balance)}</strong></div></div></section>`;
}
function peopleCards() {
  const t = house(selectedMonth()); return `<div class="household-quick">${[['y', '용현', '용'], ['s', '선영', '선']].map(([key, name, icon]) => `<div class="people-card"><div class="inline"><span class="avatar ${key === 's' ? 'pink' : ''}">${icon}</span><div><b>${name}</b><div class="micro">월급 ${t[key].items.length ? money(t[key].income) : '—'}</div></div></div><div style="text-align:right"><div class="micro">예상 잔여</div><b class="mono">${t[key].items.length ? money(t[key].balance) : '—'}</b></div></div>`).join('')}</div>`;
}
function annualGraph() {
  const values = Array.from({ length: 12 }, (_, i) => { const t = householdTotals(state.transactions, monthKey(state.year, i + 1)); return t.hasData ? t.expense : null; });
  const max = Math.max(1, ...values.filter(v => v !== null));
  return `<section class="card home-chart"><div class="chart-head"><div><h3>1월~12월 월별 지출 그래프</h3><div class="sectionsub">선택 연도의 가계 지출을 월별로 비교합니다.</div></div><span class="tag">미입력 월은 공란</span></div><div class="chart-shell"><div class="plot compact">${values.map((n, i) => `<div class="plot-item ${i + 1 === state.month ? 'hot' : ''} ${n === null ? 'na' : ''}" title="${i + 1}월 ${n === null ? '자료 없음' : money(n)}"><div class="plot-bar" style="height:${n === null ? 0 : n / max * 100}%">${n !== null ? `<span class="point">${Math.round(n / 10000)}만</span>` : ''}</div></div>`).join('')}</div><div class="plot-labels">${values.map((_, i) => `<span class="${i + 1 === state.month ? 'hot' : ''}">${i + 1}월</span>`).join('')}</div></div></section>`;
}
function miniBusiness() {
  if (!hasDelivery()) return `<div class="business-mini"><section class="card"><h3>🛵 부업 초기 투자금</h3><div class="no-data">공동 배달 장부 접근 권한이 없습니다.</div></section></div>`;
  const r = recovery(state.earnings, state.expenses, state.investments, selectedMonth());
  const monthly = deliveryTotals(state.earnings, state.expenses, selectedMonth(), true);
  const m = { gross: state.earnings.reduce((sum, record) => sum + record.grossIncome, 0), net: monthly.net };
  const vehicle = state.investments.filter(i => i.category === '차량' && (!i.workDate || monthOf(i.workDate) <= selectedMonth())).reduce((a, i) => a + i.amount, 0);
  const gear = r.capital - vehicle;
  return `<div class="business-mini"><section class="card"><div class="section-heading"><h3>🛵 부업 초기 투자금</h3><span class="tag blue">구매 ${state.investments.length}건</span></div><div class="investment-sum mono">${money(r.capital)}</div><div class="sectionsub">오토바이 ${money(vehicle)} · 비품 ${money(gear)}</div><div style="margin-top:14px" class="color-stroke"><span style="width:${r.capital ? vehicle / r.capital * 100 : 0}%"></span></div></section><section class="card"><div class="section-heading"><h3>투자금 회수 로드맵</h3><span class="tag ${r.completed ? 'green' : 'orange'}">${r.completed ? '회수 완료' : '회수 진행 중'}</span></div><div class="between"><span class="micro">누적 회수율 · ${selectedMonth()}까지</span><b>${r.percent.toFixed(1)}%</b></div><div style="margin:14px 0" class="progress-track"><span style="width:${r.percent}%"></span></div><div class="between"><span class="micro">누적 총수입 <small>(공제 전)</small></span><b class="mono">${money(m.gross)}</b></div><div class="between"><span class="micro">남은 투자금</span><b class="mono">${money(r.remaining)}</b></div><div class="sectionsub" style="margin-top:10px">이번 달 순현금수익 ${money(m.net)}</div></section><section class="card"><div class="section-heading"><h3>부업 빠른 기록</h3><span class="tag blue">${state.year}년 ${state.month}월</span></div><div class="record-actions"><button data-add="income" data-platform="배민커넥트">배민커넥트 <b>+ 기록</b></button><button data-add="income" data-platform="쿠팡이츠">쿠팡이츠 <b>+ 기록</b></button><button data-add="expense">주유·정비비 <b>+ 기록</b></button></div></section></div>`;
}
function home() { return shell(`${heading('이번 달 우리집 머니보드', '우리집 가계 현황을 먼저 확인하고, 연도별 지출과 배달 투자금 현황을 살펴보세요.')}${family()}${peopleCards()}${annualGraph()}<div class="section-heading" style="margin-bottom:0"><h3>배달 부업 · 투자금과 기록</h3><button class="pill-btn" data-page="side">부업 상세 보기 ↗</button></div>${miniBusiness()}`); }
const typeLabels = { income: '수입', expense: '지출', savings: '저축', transfer: '내부 이체', loanPrincipal: '대출 원금', loanInterest: '대출 이자' };
const typeTagClass = type => type === 'income' ? 'blue' : type === 'expense' || type === 'loanInterest' ? 'red' : 'orange';
const ledgerOrder = (a, b) => {
  const aOrder = Number.isInteger(a.sortOrder) ? a.sortOrder : null, bOrder = Number.isInteger(b.sortOrder) ? b.sortOrder : null;
  if (aOrder !== null || bOrder !== null) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
  return b.date.localeCompare(a.date);
};
function personPanel(person, key) {
  const name = key === 'y' ? '용현' : '선영';
  const entries = person.items.filter(r => state.filter === 'all' || r.type === state.filter).sort(ledgerOrder);
  return `<section class="ledger-panel ${key === 's' ? 'pink' : ''}"><div class="ledger-panel-head"><div><strong>${name} 거래 장부</strong><div class="ledger-panel-sub">예상 잔여 ${person.items.length ? money(person.balance) : '—'} · ${entries.length}건</div></div><span class="tag ${key === 's' ? 'red' : 'blue'}">${person.items.length ? money(person.expense) : '—'}</span></div>${entries.length ? `<div class="overflow-x"><table class="ledger-table"><thead><tr><th>거래 항목</th><th>구분</th><th>결제일</th><th class="memo">결제처</th><th>처리</th><th style="text-align:right">금액</th><th>관리</th></tr></thead><tbody>${entries.map(r => `<tr><td>${escapeHtml(r.title)}${r.virtual ? ' <small>반복 예정</small>' : ''}</td><td><span class="tag ${typeTagClass(r.type)}">${escapeHtml(typeLabels[r.type])}</span></td><td>${escapeHtml(r.date.slice(5))}</td><td class="memo">${escapeHtml(r.paymentMethod || r.account)}</td><td class="pay-status"><button class="paytoggle ${r.paid ? 'paid' : ''}" data-pay="${escapeHtml(r.id)}">${r.paid ? '완료' : '미완료'}</button></td><td class="amount mono">${money(r.amount)}</td><td><button class="small-action" data-ledger-edit="${escapeHtml(r.id)}">수정</button> <button class="small-action danger" data-ledger-delete="${escapeHtml(r.id)}">삭제</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="no-data">이 달에는 가계부 자료가 없습니다.</div>'}<div class="ledger-foot"><span>${name} 지출 합계</span><span>${person.items.length ? money(person.expense) : '—'}</span></div></section>`;
}
function categoryExpenseGraph() {
  const expenses = allTransactions(selectedMonth()).filter(record => record.type === 'expense');
  const ranks = Object.entries(expenses.reduce((total, record) => {
    const category = record.category?.trim() || '미분류';
    total[category] = (total[category] || 0) + record.amount;
    return total;
  }, {})).sort((a, b) => b[1] - a[1]);
  const total = ranks.reduce((sum, [, amount]) => sum + amount, 0);
  const max = Math.max(1, ...ranks.map(([, amount]) => amount));
  return `<section class="card category-rank"><div class="section-heading"><div><h3>카테고리별 지출 순위</h3><div class="sectionsub">${state.year}년 ${state.month}월 · 지출로 등록한 거래 기준</div></div><span class="tag red">합계 ${money(total)}</span></div>${ranks.length ? `<div class="category-rank-list">${ranks.map(([category, amount], index) => `<div class="category-rank-row"><span class="category-rank-number">${index + 1}</span><div class="category-rank-detail"><div class="between"><b>${escapeHtml(category)}</b><strong class="mono">${money(amount)}</strong></div><div class="category-rank-track"><span style="width:${amount / max * 100}%"></span></div></div><span class="micro">${total ? (amount / total * 100).toFixed(1) : 0}%</span></div>`).join('')}</div>` : '<div class="no-data">이번 달 지출을 등록하면 카테고리별 순위가 표시됩니다.</div>'}</section>`;
}
function ledger() {
  const t = house(selectedMonth()), shown = t.hasData, value = n => shown ? money(n) : '—';
  return shell(`${heading('우리집 월별 가계부', '부부 합산 현황과 용현·선영 병렬 장부를 함께 확인합니다.')}<section class="ledger-overview surface"><div class="ledger-lead"><div><span class="tag blue">우리집 이번 달 현황</span><div class="sectionsub">이번 달 예상 잔여 금액</div><div class="counter mono">${value(t.balance)}</div></div><button class="pill-btn ledger-add-btn" data-ledger-add>+ 지출 등록</button></div><div class="ledger-mini"><span>수령액 <b>${value(t.income)}</b></span><span>지출 예정 <b>${value(t.expense)}</b></span><span>용현 잔여 <b>${t.y.items.length ? money(t.y.balance) : '—'}</b></span><span>선영 잔여 <b>${t.s.items.length ? money(t.s.balance) : '—'}</b></span></div></section><div class="between wrap"><div class="filter-row"><span class="tag blue">월별 장부</span><span class="tag">용현/선영 병렬 보기</span><select data-filter aria-label="거래 분류 필터"><option value="all">전체</option>${['income', 'expense'].map(v => `<option value="${v}" ${v === state.filter ? 'selected' : ''}>${typeLabels[v]}</option>`).join('')}</select></div><div class="inline"><button class="pill-btn" data-rule-add>반복 등록</button><button class="pill-btn" data-copy-previous>이전월 복사</button><button class="pill-btn" data-backup="json">JSON 백업</button><button class="pill-btn" data-backup="csv">연간 CSV</button><button class="pill-btn" data-import>가져오기</button></div></div><div class="ledger-columns">${personPanel(t.y, 'y')}${personPanel(t.s, 's')}</div><div class="ledger-footer"><div><div class="micro">용현 지출 합계</div><b>${t.y.items.length ? money(t.y.expense) : '—'}</b></div><div><div class="micro">선영 지출 합계</div><b>${t.s.items.length ? money(t.s.expense) : '—'}</b></div><div><div class="micro">부부 총 잔여 예상액</div><b class="plus">${value(t.balance)}</b></div></div>${categoryExpenseGraph()}<details class="card"><summary>반복 거래 ${state.rules.length}건 관리</summary><div class="investment-list">${state.rules.map(r => `<div class="between"><span>${escapeHtml(r.title)} · ${money(r.amount)} · 매월 ${r.day}일${r.installments ? ` · ${r.installments}회 할부` : ''}</span><span><button class="small-action" data-rule-edit="${escapeHtml(r.id)}">수정</button> <button class="small-action danger" data-rule-delete="${escapeHtml(r.id)}">삭제</button></span></div>`).join('')}</div></details><div class="note">카드 사용액은 지출로, 카드대금 납부는 내부 이체로 등록하세요. 저축·대출 원금·내부 이체는 지출 합계에서 제외합니다.</div>`);
}
const cardCatalog = [
  { key: 'shinhan-y', name: '신한카드', person: 'y' },
  { key: 'hyundai-y', name: '현대카드', person: 'y' },
  { key: 'samsung-s', name: '삼성카드', person: 's' }
];
const personName = key => key === 's' ? '선영' : '용현';
const activeCard = () => cardCatalog.find(card => card.key === state.cardKey) || cardCatalog[0];
const cardTotal = card => state.transactions.filter(record => monthOf(record.date) === selectedMonth() && record.person === card.person && record.type === 'expense' && `${record.title} ${record.paymentMethod} ${record.account}`.replaceAll(' ', '').includes(card.name.replaceAll(' ', '').replace('카드', ''))).reduce((sum, record) => sum + record.amount, 0);
const cardRows = card => state.cardDetails.filter(record => record.cardKey === card.key && monthOf(record.date) === selectedMonth()).sort((a, b) => b.date.localeCompare(a.date));
function cardDetails() {
  const active = activeCard(), rows = cardRows(active), total = cardTotal(active), detailed = rows.reduce((sum, row) => sum + row.amount, 0), uncategorized = total - detailed;
  const categories = Object.entries(rows.reduce((all, row) => { const category = row.category || '미분류'; all[category] = (all[category] || 0) + row.amount; return all; }, {})).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...categories.map(([, amount]) => amount));
  return shell(`${heading('카드 상세 내역', '카드 총액은 부부 가계부에서 관리하고, 이 화면에서는 카드 사용처를 세부적으로 확인합니다.')}<div class="card-picker">${cardCatalog.map(card => { const items = cardRows(card), amount = cardTotal(card), used = items.reduce((sum, row) => sum + row.amount, 0); return `<button class="card-picker-item ${card.key === active.key ? 'active' : ''}" data-card-pick="${card.key}"><span>${card.name} · ${personName(card.person)}</span><strong class="mono">${money(amount)}</strong><small>상세 ${items.length}건 · 미분류 ${money(Math.max(0, amount - used))}</small></button>`; }).join('')}</div><section class="card card-detail-panel"><div class="section-heading"><div><h3>${active.name} · ${personName(active.person)}</h3><div class="sectionsub">${state.year}년 ${state.month}월 카드 사용 상세</div></div><button class="pill-btn ledger-add-btn" data-card-detail-add>+ 상세 지출 등록</button></div><div class="card-detail-summary"><div><span>카드 총액</span><b class="mono">${money(total)}</b></div><div><span>세부 내역 합계</span><b class="mono">${money(detailed)}</b></div><div><span>미분류 금액</span><b class="mono ${uncategorized < 0 ? 'minus' : ''}">${money(uncategorized)}</b></div></div>${total === 0 ? '<div class="hintbox">이 카드의 월 총액을 먼저 부부 가계부에 지출로 등록해 주세요. 상세 내역은 총액에 중복 합산되지 않습니다.</div>' : ''}<div class="card-detail-grid"><section><div class="section-heading"><h3>세부 지출 내역</h3><span class="tag blue">${rows.length}건</span></div>${rows.length ? `<div class="overflow-x"><table class="ledger-table"><thead><tr><th>사용일</th><th>항목</th><th>카테고리</th><th style="text-align:right">금액</th><th>관리</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.date.slice(5))}</td><td>${escapeHtml(row.title)}${row.memo ? `<div class="micro">${escapeHtml(row.memo)}</div>` : ''}</td><td><span class="tag blue">${escapeHtml(row.category)}</span></td><td class="amount mono">${money(row.amount)}</td><td><button class="small-action" data-card-detail-edit="${escapeHtml(row.id)}">수정</button> <button class="small-action danger" data-card-detail-delete="${escapeHtml(row.id)}">삭제</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="no-data">아직 등록한 상세 지출이 없습니다.</div>'}</section><section class="card-category-chart"><div class="section-heading"><div><h3>카테고리별 지출</h3><div class="sectionsub">금액이 많은 순서</div></div></div>${categories.length ? `<div class="card-category-list">${categories.map(([category, amount], index) => `<div class="card-category-row"><span>${index + 1}</span><div><div class="between"><b>${escapeHtml(category)}</b><strong class="mono">${money(amount)}</strong></div><i><em style="width:${amount / max * 100}%"></em></i></div></div>`).join('')}</div>` : '<div class="no-data">상세 지출을 등록하면 카테고리 그래프가 표시됩니다.</div>'}</section></div><div class="note">상세 내역은 카드 총액에 중복 합산되지 않습니다. 미분류 금액은 카드 총액에서 상세 내역 합계를 뺀 값입니다.</div></section>`);
}
function periodSeries() { return Array.from({ length: 12 }, (_, i) => deliveryTotals(state.earnings, state.expenses, monthKey(state.year, i + 1), true)); }
function monthlyChart() {
  const values = periodSeries(), max = Math.max(1, ...values.flatMap(v => [v.payout, v.expenses]));
  return `<section class="card"><div class="chart-head"><div><h3>${state.year}년 배달 수익 vs 운영비</h3><div class="sectionsub">1~12월 플랫폼 합산 · 배달일 기준</div></div><span class="tag"><span class="lineLegend"></span> 실정산액 &nbsp; <span class="lineLegend light"></span> 운영비</span></div><div class="dual-chart">${values.map((v, i) => `<div class="dual-month ${i + 1 === state.month ? 'selected' : ''}" title="${i + 1}월 수익 ${money(v.payout)}, 운영비 ${money(v.expenses)}"><div class="dual-bars"><span class="bar-earn" style="height:${v.payout ? Math.max(2, v.payout / max * 100) : 0}%"></span><span class="bar-exp" style="height:${v.expenses ? Math.max(2, v.expenses / max * 100) : 0}%"></span></div><button class="dual-label" data-pick-month="${i + 1}">${i + 1}월</button></div>`).join('')}</div><div class="between wrap" style="margin-top:14px"><span class="tag blue">${state.month}월 실정산액 ${money(values[state.month - 1].payout)}</span><span class="tag">${state.month}월 운영비 ${money(values[state.month - 1].expenses)}</span></div></section>`;
}
function investmentDonut() {
  const investments = state.investments.filter(r => !r.workDate || monthOf(r.workDate) <= selectedMonth());
  const capital = investments.reduce((a, r) => a + r.amount, 0), vehicle = investments.filter(r => r.category === '차량').reduce((a, r) => a + r.amount, 0), pct = capital ? vehicle / capital * 100 : 0;
  return `<section class="card"><div class="section-heading"><h3>초기 투자금 구성</h3><button class="pill-btn" data-add="investment">+ 투자비</button></div><div class="initial-breakdown"><div class="donut" style="background:conic-gradient(#3b83ea 0 ${pct}%,#b8dbff ${pct}% 100%)"><div><div class="micro">차량 비중</div><b>${pct.toFixed(1)}%</b></div></div><div class="break-lines"><div class="between"><span class="small">오토바이</span><b>${money(vehicle)}</b></div><div class="between"><span class="small">장비·비품</span><b>${money(capital - vehicle)}</b></div><hr class="softline"><div class="between"><span class="small">투자비 합계</span><b>${money(capital)}</b></div></div></div><details class="investment-details"><summary>선택 월까지 구매 항목 ${investments.length}건 펼쳐보기</summary><div class="investment-list">${investments.map(r => `<div class="between"><span>${escapeHtml(r.memo || r.category)} · ${escapeHtml(r.workDate || '구매일 미상')}</span><b>${money(r.amount)}</b><button class="small-action" data-edit="investment:${escapeHtml(r.id)}">수정</button><button class="small-action danger" data-delete="investment:${escapeHtml(r.id)}">삭제</button></div>`).join('')}</div></details></section>`;
}
function platforms() {
  const items = state.earnings.filter(r => monthOf(r.workDate) === selectedMonth());
  return `<section class="card"><div class="section-heading"><h3>플랫폼별 수익</h3><span class="tag blue">${state.year}년 ${state.month}월</span></div>${['배민커넥트', '쿠팡이츠'].map((name, i) => { const selected = items.filter(r => r.platform === name), t = deliveryTotals(selected, [], selectedMonth(), true); return `<div class="platform-row"><div class="inline"><span class="platform-brand ${i ? 'coupang' : ''}">${i ? '쿠' : '배'}</span><div><strong>${name}</strong><div class="micro">${selected.length}회 기록 · ${t.deliveries}건 배달</div></div></div><div style="text-align:right"><b>${money(t.payout)}</b><div style="margin-top:7px"><button class="pill-btn" data-add="income" data-platform="${name}">+ 기록</button></div></div></div>`; }).join('')}</section>`;
}
function recordList() {
  const items = [...state.earnings, ...state.expenses].filter(r => monthOf(r.workDate) === selectedMonth()).sort(byDate);
  return `<section class="card"><div class="section-heading"><div><h3>이번 달 배달 기록</h3><div class="sectionsub">수정한 날짜의 월별 통계가 자동으로 갱신됩니다.</div></div><span class="tag blue">${items.length}건</span></div>${items.length ? `<div class="overflow-x"><table class="ledger-table record-table"><thead><tr><th>배달일</th><th>구분</th><th>내용</th><th style="text-align:right">반영 금액</th><th>관리</th></tr></thead><tbody>${items.map(r => `<tr><td>${escapeHtml(r.workDate)}</td><td><span class="tag ${r.kind === 'income' ? 'blue' : 'orange'}">${r.kind === 'income' ? '수익' : '운영비'}</span></td><td><b>${escapeHtml(r.platform || r.category)}</b>${r.memo ? `<div class="micro">${escapeHtml(r.memo)}</div>` : ''}</td><td class="amount mono ${r.kind === 'income' ? 'plus' : 'minus'}">${r.kind === 'income' ? '+' : '−'}${money(r.kind === 'income' ? r.grossIncome - r.settlementDeduction : r.amount)}</td><td><button class="small-action" data-edit="${r.kind}:${escapeHtml(r.id)}">수정</button> <button class="small-action danger" data-delete="${r.kind}:${escapeHtml(r.id)}">삭제</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-record"><div class="empty-icon">🛵</div><strong>${state.year}년 ${state.month}월 기록이 없습니다.</strong><p>쿠팡이츠 또는 배민커넥트에서 + 기록을 눌러 수익을 등록해 보세요.</p></div>`}</section>`;
}
function deliveryCalendar() {
  const calendarMonth = displayedCalendarMonth(), [year, month] = calendarMonth.split('-').map(Number);
  const daily = new Map();
  for (const row of state.earnings.filter(r => monthOf(r.workDate) === calendarMonth)) daily.set(row.workDate, (daily.get(row.workDate) || 0) + row.grossIncome - row.settlementDeduction);
  for (const row of state.expenses.filter(r => monthOf(r.workDate) === calendarMonth)) daily.set(row.workDate, (daily.get(row.workDate) || 0) - row.amount);
  const offset = new Date(year, month - 1, 1).getDay(), last = new Date(year, month, 0).getDate();
  const blanks = Array.from({ length: offset }, () => '<div class="delivery-calendar-empty" aria-hidden="true"></div>').join('');
  const days = Array.from({ length: last }, (_, index) => {
    const day = index + 1, date = `${calendarMonth}-${String(day).padStart(2, '0')}`, total = daily.get(date);
    const amount = total === undefined ? '' : `<span class="calendar-amount">${total >= 0 ? '+' : '−'}${money(Math.abs(total))}</span>`;
    return `<div class="delivery-calendar-day ${date === today ? 'today' : ''}" data-calendar-date="${date}"><span class="calendar-date">${day}</span>${amount}</div>`;
  }).join('');
  return `<section class="card delivery-calendar"><div class="section-heading"><div><h3 data-calendar-title>${year}년 ${month}월 배달 달력</h3><div class="sectionsub">기록을 저장하면 해당 날짜에 일별 순반영 금액이 표시됩니다.</div></div><div class="calendar-controls"><button class="calendar-nav" data-calendar-move="-1" aria-label="이전 달">‹</button><span class="tag blue">파란 띠 = 기록 있음</span><button class="calendar-nav" data-calendar-move="1" aria-label="다음 달">›</button></div></div><div class="delivery-calendar-week" aria-hidden="true">${['일', '월', '화', '수', '목', '금', '토'].map(day => `<span>${day}</span>`).join('')}</div><div class="delivery-calendar-grid">${blanks}${days}</div></section>`;
}
function insight(monthly, result) {
  const perDrop = monthly.deliveries ? money(monthly.payout / monthly.deliveries) : '—';
  const perHour = monthly.hours ? money(monthly.net / monthly.hours) : '—';
  const perKm = monthly.distance ? money(monthly.net / monthly.distance) : '—';
  const histories = Array.from({ length: 3 }, (_, index) => {
    const point = new Date(state.year, state.month - 1 - index, 1);
    return deliveryTotals(state.earnings, state.expenses, monthKey(point.getFullYear(), point.getMonth() + 1), true);
  });
  let forecast = '회수 시점 예측은 월간 순수익 3개월이 쌓이면 표시합니다.';
  if (result.completed) forecast = '투자금을 전액 회수했습니다.';
  else if (result.capital > 0 && histories.every(h => h.count > 0 && h.net > 0)) {
    const average = histories.reduce((sum, h) => sum + h.net, 0) / 3;
    const months = Math.ceil(result.remaining / average);
    if (months > 0 && months <= 120) {
      const predicted = new Date(state.year, state.month - 1 + months, 1);
      forecast = `회수 예상 ${predicted.getFullYear()}년 ${predicted.getMonth() + 1}월 · 최근 3개월 평균 기준 추정`;
    }
  }
  return `<div class="note">건당 실수령 ${perDrop} · 시간당 순수익 ${perHour} · 1km당 순수익 ${perKm}<br>이번 달 ${monthly.net > 0 ? '월간 흑자' : '월간 흑자 전'} · ${forecast}</div>`;
}
function side() {
  if (!hasDelivery()) return shell(`${heading('배달 부업 수익 관리', '공동 배달 장부')}<section class="card"><div class="no-data">이 계정에는 공동 배달 장부 접근 권한이 없습니다.</div></section>`);
  const r = recovery(state.earnings, state.expenses, state.investments, selectedMonth()), monthly = deliveryTotals(state.earnings, state.expenses, selectedMonth(), true), cumulative = deliveryTotals(state.earnings, state.expenses, selectedMonth());
  const vehicle = state.investments.filter(i => i.category === '차량' && (!i.workDate || monthOf(i.workDate) <= selectedMonth())).reduce((a, i) => a + i.amount, 0);
  return shell(`${heading('배달 부업 수익 관리', '배민커넥트 · 쿠팡이츠 수익을 배달일 기준으로 월별 정산하고 투자금을 회수합니다.')}<div class="side-hero"><section class="initial-invest"><span class="tag blue">투자금 회수 프로젝트</span><div class="sectionsub" style="margin-top:10px">오토바이·장비 초기 투자비</div><div class="counter mono">${money(r.capital)}</div><div class="stat-caption">오토바이 ${money(vehicle)} + 장비 및 비품 ${money(r.capital - vehicle)}</div><div class="meta-items"><span class="tag">구매 항목 ${state.investments.length}개</span><span class="tag">플랫폼 2곳</span></div></section><section class="surface side-roadmap"><div class="section-heading"><h3>투자금 회수 로드맵</h3><span class="tag ${r.completed ? 'green' : 'orange'}">${r.completed ? '전액 회수 완료' : '회수 진행 중'}</span></div><div class="micro">${selectedMonth()}까지 누적 순현금수익 / 투자금</div><div class="counter mono">${r.percent.toFixed(1)}%</div><div class="status-track"><span style="width:${r.percent}%"></span></div><div class="between"><span class="micro">남은 투자금</span><b class="mono">${money(r.remaining)}</b></div><div class="sectionsub" style="margin-top:12px">누적 수익 ${money(cumulative.payout)} − 누적 운영비 ${money(cumulative.expenses)} = ${money(cumulative.net)} · 투자금 차감 손익 ${money(r.profit)}</div></section></div><div class="side-metrics"><div><div class="micro">이번 달 실정산액</div><b class="mono">${money(monthly.payout)}</b><div class="micro">공제 전 ${money(monthly.gross)}</div></div><div><div class="micro">이번 달 운영비</div><b class="mono">${money(monthly.expenses)}</b><div class="micro">주유·정비 등</div></div><div><div class="micro">이번 달 순현금수익</div><b class="mono ${monthly.net >= 0 ? 'plus' : 'minus'}">${money(monthly.net)}</b><div class="micro">실정산액 − 운영비</div></div><div><div class="micro">배달 실적</div><b class="mono">${monthly.deliveries}건</b><div class="micro">${monthly.hours.toFixed(1)}시간 · ${monthly.distance.toFixed(1)}km</div></div></div>${insight(monthly, r)}<div class="side-analytics">${monthlyChart()}${investmentDonut()}</div><div class="side-bottom">${platforms()}<section class="card"><div class="section-heading"><h3>수익 및 운영비 빠른 등록</h3><span class="tag blue">날짜 지정 가능</span></div><div class="record-actions"><button data-add="income" data-platform="쿠팡이츠">쿠팡이츠 배달 수익 <b>+ 기록</b></button><button data-add="income" data-platform="배민커넥트">배민커넥트 배달 수익 <b>+ 기록</b></button><button data-add="expense">주유·정비·보험료 등 <b>+ 기록</b></button></div><div class="note" style="margin-top:14px">정산에서 공제된 보험료 등은 운영비로 중복 등록하지 마세요.</div></section></div>${recordList()}${deliveryCalendar()}`);
}
function render() {
  if (state.status !== 'ready') { authScreen(); return; }
  document.querySelector('.notice-right').textContent = state.offline ? '오프라인 캐시' : 'Firebase 실시간 동기화';
  root.innerHTML = { home, ledger, cards: cardDetails, side }[state.page]();
  applyBranding();
  root.querySelectorAll('.business-mini .micro small, .side-metrics > div:first-child .micro:last-child').forEach(element => element.remove());
  const filter = root.querySelector('[data-filter]');
  if (filter) filter.value = state.filter;
  document.title = `우리집 머니보드 · ${state.page === 'home' ? '홈' : state.page === 'ledger' ? '가계부' : state.page === 'cards' ? '카드 상세 내역' : '부업'}`;
  if (!chatWidget && !chatLoading) {
    chatLoading = import('./chat-widget.js?v=20261105-1').then(({ mountChatbot }) => {
      if (state.status === 'ready' && !chatWidget) chatWidget = mountChatbot(() => ({
        status: state.status, year: state.year, month: state.month, offline: state.offline,
        deliveryEnabled: hasDelivery(), transactions: state.transactions, rules: state.rules,
        earnings: state.earnings, expenses: state.expenses, investments: state.investments
      }));
    }).catch(failure).finally(() => { chatLoading = null; });
  }
}
function openDialog(title, subtitle, html) {
  document.getElementById('dialogTitle').textContent = title;
  document.getElementById('dialogSubtitle').textContent = subtitle;
  formContainer.innerHTML = html;
  formContainer.querySelector('#calcPreview')?.previousElementSibling && (formContainer.querySelector('#calcPreview').previousElementSibling.textContent = '등록 수입');
  dialog.classList.add('open'); dialog.setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open');
  formContainer.querySelector('input:not([type="hidden"]),select,button')?.focus();
}
function closeDialog() { dialog.classList.remove('open'); dialog.setAttribute('aria-hidden', 'true'); document.body.classList.remove('modal-open'); formContainer.innerHTML = ''; }
function field(label, name, value = '', options = {}) {
  if (name === 'settlementDeduction') return '<input name="settlementDeduction" type="hidden" value="0">';
  const { type = 'text', required = false, min, step, maxLength = 150, currency = false } = options;
  if (name === 'memo') return `<div class="form-field"><label for="field-${name}">${label}${required ? ' <span class="required">*</span>' : ''}</label><textarea id="field-${name}" name="${name}" rows="3" maxlength="${maxLength}" placeholder="카드값 상세 내역을 여러 줄로 입력할 수 있습니다.">${escapeHtml(value)}</textarea></div>`;
  const displayValue = currency ? currencyInput(value) : value;
  return `<div class="form-field"><label for="field-${name}">${label}${required ? ' <span class="required">*</span>' : ''}</label><input id="field-${name}" name="${name}" type="${currency ? 'text' : type}" value="${escapeHtml(displayValue)}" ${currency ? 'data-currency inputmode="numeric" autocomplete="off"' : ''} ${required ? 'required' : ''} ${min !== undefined && !currency ? `min="${min}"` : ''} ${step !== undefined && !currency ? `step="${step}"` : ''} maxlength="${maxLength}"></div>`;
}
function choice(label, name, choices, selected) { const visible = name === 'type' ? [['income', '수입'], ['expense', '지출']] : choices; return `<div class="form-field"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}">${visible.map(([value, text]) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select></div>`; }
function buttons(editing) { return `<div class="modal-buttons"><button type="button" class="pill-btn" data-close>취소</button><button class="pill-btn primary" type="submit">${editing ? '수정 저장' : '기록 저장'}</button></div>`; }
function openDelivery(kind = 'income', platform = '쿠팡이츠', record = null) {
  const r = record || {}, editing = !!record, date = r.workDate ?? (kind === 'investment' ? '' : selectedMonth() === monthOf(today) ? today : selectedMonth() + '-01');
  const income = kind === 'income', investment = kind === 'investment';
  openDialog(editing ? '기록 수정' : income ? '배달 수익 등록' : investment ? '투자비 등록' : '운영비 등록', '발생 날짜를 지정하면 해당 월 분석에 반영됩니다.',
    `<form id="deliveryForm" data-kind="${kind}" data-id="${escapeHtml(r.id || '')}"><div class="modal-hint"><span class="tag blue">${income ? '배달 수행일' : '지출 발생일'} 직접 지정</span><button type="button" class="today-btn" data-today>오늘 날짜</button></div>${income ? choice('배달 플랫폼', 'platform', [['쿠팡이츠', '쿠팡이츠'], ['배민커넥트', '배민커넥트']], r.platform || platform) : choice(investment ? '투자비 유형' : '운영비 유형', 'category', (investment ? ['차량', '장비·비품', '추가 투자'] : ['주유비', '보험료', '엔진오일·정비', '타이어·소모품', '기타 운영비']).map(v => [v, v]), r.category || (investment ? '장비·비품' : '주유비'))}${field(investment ? '구매일 (모르면 공란)' : '발생일', 'workDate', date, { type: 'date', required: !investment })}<div class="form-row">${field(income ? '총 배달 수입 (원)' : '금액 (원)', income ? 'grossIncome' : 'amount', income ? r.grossIncome ?? '' : r.amount ?? '', { currency: true, required: true })}${income ? field('정산 공제액 (원)', 'settlementDeduction', r.settlementDeduction ?? 0, { currency: true }) : ''}</div>${income ? `<div class="form-row three">${field('배달 건수', 'deliveryCount', r.deliveryCount ?? 0, { type: 'number', min: 0, step: 1 })}${field('근무시간 (h)', 'workHours', r.workHours ?? 0, { type: 'number', min: 0, step: 0.1 })}${field('주행거리 (km)', 'distanceKm', r.distanceKm ?? 0, { type: 'number', min: 0, step: 0.1 })}</div>` : ''}${field('메모', 'memo', r.memo || '', { maxLength: 150 })}<div class="preview-total"><span>${income ? '예상 실정산액' : investment ? '투자비' : '운영비'}</span><strong id="calcPreview">${money(income ? (r.grossIncome || 0) - (r.settlementDeduction || 0) : r.amount || 0)}</strong></div>${buttons(editing)}</form>`);
}
async function saveDelivery(form) {
  const kind = form.dataset.kind, id = form.dataset.id, date = form.elements.workDate.value;
  const base = { ownerUid: deliveryOwnerUid(), kind, workDate: date, workMonth: monthOf(date), memo: form.elements.memo.value.trim() };
  const record = kind === 'income' ? { ...base, platform: form.elements.platform.value, grossIncome: integer(form.elements.grossIncome.value, '수입'), settlementDeduction: integer(form.elements.settlementDeduction.value || 0, '공제액'), deliveryCount: integer(form.elements.deliveryCount.value || 0, '배달 건수'), workHours: Number(form.elements.workHours.value || 0), distanceKm: Number(form.elements.distanceKm.value || 0) } : { ...base, category: form.elements.category.value, amount: integer(form.elements.amount.value) };
  validateDelivery(record);
  const path = kind === 'income' ? 'deliveryEarnings' : kind === 'expense' ? 'deliveryExpenses' : 'deliveryInvestments';
  const ref = id ? doc(db, 'users', deliveryOwnerUid(), path, id) : doc(collection(db, 'users', deliveryOwnerUid(), path));
  if (id) await updateDoc(ref, { ...record, updatedAt: serverTimestamp() });
  else await setDoc(ref, { ...record, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await writeAudit(id ? '수정' : '등록', '부업 기록', `${record.platform || record.category} · ${money(record.grossIncome ?? record.amount)}`);
  if (date) { state.year = Number(date.slice(0, 4)); state.month = Number(date.slice(5, 7)); state.calendarMonth = selectedMonth(); } state.page = 'side'; closeDialog(); render(); notify('기록을 저장했습니다.');
}
function openLedger(record = null, recurring = false) {
  const r = record || {}, editing = !!record, isRule = recurring;
  const date = r.date || selectedMonth() + '-01';
  openDialog(editing ? '가계부 기록 수정' : isRule ? '반복 거래 등록' : '가계부 기록 등록', '내부 이체·저축·대출 원금은 지출 합계에서 제외됩니다.',
    `<form id="ledgerForm" data-id="${escapeHtml(r.id || '')}" data-rule="${isRule ? 'true' : 'false'}">${choice('담당자', 'person', [['y', '용현'], ['s', '선영']], r.person || 'y')}${choice('분류', 'type', Object.entries(typeLabels), r.type || 'expense')}${field('항목 이름', 'title', r.title || '', { required: true, maxLength: 100 })}<div class="form-row">${field('금액 (원)', 'amount', r.amount ?? '', { currency: true, required: true })}${isRule ? field('반복 시작월', 'startMonth', r.startMonth || selectedMonth(), { type: 'month', required: true }) : field('거래·결제일', 'date', date, { type: 'date', required: true })}</div>${isRule ? `<div class="form-row three">${field('반복 종료월 (선택)', 'endMonth', r.endMonth || '', { type: 'month' })}${field('매월 결제일', 'day', r.day || 1, { type: 'number', min: 1, step: 1 })}${field('할부 총 회차 (0=계속)', 'installments', r.installments || 0, { type: 'number', min: 0, step: 1 })}</div>` : ''}<div class="form-row">${field('카테고리', 'category', r.category || '')}${field('결제 수단', 'paymentMethod', r.paymentMethod || '')}</div>${field('계좌·결제처', 'account', r.account || '')}${field('메모', 'memo', r.memo || '')}${!isRule ? `<div class="form-row">${choice('납부 상태', 'paid', [['false', '미완료'], ['true', '완료']], String(r.paid || false))}${field('실제 납부일 (선택)', 'paidDate', r.paidDate || '', { type: 'date' })}</div>` : ''}${buttons(editing)}</form>`);
}
function openCardDetail(record = null) {
  const card = record ? cardCatalog.find(item => item.key === record.cardKey) : activeCard();
  const r = record || {}, date = r.date || (selectedMonth() === monthOf(today) ? today : `${selectedMonth()}-01`);
  openDialog(r.id ? '카드 상세 지출 수정' : '카드 상세 지출 등록', `${card.name} · ${personName(card.person)} 카드 총액에는 중복 합산되지 않습니다.`, `<form id="cardDetailForm" data-id="${escapeHtml(r.id || '')}"><div class="hintbox"><b>${card.name} · ${personName(card.person)}</b><br>이 내역은 카드 사용처 분석용이며 부부 가계부 지출 합계에는 더해지지 않습니다.</div>${field('사용일', 'date', date, { type: 'date', required: true })}${field('항목 이름', 'title', r.title || '', { required: true, maxLength: 100 })}<div class="form-row">${field('카테고리', 'category', r.category || '', { required: true, maxLength: 80 })}${field('금액 (원)', 'amount', r.amount ?? '', { currency: true, required: true })}</div>${field('메모', 'memo', r.memo || '', { maxLength: 150 })}${buttons(!!r.id)}</form>`);
}
async function saveCardDetail(form) {
  const id = form.dataset.id, card = activeCard();
  const record = { cardKey: card.key, cardName: card.name, person: card.person, date: form.elements.date.value, title: form.elements.title.value.trim(), category: form.elements.category.value.trim(), amount: integer(form.elements.amount.value), memo: form.elements.memo.value.trim() };
  if (!validDate(record.date)) throw Error('사용일을 확인하세요.');
  if (!record.title || record.title.length > 100) throw Error('항목 이름을 확인하세요.');
  if (!record.category || record.category.length > 80) throw Error('카테고리를 입력해 주세요.');
  if (record.memo.length > 150) throw Error('메모는 150자 이내로 입력하세요.');
  const ref = id ? doc(db, 'households', state.access.householdId, 'cardDetails', id) : doc(collection(db, 'households', state.access.householdId, 'cardDetails'));
  if (id) await updateDoc(ref, { ...record, updatedAt: serverTimestamp() });
  else await setDoc(ref, { ...record, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await writeAudit(id ? '수정' : '등록', '카드 상세 내역', `${card.name} · ${personName(card.person)} · ${record.title} · ${money(record.amount)}`);
  state.year = Number(record.date.slice(0, 4)); state.month = Number(record.date.slice(5, 7)); state.page = 'cards';
  closeDialog(); render(); notify('카드 상세 지출을 저장했습니다.');
}
async function removeCardDetail(id) {
  const record = state.cardDetails.find(item => item.id === id); if (!record) return;
  if (!confirm(`${record.title} 상세 내역을 삭제하시겠습니까?`)) return;
  await deleteDoc(doc(db, 'households', state.access.householdId, 'cardDetails', id));
  await writeAudit('삭제', '카드 상세 내역', `${record.cardName} · ${record.title} · ${money(record.amount)}`);
  notify('카드 상세 내역을 삭제했습니다.');
}
function openSettings() {
  openDialog('개인 설정', '이 설정은 로그인한 본인에게만 보입니다.', `<form id="settingsForm">${field('표시 이름', 'displayName', state.settings.displayName || state.user.displayName || '', { maxLength: 40 })}${choice('기본 배달 플랫폼', 'defaultPlatform', [['쿠팡이츠', '쿠팡이츠'], ['배민커넥트', '배민커넥트']], state.settings.defaultPlatform || '쿠팡이츠')}${buttons(!!state.settings.ownerUid)}</form>`);
}
function auditMillis(value) { return value?.toDate ? value.toDate().getTime() : value instanceof Date ? value.getTime() : Number(value?.seconds || 0) * 1000; }
function auditTime(value) { const time = auditMillis(value); return time ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(time)) : '저장 중'; }
function auditActor(uid) { return uid === state.household?.ownerUid ? '용현' : '선영'; }
async function writeAudit(action, target, summary) {
  const ref = doc(collection(db, 'households', state.access.householdId, 'auditLogs'));
  await setDoc(ref, { actorUid: state.user.uid, action, target, summary: String(summary).slice(0, 160), createdAt: serverTimestamp() });
}
function openAuditLog() {
  const logs = [...state.auditLogs].sort((a, b) => auditMillis(b.createdAt) - auditMillis(a.createdAt)).slice(0, 100);
  openDialog('수정 이력', '최근 100건을 표시합니다. 기록은 수정하거나 삭제할 수 없습니다.', `<div class="investment-list audit-list">${logs.length ? logs.map(log => `<div class="between align-start"><span><b>${escapeHtml(auditActor(log.actorUid))}</b> · ${escapeHtml(log.target)} ${escapeHtml(log.action)}<br><span class="micro">${escapeHtml(log.summary)}</span></span><span class="micro">${auditTime(log.createdAt)}</span></div>`).join('') : '<div class="no-data">아직 남겨진 수정 이력이 없습니다.</div>'}</div>`);
}
async function saveSettings(form) {
  const ref = doc(db, 'users', state.user.uid, 'settings', 'app');
  const value = { ownerUid: state.user.uid, displayName: form.elements.displayName.value.trim().slice(0, 40), defaultPlatform: form.elements.defaultPlatform.value };
  if (state.settings.ownerUid) await updateDoc(ref, { ...value, updatedAt: serverTimestamp() });
  else await setDoc(ref, { ...value, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  closeDialog(); notify('개인 설정을 저장했습니다.');
}
async function saveLedger(form) {
  const rule = form.dataset.rule === 'true', id = form.dataset.id;
  const common = { person: form.elements.person.value, type: form.elements.type.value, title: form.elements.title.value.trim(), amount: integer(form.elements.amount.value), category: form.elements.category.value.trim(), paymentMethod: form.elements.paymentMethod.value.trim(), account: form.elements.account.value.trim(), memo: form.elements.memo.value.trim() };
  const value = rule ? { ...common, startMonth: form.elements.startMonth.value, endMonth: form.elements.endMonth.value, day: Number(form.elements.day.value), installments: Number(form.elements.installments.value) } : { ...common, date: form.elements.date.value, paid: form.elements.paid.value === 'true', paidDate: form.elements.paidDate.value, recurringRuleId: id.startsWith('virtual:') ? id.split(':')[1] : state.transactions.find(r => r.id === id)?.recurringRuleId || '' };
  if (rule) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.startMonth) || value.endMonth && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.endMonth) || value.endMonth < value.startMonth) || !Number.isInteger(value.day) || value.day < 1 || value.day > 31 || !Number.isInteger(value.installments) || value.installments < 0 || value.installments > 120) throw Error('반복 기간과 할부 회차를 확인하세요.');
    validateTransaction({ ...value, date: value.startMonth + '-01' });
  } else { validateTransaction(value); if (value.paidDate && !validDate(value.paidDate)) throw Error('실제 납부일을 확인하세요.'); if (id.startsWith('virtual:') && monthOf(value.date) !== id.split(':')[2]) throw Error('반복 예정 항목은 같은 월 안에서만 날짜를 수정할 수 있습니다.'); }
  const path = rule ? 'recurringRules' : 'transactions';
  const documentId = id.startsWith('virtual:') ? `${value.recurringRuleId}_${monthOf(value.date)}` : id;
  const ref = documentId ? doc(db, 'households', state.access.householdId, path, documentId) : doc(collection(db, 'households', state.access.householdId, path));
  if (documentId && !id.startsWith('virtual:')) await updateDoc(ref, { ...value, updatedAt: serverTimestamp() });
  else await setDoc(ref, { ...value, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await writeAudit(id ? '수정' : '등록', rule ? '반복 거래' : '가계부 기록', `${value.person === 'y' ? '용현' : '선영'} · ${value.title} · ${money(value.amount)}`);
  if (!rule) { state.year = Number(value.date.slice(0, 4)); state.month = Number(value.date.slice(5, 7)); }
  closeDialog(); render(); notify('가계부 기록을 저장했습니다.');
}
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function backup(format) {
  const prefix = String(state.year);
  const transactions = state.transactions.filter(r => r.date.startsWith(prefix));
  if (format === 'csv') {
    const columns = ['id', 'date', 'person', 'type', 'title', 'amount', 'category', 'paymentMethod', 'account', 'memo', 'paid', 'paidDate'];
    const csv = '\ufeff' + [columns.join(','), ...transactions.map(row => columns.map(c => csvCell(row[c])).join(','))].join('\r\n');
    download(`moneyboard-household-${prefix}.csv`, csv, 'text/csv;charset=utf-8');
  } else {
    const data = { version: 1, year: state.year, transactions, recurringRules: state.rules,
      ...(hasDelivery() ? { deliveryEarnings: state.earnings.filter(r => r.workDate.startsWith(prefix)), deliveryExpenses: state.expenses.filter(r => r.workDate.startsWith(prefix)), deliveryInvestments: state.investments.filter(r => !r.workDate || r.workDate.startsWith(prefix)) } : {}) };
    download(`moneyboard-${prefix}.json`, JSON.stringify(data, null, 2), 'application/json');
  }
}
function importDialog() {
  openDialog('기존 데이터 가져오기', 'JSON 백업을 선택하거나 이 브라우저의 이전 시연 기록을 가져옵니다. 자동 업로드는 하지 않습니다.',
    `<form id="importForm"><div class="form-field"><label for="importFile">JSON 백업 파일</label><input id="importFile" type="file" accept="application/json,.json"></div><div class="modal-buttons"><button class="pill-btn" type="button" data-close>취소</button><button class="pill-btn primary" type="submit">검토 후 가져오기</button></div></form><hr class="softline"><button class="pill-btn" data-import-preview>이 브라우저의 이전 배달 기록 가져오기</button>`);
}
function cleanTransaction(r) {
  const value = { person: r.person, type: r.type, title: String(r.title || '').trim(), amount: integer(r.amount), date: r.date, category: String(r.category || ''), paymentMethod: String(r.paymentMethod || ''), account: String(r.account || ''), memo: String(r.memo || ''), paid: r.paid === true, paidDate: r.paidDate || '', recurringRuleId: String(r.recurringRuleId || '') };
  return validateTransaction(value);
}
function cleanRule(r) {
  const base = cleanTransaction({ ...r, date: (r.startMonth || '') + '-01' });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.startMonth || '') || r.endMonth && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.endMonth) || r.endMonth < r.startMonth)) throw Error('반복 거래의 기간을 확인하세요.');
  const day = integer(r.day, '반복일'), installments = integer(r.installments || 0, '할부 회차');
  if (day < 1 || day > 31 || installments > 120) throw Error('반복 거래의 회차를 확인하세요.');
  const { date, paid, paidDate, recurringRuleId, ...rest } = base;
  return { ...rest, startMonth: r.startMonth, endMonth: r.endMonth || '', day, installments };
}
function cleanDelivery(r, kind) {
  const base = { ownerUid: deliveryOwnerUid(), kind, workDate: r.workDate, workMonth: monthOf(r.workDate || ''), memo: String(r.memo || '') };
  const value = kind === 'income' ? { ...base, platform: r.platform, grossIncome: integer(r.grossIncome), settlementDeduction: integer(r.settlementDeduction || 0), deliveryCount: integer(r.deliveryCount || 0), workHours: Number(r.workHours || 0), distanceKm: Number(r.distanceKm || 0) } : { ...base, category: String(r.category || ''), amount: integer(r.amount) };
  return validateDelivery(value);
}
async function importData(data) {
  if (data.version !== 1) throw Error('지원하지 않는 백업 형식입니다.');
  const specs = [
    ['transactions', 'transactions', 'household', cleanTransaction],
    ['recurringRules', 'rules', 'household', cleanRule],
    ['deliveryEarnings', 'earnings', 'personal', r => cleanDelivery(r, 'income')],
    ['deliveryExpenses', 'expenses', 'personal', r => cleanDelivery(r, 'expense')],
    ['deliveryInvestments', 'investments', 'personal', r => cleanDelivery(r, 'investment')]
  ];
  const pending = [];
  for (const [source, target, scope, clean] of specs) {
    if (scope === 'personal' && !hasDelivery() && data[source]?.length) throw Error('공동 배달 장부를 가져올 권한이 없습니다.');
    const rows = data[source] || [];
    if (!Array.isArray(rows)) throw Error(`${source} 배열을 확인하세요.`);
    if (rows.length > 2000) throw Error('한 번에 가져올 수 있는 항목은 2,000건입니다.');
    const known = new Set(state[target].map(r => r.id));
    for (const row of rows) {
      if (row.id && known.has(row.id)) continue;
      const value = clean(row);
      const path = scope === 'household' ? ['households', state.access.householdId, collectionNames[target]] : ['users', deliveryOwnerUid(), collectionNames[target]];
      const ref = row.id && /^[\w-]{1,120}$/.test(row.id) ? doc(db, ...path, row.id) : doc(collection(db, ...path));
      pending.push([ref, value]); known.add(ref.id);
    }
  }
  if (!pending.length) { notify('새로 가져올 기록이 없습니다.'); return; }
  if (!confirm(`${pending.length}건의 기록을 Firestore에 저장하시겠습니까? 이미 있는 ID는 건너뜁니다.`)) return;
  for (let i = 0; i < pending.length; i += 5) {
    const batch = writeBatch(db);
    for (const [ref, value] of pending.slice(i, i + 5)) batch.set(ref, { ...value, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await batch.commit();
  }
  closeDialog(); notify(`${pending.length}건을 가져왔습니다.`);
}
async function importPreview() {
  const raw = localStorage.getItem('moneyboard_A_v3_preview_records');
  if (!raw) throw Error('이 브라우저에 이전 시연 기록이 없습니다.');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw Error('이전 기록 형식을 확인하세요.');
  const earnings = [], expenses = [];
  for (const r of rows) {
    if (r.kind === 'income') earnings.push({ id: r.id, workDate: r.date, platform: r.platform, grossIncome: r.amount, settlementDeduction: r.deduction || 0, deliveryCount: r.count || 0, workHours: r.hours || 0, distanceKm: r.km || 0, memo: r.note || '' });
    else if (r.kind === 'expense') expenses.push({ id: r.id, workDate: r.date, amount: r.amount, category: r.category || '기타 운영비', memo: r.note || '' });
  }
  await importData({ version: 1, deliveryEarnings: earnings, deliveryExpenses: expenses });
}
async function removeDelivery(value) {
  const [kind, id] = value.split(':');
  const key = kind === 'income' ? 'earnings' : kind === 'expense' ? 'expenses' : 'investments';
  const r = state[key].find(item => item.id === id); if (!r) return;
  if (!confirm(`${r.workDate} 기록을 삭제하시겠습니까?`)) return;
  await deleteDoc(doc(db, 'users', deliveryOwnerUid(), collectionNames[key], id));
  await writeAudit('삭제', '부업 기록', `${r.platform || r.category} · ${money(r.grossIncome ?? r.amount)}`);
  notify('기록을 삭제했습니다.');
}
async function copyPreviousMonth() {
  const [year, month] = selectedMonth().split('-').map(Number);
  const previous = monthKey(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
  const lastDay = new Date(year, month, 0).getDate();
  const source = state.transactions.filter(record => monthOf(record.date) === previous && !record.recurringRuleId);
  if (!source.length) { notify(`${previous}에 복사할 일반 거래가 없습니다.`); return; }
  if (!confirm(`${previous}의 일반 거래 ${source.length}건을 ${selectedMonth()}에 복사할까요? 반복 거래는 자동 표시되므로 복사하지 않습니다.`)) return;
  const copied = source.map(record => {
    const day = Math.min(Number(record.date.slice(8, 10)), lastDay);
    return cleanTransaction({ ...record, date: `${selectedMonth()}-${String(day).padStart(2, '0')}`, paid: false, paidDate: '', recurringRuleId: '' });
  });
  for (let index = 0; index < copied.length; index += 450) {
    const batch = writeBatch(db);
    for (const record of copied.slice(index, index + 450)) {
      batch.set(doc(collection(db, 'households', state.access.householdId, 'transactions')), { ...record, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    await batch.commit();
  }
  await writeAudit('등록', '가계부 기록', `이전월 복사 ${previous} → ${selectedMonth()} · ${copied.length}건`);
  notify(`${previous} 거래 ${copied.length}건을 복사했습니다.`);
}
async function removeLedger(id) {
  if (id.startsWith('virtual:')) throw Error('반복 예정 항목은 아래의 반복 거래 관리에서 규칙을 수정하거나 삭제하세요.');
  const r = state.transactions.find(item => item.id === id); if (!r) return;
  if (!confirm(`${r.title} 기록을 삭제하시겠습니까?`)) return;
  await deleteDoc(doc(db, 'households', state.access.householdId, 'transactions', id));
  await writeAudit('삭제', '가계부 기록', `${r.person === 'y' ? '용현' : '선영'} · ${r.title} · ${money(r.amount)}`);
  notify('기록을 삭제했습니다.');
}
async function togglePaid(id) {
  const virtual = id.startsWith('virtual:');
  const r = virtual ? allTransactions(selectedMonth()).find(item => item.id === id) : state.transactions.find(item => item.id === id);
  if (!r) return;
  if (virtual) {
    const value = cleanTransaction({ ...r, paid: true, paidDate: today, recurringRuleId: id.split(':')[1] });
    await setDoc(doc(db, 'households', state.access.householdId, 'transactions', `${value.recurringRuleId}_${monthOf(value.date)}`), { ...value, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  } else await updateDoc(doc(db, 'households', state.access.householdId, 'transactions', id), { paid: !r.paid, paidDate: r.paid ? '' : today, updatedAt: serverTimestamp() });
  await writeAudit('상태 변경', '가계부 기록', `${r.person === 'y' ? '용현' : '선영'} · ${r.title} · ${r.paid ? '미완료로 변경' : '완료 처리'}`);
}
async function reorderLedger(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  if (sourceId.startsWith('virtual:') || targetId.startsWith('virtual:')) {
    if (sourceId.startsWith('virtual:') && targetId.startsWith('virtual:')) await reorderRecurring(sourceId, targetId);
    return;
  }
  const source = state.transactions.find(record => record.id === sourceId), target = state.transactions.find(record => record.id === targetId);
  if (!source || !target || source.person !== target.person || monthOf(source.date) !== selectedMonth() || monthOf(target.date) !== selectedMonth()) return;
  const rows = state.transactions.filter(record => record.person === source.person && monthOf(record.date) === selectedMonth() && (state.filter === 'all' || record.type === state.filter)).sort(ledgerOrder);
  const from = rows.findIndex(record => record.id === sourceId), to = rows.findIndex(record => record.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = rows.splice(from, 1); rows.splice(to, 0, moved);
  await Promise.all(rows.map((record, index) => updateDoc(doc(db, 'households', state.access.householdId, 'transactions', record.id), { sortOrder: (index + 1) * 10, updatedAt: serverTimestamp() })));
  await writeAudit('순서 변경', '가계부 기록', `${source.person === 'y' ? '용현' : '선영'} · ${source.title}`);
  notify('장부 순서를 변경했습니다.');
}
async function reorderRecurring(sourceId, targetId) {
  const sourceRuleId = sourceId.split(':')[1], targetRuleId = targetId.split(':')[1];
  const source = state.rules.find(rule => rule.id === sourceRuleId), target = state.rules.find(rule => rule.id === targetRuleId);
  if (!source || !target || source.person !== target.person) return;
  const visible = allTransactions(selectedMonth()).filter(record => record.virtual && record.person === source.person && (state.filter === 'all' || record.type === state.filter)).sort(ledgerOrder);
  const rules = visible.map(record => state.rules.find(rule => rule.id === record.id.split(':')[1])).filter(Boolean);
  const from = rules.findIndex(rule => rule.id === sourceRuleId), to = rules.findIndex(rule => rule.id === targetRuleId);
  if (from < 0 || to < 0) return;
  const [moved] = rules.splice(from, 1); rules.splice(to, 0, moved);
  await Promise.all(rules.map((rule, index) => updateDoc(doc(db, 'households', state.access.householdId, 'recurringRules', rule.id), { sortOrder: (index + 1) * 10, updatedAt: serverTimestamp() })));
  await writeAudit('순서 변경', '반복 거래', `${source.person === 'y' ? '용현' : '선영'} · ${source.title}`);
  notify('반복 예정 순서를 변경했습니다.');
}
let draggedLedgerId = '';
document.addEventListener('dragstart', event => {
  const row = event.target.closest('tr[data-drag-id]'); if (!row) return;
  draggedLedgerId = row.dataset.dragId;
  event.dataTransfer?.setData('text/plain', draggedLedgerId);
  event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  row.classList.add('dragging');
});
document.addEventListener('dragover', event => {
  const row = event.target.closest('tr[data-drag-id]');
  if (!row || !draggedLedgerId || row.dataset.dragId === draggedLedgerId) return;
  event.preventDefault();
  row.classList.add('drag-over');
});
document.addEventListener('dragleave', event => event.target.closest('tr[data-drag-id]')?.classList.remove('drag-over'));
document.addEventListener('dragend', () => { root.querySelectorAll('.dragging,.drag-over').forEach(row => row.classList.remove('dragging', 'drag-over')); draggedLedgerId = ''; });
document.addEventListener('drop', async event => {
  const row = event.target.closest('tr[data-drag-id]'), sourceId = draggedLedgerId || event.dataTransfer?.getData('text/plain');
  if (!row || !sourceId) return;
  event.preventDefault();
  try { await reorderLedger(sourceId, row.dataset.dragId); } catch (error) { failure(error); }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  try {
    if (button.hasAttribute('data-close')) { closeDialog(); return; }
    if (button.hasAttribute('data-today')) { const input = formContainer.querySelector('[name="workDate"]'); if (input) input.value = today; return; }
    if (button.hasAttribute('data-login')) { await signInWithPopup(auth, new GoogleAuthProvider()); return; }
    if (button.hasAttribute('data-logout')) { await signOut(auth); return; }
    if (button.hasAttribute('data-settings')) { openSettings(); return; }
    if (button.hasAttribute('data-audit')) { openAuditLog(); return; }
    if (button.dataset.moveUp || button.dataset.moveDown) {
      const id = button.dataset.moveUp || button.dataset.moveDown, row = button.closest('tr[data-drag-id]'), rows = [...row.closest('tbody').querySelectorAll('tr[data-drag-id]')], index = rows.indexOf(row);
      const target = rows[index + (button.dataset.moveUp ? -1 : 1)];
      if (target) await reorderLedger(id, target.dataset.dragId);
      return;
    }
    if (button.dataset.calendarMove) { state.calendarMonth = shiftCalendarMonth(Number(button.dataset.calendarMove)); render(); return; }
    if (button.dataset.page) { if (button.dataset.page === 'side' && state.page !== 'side') state.calendarMonth = null; state.page = button.dataset.page; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (button.dataset.cardPick) { state.cardKey = button.dataset.cardPick; render(); return; }
    if (button.hasAttribute('data-card-detail-add')) { openCardDetail(); return; }
    if (button.dataset.cardDetailEdit) { const record = state.cardDetails.find(item => item.id === button.dataset.cardDetailEdit); if (record) { state.cardKey = record.cardKey; openCardDetail(record); } return; }
    if (button.dataset.cardDetailDelete) { await removeCardDetail(button.dataset.cardDetailDelete); return; }
    if (button.dataset.add) { openDelivery(button.dataset.add, button.dataset.platform || state.settings.defaultPlatform || '쿠팡이츠'); return; }
    if (button.hasAttribute('data-ledger-add')) { openLedger(); return; }
    if (button.hasAttribute('data-rule-add')) { openLedger(null, true); return; }
    if (button.hasAttribute('data-copy-previous')) { await copyPreviousMonth(); return; }
    if (button.dataset.ruleEdit) { const rule = state.rules.find(r => r.id === button.dataset.ruleEdit); if (rule) openLedger(rule, true); return; }
    if (button.dataset.ruleDelete) {
      const rule = state.rules.find(r => r.id === button.dataset.ruleDelete);
      if (rule && confirm(`반복 거래 ${rule.title}의 규칙 전체를 삭제하시겠습니까? 이미 납부 처리한 개별 기록은 유지됩니다.`)) {
        await deleteDoc(doc(db, 'households', state.access.householdId, 'recurringRules', rule.id));
        await writeAudit('삭제', '반복 거래', `${rule.person === 'y' ? '용현' : '선영'} · ${rule.title} · ${money(rule.amount)}`);
      }
      return;
    }
    if (button.dataset.ledgerEdit) { const record = allTransactions(selectedMonth()).find(r => r.id === button.dataset.ledgerEdit); if (record) openLedger(record); return; }
    if (button.dataset.ledgerDelete) { await removeLedger(button.dataset.ledgerDelete); return; }
    if (button.dataset.pay) { await togglePaid(button.dataset.pay); return; }
    if (button.dataset.edit) { const [kind, id] = button.dataset.edit.split(':'); const list = kind === 'income' ? state.earnings : kind === 'expense' ? state.expenses : state.investments; const record = list.find(r => r.id === id); if (record) openDelivery(kind, record.platform, record); return; }
    if (button.dataset.delete) { await removeDelivery(button.dataset.delete); return; }
    if (button.dataset.pickMonth) { state.month = Number(button.dataset.pickMonth); render(); return; }
    if (button.dataset.backup) { backup(button.dataset.backup); return; }
    if (button.hasAttribute('data-import')) { importDialog(); return; }
    if (button.hasAttribute('data-import-preview')) { if (busy) return; busy = true; button.disabled = true; try { await importPreview(); } finally { busy = false; button.disabled = false; } }
  } catch (error) { failure(error); }
});
document.addEventListener('change', event => {
  if (event.target.hasAttribute('data-year')) { state.year = Number(event.target.value); state.calendarMonth = null; render(); }
  if (event.target.hasAttribute('data-month')) { state.month = Number(event.target.value); state.calendarMonth = null; render(); }
  if (event.target.hasAttribute('data-filter')) { state.filter = event.target.value; render(); }
});
document.addEventListener('input', event => {
  if (event.target.matches('input[data-currency]')) {
    event.target.value = currencyInput(event.target.value);
    event.target.setSelectionRange(event.target.value.length, event.target.value.length);
  }
  const form = event.target.closest('#deliveryForm'); if (!form || !['grossIncome', 'settlementDeduction', 'amount'].includes(event.target.name)) return;
  const amount = currencyNumber(form.elements.grossIncome?.value || form.elements.amount?.value), deduction = currencyNumber(form.elements.settlementDeduction?.value);
  form.querySelector('#calcPreview').textContent = money(amount - deduction);
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['deliveryForm', 'ledgerForm', 'cardDetailForm', 'importForm', 'settingsForm'].includes(form.id)) return;
  event.preventDefault(); if (busy) return;
  busy = true; const submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
  try {
    if (form.id === 'deliveryForm') await saveDelivery(form);
    else if (form.id === 'ledgerForm') await saveLedger(form);
    else if (form.id === 'cardDetailForm') await saveCardDetail(form);
    else if (form.id === 'settingsForm') await saveSettings(form);
    else {
      const file = form.querySelector('#importFile').files[0]; if (!file) throw Error('JSON 파일을 선택하세요.');
      if (file.size > 5_000_000) throw Error('파일 크기는 5MB 이하여야 합니다.');
      await importData(JSON.parse(await file.text()));
    }
  } catch (error) { failure(error); }
  finally { busy = false; if (submit?.isConnected) submit.disabled = false; }
});
dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && dialog.classList.contains('open')) closeDialog(); });
if (state.status === 'loading') authScreen();
