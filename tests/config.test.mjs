import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Firebase CLI 배포 대상은 moneyboard-3fdf4로 고정된다', async () => {
  const [packageJson, firebaseRc] = await Promise.all([
    readFile('package.json', 'utf8').then(JSON.parse),
    readFile('.firebaserc', 'utf8').then(JSON.parse)
  ]);
  assert.equal(firebaseRc.projects.default, 'moneyboard-3fdf4');
  assert.match(packageJson.scripts['deploy:rules'], /--project moneyboard-3fdf4/);
  assert.match(packageJson.scripts['deploy:rules'], /--only firestore:rules,firestore:indexes/);
});
