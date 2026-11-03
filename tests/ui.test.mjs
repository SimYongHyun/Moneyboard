import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, '.' + (request.url === '/' ? '/index.html' : request.url));
    if (!path.startsWith(root)) { response.writeHead(403).end(); return; }
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': `${mime[extname(path)] || 'text/plain'}; charset=utf-8` }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const authModule = `
export function getAuth(){return {}}
export class GoogleAuthProvider{}
export function onAuthStateChanged(auth,callback){queueMicrotask(()=>callback({uid:'test-y',email:'test@example.com',displayName:'테스트'}));return ()=>{}}
export async function signInWithPopup(){}
export async function signInWithRedirect(){}
export async function signOut(){}
`;
const appModule = `export function initializeApp(){return {}}`;
const firestoreModule = `
const data = new Map(); const watchers = new Map(); let serial = 0;
data.set('households/family/transactions', [
 {id:'income-y', person:'y',type:'income',title:'테스트 수입',date:'2026-11-01',amount:10000,paid:true},
 {id:'cost-y', person:'y',type:'expense',title:'테스트 식비',date:'2026-11-02',amount:3000,paid:false,paymentMethod:'카드'},
 {id:'income-s', person:'s',type:'income',title:'테스트 수입',date:'2026-11-01',amount:8000,paid:true},
 {id:'cost-s', person:'s',type:'expense',title:'테스트 교통비',date:'2026-11-02',amount:2000,paid:false,paymentMethod:'현금'}
]);
data.set('households/family/recurringRules',[]);
data.set('users/test-y/deliveryEarnings',[]);
data.set('users/test-y/deliveryExpenses',[]);
data.set('users/test-y/deliveryInvestments',[{id:'initial',kind:'investment',workDate:'',workMonth:'',category:'차량',amount:2000,memo:'시험 장비'}]);
const path = parts => parts.join('/');
export function getFirestore(){return {}}
export function collection(db,...parts){return {path:path(parts),kind:'collection'}}
export function doc(first,...parts){if(first?.kind==='collection')return {path:first.path+'/'+(++serial),kind:'doc'};return {path:path(parts),kind:'doc'}}
export function query(ref){return ref}
export function limit(){return 5000}
export async function getDoc(ref){const value=ref.path==='allowedUsers/test-y'?{householdId:'family',deliveryEnabled:true}:ref.path==='households/family'?{members:['test-y','test-s'],ownerUid:'test-y',name:'테스트 가구'}:null;return {exists:()=>value!==null,data:()=>value}}
function snapshot(ref){if(ref.kind==='doc'){const value=data.get(ref.path);return {exists:()=>!!value,data:()=>value,metadata:{fromCache:false}}}return {docs:(data.get(ref.path)||[]).map(row=>({id:row.id,data:()=>({...row})})),metadata:{fromCache:false}}}
function emit(path){for(const callback of watchers.get(path)||[])queueMicrotask(()=>callback(snapshot({path,kind:path.endsWith('/app')?'doc':'collection'})))}
export function onSnapshot(ref,a,b){const callback=typeof a==='function'?a:b;const key=ref.path;const callbacks=watchers.get(key)||[];callbacks.push(callback);watchers.set(key,callbacks);queueMicrotask(()=>callback(snapshot(ref)));return ()=>watchers.set(key,(watchers.get(key)||[]).filter(x=>x!==callback))}
function mutate(ref,value,remove=false){const bits=ref.path.split('/'), id=bits.pop(), key=bits.join('/');if(ref.path.endsWith('/app')){data.set(ref.path,value);emit(ref.path);return}const rows=data.get(key)||[];const index=rows.findIndex(r=>r.id===id);if(remove){if(index>=0)rows.splice(index,1)}else if(index>=0)rows[index]={...rows[index],...value};else rows.push({id,...value});data.set(key,rows);emit(key)}
export async function setDoc(ref,value){mutate(ref,value)}
export async function updateDoc(ref,value){mutate(ref,value)}
export async function deleteDoc(ref){mutate(ref,null,true)}
export function writeBatch(){const work=[];return {set(ref,value){work.push([ref,value])},async commit(){for(const [ref,value] of work)mutate(ref,value)}}}
export function serverTimestamp(){return new Date()}
`;

async function pageAt(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.route('**/firebase-config.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: `export const firebaseConfig={apiKey:'test',authDomain:'test.firebaseapp.com',projectId:'test',appId:'test'};` }));
  await context.route('https://www.gstatic.com/firebasejs/13.1.0/firebase-*.js', route => {
    const name = route.request().url().split('/').at(-1);
    route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: name.includes('firebase-app') ? appModule : name.includes('firebase-auth') ? authModule : firestoreModule });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '이번 달 우리집 머니보드' }).waitFor();
  assert.deepEqual(errors, []);
  return { context, page, errors };
}
function launchBrowser() {
  const executablePath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
  return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
}

test('A안 카드 순서와 다섯 화면 폭의 가로 맞춤', async () => {
  const browser = await launchBrowser();
  try {
    for (const width of [360, 390, 430, 1024, 1440]) {
      const { context, page, errors } = await pageAt(browser, width);
      const positions = await page.locator('.family-card,.household-quick,.home-chart,.business-mini').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top));
      assert.ok(positions.every((top, i) => i === 0 || top > positions[i - 1]), `카드 순서 ${width}`);
      await page.getByText('누적 총수입', { exact: true }).waitFor();
      const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(horizontalOverflow, false, `가로 넘침 ${width}`);
      assert.equal(await page.locator('.sidebar').isVisible(), width > 760);
      assert.equal(await page.locator('.bottom-nav').isVisible(), width <= 760);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `tools/ui-${width}.png`, fullPage: true });
      await context.close();
    }
  } finally { await browser.close(); }
});

test('가계부 입력과 배달 정산 화면이 사용자 조작으로 갱신된다', async () => {
  const browser = await launchBrowser();
  try {
    const { context, page, errors } = await pageAt(browser, 1440);
    await page.getByRole('button', { name: '부부 가계부' }).first().click();
    assert.match(await page.locator('.ledger-table tr').filter({ hasText: '테스트 수입' }).first().innerText(), /수입/);
    assert.match(await page.locator('.ledger-table tr').filter({ hasText: '테스트 식비' }).first().innerText(), /지출/);
    assert.ok((await page.locator('[data-ledger-add]').boundingBox()).height >= 43);
    assert.match(await page.locator('[data-ledger-add]').evaluate(el => getComputedStyle(el).backgroundImage), /linear-gradient/);
    assert.match(await page.locator('[data-rule-add]').evaluate(el => getComputedStyle(el).backgroundImage), /linear-gradient/);
    await page.getByRole('button', { name: '+ 지출 등록' }).click();
    assert.deepEqual(await page.locator('#ledgerForm [name=type] option').evaluateAll(options => options.map(option => option.value)), ['income', 'expense']);
    await page.locator('#ledgerForm [name=title]').fill('새 지출');
    await page.locator('#ledgerForm [name=amount]').fill('100');
    assert.equal(await page.locator('#ledgerForm [name=amount]').inputValue(), '100원');
    await page.locator('#ledgerForm [name=date]').fill('2026-11-02');
    await page.getByRole('button', { name: '기록 저장' }).click();
    await page.getByText('새 지출').waitFor();
    await page.screenshot({ path: 'tools/ui-ledger-1440.png', fullPage: true });
    await page.screenshot({ path: 'tools/ui-ledger-viewport.png' });
    await page.getByRole('button', { name: '부업' }).first().click();
    assert.match(await page.locator('[data-add="income"]').first().evaluate(el => getComputedStyle(el).backgroundImage), /linear-gradient/);
    assert.match(await page.locator('[data-add="investment"]').evaluate(el => getComputedStyle(el).backgroundImage), /linear-gradient/);
    await page.getByRole('button', { name: /쿠팡이츠 배달 수익/ }).click();
    await page.locator('#deliveryForm [name=workDate]').fill('2026-11-02');
    await page.locator('#deliveryForm [name=grossIncome]').fill('1000');
    assert.equal(await page.locator('#deliveryForm [name=grossIncome]').inputValue(), '1,000원');
    assert.equal(await page.getByText('정산 공제액 (원)', { exact: true }).count(), 0);
    await page.getByRole('button', { name: '기록 저장' }).click();
    await page.getByText('이번 달 실정산액').waitFor();
    assert.match(await page.locator('.side-metrics').innerText(), /1,000원/);
    await page.getByRole('button', { name: /주유·정비·보험료 등/ }).click();
    await page.locator('#deliveryForm [name=workDate]').fill('2026-11-02');
    await page.locator('#deliveryForm [name=amount]').fill('100');
    await page.getByRole('button', { name: '기록 저장' }).click();
    assert.match(await page.locator('.side-metrics').innerText(), /900원/);
    assert.equal(await page.locator('[data-calendar-date="2026-11-02"] .calendar-amount').innerText(), '+900원');
    assert.match(await page.locator('[data-calendar-title]').innerText(), /2026년 11월/);
    await page.getByRole('button', { name: '이전 달' }).click();
    assert.match(await page.locator('[data-calendar-title]').innerText(), /2026년 10월/);
    await page.getByRole('button', { name: '다음 달' }).click();
    assert.match(await page.locator('[data-calendar-title]').innerText(), /2026년 11월/);
    await page.screenshot({ path: 'tools/ui-side-1440.png', fullPage: true });
    await page.screenshot({ path: 'tools/ui-side-viewport.png' });
    await page.locator('.record-table [data-edit^="income:"]').click();
    await page.locator('#deliveryForm [name=workDate]').fill('2026-10-31');
    await page.getByRole('button', { name: '수정 저장' }).click();
    assert.match(await page.locator('.side-metrics').innerText(), /1,000원/);
    assert.match(await page.locator('.app-title .yearbar').innerText(), /10월/);
    assert.equal(await page.locator('[data-calendar-date="2026-10-31"] .calendar-amount').innerText(), '+1,000원');
    await page.locator('[data-pick-month="11"]').click();
    assert.match(await page.locator('.side-metrics').innerText(), /이번 달 실정산액\s*0원/);
    await page.locator('[data-pick-month="10"]').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.record-table [data-delete^="income:"]').click();
    await page.getByText('2026년 10월 기록이 없습니다.').waitFor();
    await page.locator('[data-add="investment"]').click();
    await page.locator('#deliveryForm [name=amount]').fill('500');
    await page.getByRole('button', { name: '기록 저장' }).click();
    assert.match(await page.locator('.initial-invest .counter').innerText(), /2,500원/);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('모바일 장부와 부업 카드가 세로로 쌓이고 입력창을 사용할 수 있다', async () => {
  const browser = await launchBrowser();
  try {
    const { context, page, errors } = await pageAt(browser, 390);
    await page.locator('.bottom-nav [data-page="ledger"]').click();
    const panels = await page.locator('.ledger-panel').evaluateAll(elements => elements.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })));
    assert.equal(panels.length, 2); assert.equal(panels[0].x, panels[1].x); assert.ok(panels[1].y > panels[0].y);
    await page.screenshot({ path: 'tools/ui-ledger-390.png', fullPage: true });
    await page.locator('.bottom-nav [data-page="side"]').click();
    const cards = await page.locator('.side-analytics > .card').evaluateAll(elements => elements.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })));
    assert.equal(cards[0].x, cards[1].x); assert.ok(cards[1].y > cards[0].y);
    await page.getByRole('button', { name: /쿠팡이츠 배달 수익/ }).click();
    assert.equal(await page.locator('#deliveryForm [name=workDate]').isVisible(), true);
    await page.screenshot({ path: 'tools/ui-delivery-form-390.png' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('개인 설정, 반복 납부, JSON 백업과 중복 가져오기', async () => {
  const browser = await launchBrowser();
  try {
    const { context, page, errors } = await pageAt(browser, 1440);
    await page.locator('.sidebar [data-settings]').click();
    await page.locator('#settingsForm [name=displayName]').fill('새 이름');
    await page.locator('#settingsForm [name=defaultPlatform]').selectOption('배민커넥트');
    await page.getByRole('button', { name: '기록 저장' }).click();
    await page.locator('.side-footer').getByText('새 이름').waitFor();
    await page.locator('.sidebar [data-page="ledger"]').click();
    await page.locator('[data-year]').selectOption('2026');
    await page.locator('[data-month]').selectOption('11');
    await page.locator('[data-rule-add]').click();
    await page.locator('#ledgerForm [name=title]').fill('정기 테스트');
    await page.locator('#ledgerForm [name=amount]').fill('300');
    await page.locator('#ledgerForm [name=startMonth]').fill('2026-11');
    await page.getByRole('button', { name: '기록 저장' }).click();
    const row = page.locator('.ledger-table tr').filter({ hasText: '정기 테스트' });
    await row.getByText('반복 예정').waitFor();
    await row.getByRole('button', { name: '미완료' }).click();
    await row.getByRole('button', { name: '완료' }).waitFor();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-backup="json"]').click();
    const download = await downloadPromise;
    const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(backup.version, 1);
    assert.ok(backup.transactions.some(r => r.title === '정기 테스트'));
    const csvPromise = page.waitForEvent('download');
    await page.locator('[data-backup="csv"]').click();
    const csv = await csvPromise;
    assert.match(await readFile(await csv.path(), 'utf8'), /정기 테스트/);
    await page.locator('[data-import]').click();
    await page.locator('#importFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByRole('button', { name: '검토 후 가져오기' }).click();
    await page.getByText('새로 가져올 기록이 없습니다.').waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});

test('Firebase 설정 전에는 거래 금액을 표시하지 않는다', async () => {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/firebase-config.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: `export const firebaseConfig={apiKey:'REPLACE_ME',authDomain:'REPLACE_ME.firebaseapp.com',projectId:'REPLACE_ME',appId:'REPLACE_ME'};` }));
    await context.route('https://www.gstatic.com/firebasejs/13.1.0/firebase-*.js', route => {
      const name = route.request().url().split('/').at(-1);
      route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: name.includes('firebase-app') ? appModule : name.includes('firebase-auth') ? authModule : firestoreModule });
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.getByText('Firebase 웹 설정을 입력해 주세요.').waitFor();
    assert.equal(await page.locator('.family-card').count(), 0);
    assert.match(await page.locator('.notice-right').innerText(), /설정 필요/);
    await context.close();
  } finally { await browser.close(); }
});

test.after(async () => server.close());
