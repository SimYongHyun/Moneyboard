import { writeFileSync } from 'node:fs';

const names = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID'];
for (const name of names) if (!process.env[name]) throw Error(`CI 환경 변수 ${name} 값이 필요합니다.`);
const config = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  appId: process.env.FIREBASE_APP_ID
};
writeFileSync('public/firebase-config.js', `export const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`);
