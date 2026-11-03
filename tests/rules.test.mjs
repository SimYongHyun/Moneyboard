import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { Timestamp, collection, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

const environment = await initializeTestEnvironment({
  projectId: 'demo-moneyboard-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') }
});
const householdId = 'family';
const path = id => `households/${householdId}/transactions/${id}`;
const auditPath = id => `households/${householdId}/auditLogs/${id}`;
const earningPath = id => `users/y/deliveryEarnings/${id}`;
await environment.withSecurityRulesDisabled(async context => {
  const db = context.firestore();
  await setDoc(doc(db, 'allowedUsers/y'), { householdId, deliveryEnabled: true });
  await setDoc(doc(db, 'allowedUsers/s'), { householdId, deliveryEnabled: true });
  await setDoc(doc(db, 'households/family'), { name: 'family', ownerUid: 'y', members: ['y', 's'] });
});
const transaction = () => ({ person: 'y', type: 'expense', title: '테스트', amount: 100, date: '2026-11-02', category: '식비', paymentMethod: '카드', account: '', memo: '', paid: false, paidDate: '', recurringRuleId: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const earning = () => ({ ownerUid: 'y', kind: 'income', platform: '쿠팡이츠', workDate: '2026-11-02', workMonth: '2026-11', grossIncome: 1000, settlementDeduction: 100, deliveryCount: 1, workHours: 1, distanceKm: 5, memo: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const audit = uid => ({ actorUid: uid, action: '수정', target: '가계부 기록', summary: '용현 · 테스트 · 100원', createdAt: serverTimestamp() });
test('승인된 두 계정은 공동 거래를 읽고 쓸 수 있다', async () => {
  const y = environment.authenticatedContext('y').firestore();
  const s = environment.authenticatedContext('s').firestore();
  await assertSucceeds(setDoc(doc(y, path('one')), transaction()));
  await assertSucceeds(getDoc(doc(s, path('one'))));
  await assertSucceeds(getDocs(collection(s, 'households/family/transactions')));
  await assertSucceeds(setDoc(doc(s, path('two')), transaction()));
});
test('미승인 및 미인증 계정은 공동 거래에 접근할 수 없다', async () => {
  const outsider = environment.authenticatedContext('outsider').firestore();
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(outsider, path('one'))));
  await assertFails(getDocs(collection(outsider, 'households/family/transactions')));
  await assertFails(setDoc(doc(outsider, path('nope')), transaction()));
  await assertFails(getDoc(doc(anonymous, path('one'))));
});
test('수정 이력은 승인된 두 계정만 읽고 작성하며 변경·삭제할 수 없다', async () => {
  const y = environment.authenticatedContext('y').firestore();
  const s = environment.authenticatedContext('s').firestore();
  const outsider = environment.authenticatedContext('outsider').firestore();
  await assertSucceeds(setDoc(doc(y, auditPath('one')), audit('y')));
  await assertSucceeds(getDoc(doc(s, auditPath('one'))));
  await assertSucceeds(getDocs(collection(s, 'households/family/auditLogs')));
  await assertFails(updateDoc(doc(s, auditPath('one')), { summary: '변조' }));
  await assertFails(deleteDoc(doc(s, auditPath('one'))));
  await assertFails(setDoc(doc(s, auditPath('spoof')), audit('y')));
  await assertFails(getDoc(doc(outsider, auditPath('one'))));
});
test('두 승인 계정은 공동 배달 장부를 읽고 쓸 수 있고 외부 계정은 차단된다', async () => {
  const y = environment.authenticatedContext('y').firestore();
  const s = environment.authenticatedContext('s').firestore();
  const outsider = environment.authenticatedContext('outsider').firestore();
  await assertSucceeds(setDoc(doc(y, earningPath('one')), earning()));
  await assertSucceeds(getDoc(doc(y, earningPath('one'))));
  await assertSucceeds(getDoc(doc(s, earningPath('one'))));
  await assertSucceeds(setDoc(doc(s, earningPath('two')), earning()));
  await assertSucceeds(updateDoc(doc(s, earningPath('one')), { memo: '공동 수정', updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(outsider, earningPath('one'))));
  await assertFails(setDoc(doc(outsider, earningPath('outside')), earning()));
  await assertFails(deleteDoc(doc(outsider, earningPath('one'))));
});
test('금액, 소유자, 허용 목록 변경은 규칙에서 차단한다', async () => {
  const y = environment.authenticatedContext('y').firestore();
  await assertFails(setDoc(doc(y, path('bad')), { ...transaction(), amount: -1 }));
  await assertFails(setDoc(doc(y, path('bad-date')), { ...transaction(), date: '2026-02-30' }));
  await assertFails(setDoc(doc(y, earningPath('bad')), { ...earning(), settlementDeduction: 1100 }));
  await assertFails(updateDoc(doc(y, earningPath('one')), { ownerUid: 's' }));
  await assertFails(updateDoc(doc(y, path('one')), { createdAt: Timestamp.fromMillis(1) }));
  await assertSucceeds(updateDoc(doc(y, path('one')), { sortOrder: 10, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(y, path('bad-order')), { ...transaction(), sortOrder: -1 }));
  await assertFails(setDoc(doc(y, 'allowedUsers/new'), { householdId, deliveryEnabled: true }));
  assert.equal((await getDoc(doc(y, earningPath('one')))).exists(), true);
});
test('개인 설정은 본인만 변경한다', async () => {
  const y = environment.authenticatedContext('y').firestore();
  const s = environment.authenticatedContext('s').firestore();
  const setting = { ownerUid: 'y', displayName: '사용자', defaultPlatform: '쿠팡이츠', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(y, 'users/y/settings/app'), setting));
  await assertFails(getDoc(doc(s, 'users/y/settings/app')));
  await assertFails(setDoc(doc(s, 'users/y/settings/app'), setting));
});
test('구매일이 없는 초기 투자비도 두 승인 계정만 접근한다', async () => {
  const y = environment.authenticatedContext('y').firestore();
  const s = environment.authenticatedContext('s').firestore();
  const investment = { ownerUid: 'y', kind: 'investment', workDate: '', workMonth: '', amount: 500, category: '차량', memo: '시험', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(y, 'users/y/deliveryInvestments/initial'), investment));
  await assertSucceeds(getDoc(doc(s, 'users/y/deliveryInvestments/initial')));
  await assertSucceeds(updateDoc(doc(s, 'users/y/deliveryInvestments/initial'), { memo: '공동 수정', updatedAt: serverTimestamp() }));
});
test('한 승인 계정의 거래가 다른 계정의 실시간 구독에 반영된다', async () => {
  const y = environment.authenticatedContext('y').firestore();
  const s = environment.authenticatedContext('s').firestore();
  const received = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(Error('실시간 갱신 시간 초과')); }, 5000);
    const stop = onSnapshot(doc(s, path('realtime')), snap => {
      if (snap.exists()) { clearTimeout(timeout); stop(); resolve(snap.data().amount); }
    }, reject);
  });
  await assertSucceeds(setDoc(doc(y, path('realtime')), transaction()));
  assert.equal(await received, 100);
});
test.after(async () => environment.cleanup());
