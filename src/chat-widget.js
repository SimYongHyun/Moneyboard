import { answerQuestion } from './chatbot.js?v=20261105-4';

const suggestions = ['이번 달 지출', '이번 달 주유비', '미납 예정 금액', '쿠팡이츠 수익', '배민커넥트 수익', '투자금 회수율'];

export function mountChatbot(getContext) {
  const host = document.createElement('aside');
  host.id = 'moneyboard-chat';
  host.setAttribute('aria-label', '용비서');
  host.innerHTML = `<section class="mb-chat-panel" id="mb-chat-panel" role="region" aria-label="용비서 대화" hidden>
    <header class="mb-chat-head"><span class="mb-chat-head-icon" aria-hidden="true">▤</span><div><strong>용비서</strong><small>우리집 가계부 · 부업 수익 도우미</small></div><button type="button" class="mb-chat-close" aria-label="용비서 닫기">×</button></header>
    <div class="mb-chat-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
    <div class="mb-chat-suggestions" aria-label="추천 질문"></div>
    <form class="mb-chat-form"><label class="mb-chat-input-wrap"><span class="sr-only">질문 입력</span><textarea name="question" rows="1" maxlength="500" placeholder="궁금한 내용을 입력해 주세요."></textarea></label><button type="submit" class="mb-chat-send" aria-label="질문 전송">➤</button></form>
  </section><button type="button" class="mb-chat-fab" aria-label="용비서 열기" aria-expanded="false" aria-controls="mb-chat-panel"><svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 20l.9-4.5a9 9 0 0 1-.9-4A8.5 8.5 0 0 1 11.5 3 8.5 8.5 0 0 1 20 11.5Z"/><path d="M8 11.5h7"/></svg></button>`;
  document.body.append(host);
  const panel = host.querySelector('.mb-chat-panel'), fab = host.querySelector('.mb-chat-fab');
  const messages = host.querySelector('.mb-chat-messages'), form = host.querySelector('.mb-chat-form');
  const input = form.elements.question, send = host.querySelector('.mb-chat-send');
  const suggestionBox = host.querySelector('.mb-chat-suggestions');
  let busy = false;
  function append(role, message) {
    const row = document.createElement('div');
    row.className = `mb-chat-message ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'mb-chat-bubble';
    const parts = String(message).split(/(-?\d{1,3}(?:,\d{3})*원)/g);
    for (const part of parts) {
      if (/^-?\d{1,3}(?:,\d{3})*원$/.test(part)) { const strong = document.createElement('strong'); strong.textContent = part; bubble.append(strong); }
      else bubble.append(document.createTextNode(part));
    }
    row.append(bubble); messages.append(row);
    while (messages.children.length > 100) messages.firstElementChild.remove();
    messages.scrollTop = messages.scrollHeight;
  }
  append('assistant', '안녕하세요! 용비서입니다. 우리집 가계부와 부업 수익에 대해 질문해 주세요. 선택한 연·월을 기준으로도 답해 드립니다.');
  for (const prompt of suggestions) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = prompt;
    button.addEventListener('click', () => submitQuestion(prompt)); suggestionBox.append(button);
  }
  function open() { panel.hidden = false; fab.setAttribute('aria-expanded', 'true'); fab.setAttribute('aria-label', '용비서 닫기'); input.focus(); messages.scrollTop = messages.scrollHeight; }
  function close() { panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-label', '용비서 열기'); fab.focus(); }
  fab.addEventListener('click', () => panel.hidden ? open() : close());
  host.querySelector('.mb-chat-close').addEventListener('click', close);
  function submitQuestion(text) {
    const question = String(text || '').trim();
    if (!question || busy) return;
    busy = true; send.disabled = true; input.disabled = true;
    append('user', question); input.value = ''; suggestionBox.classList.add('compact');
    try {
      const response = answerQuestion(question, getContext()).text;
      append('assistant', response);
      if (response.includes('아직 해당 질문은 지원하지 않습니다.')) suggestionBox.classList.remove('compact');
    }
    catch (error) { console.error(error); append('assistant', '데이터를 분석하지 못했습니다. 연결 상태를 확인한 뒤 다시 질문해 주세요.'); }
    finally { busy = false; send.disabled = false; input.disabled = false; input.focus(); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); submitQuestion(input.value); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitQuestion(input.value); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 110)}px`; });
  function adjustViewport() {
    const viewport = window.visualViewport;
    const covered = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    host.style.setProperty('--mb-keyboard', `${covered}px`);
    host.style.setProperty('--mb-view-height', `${viewport?.height || window.innerHeight}px`);
  }
  adjustViewport(); window.visualViewport?.addEventListener('resize', adjustViewport); window.visualViewport?.addEventListener('scroll', adjustViewport);
  return { destroy() { window.visualViewport?.removeEventListener('resize', adjustViewport); window.visualViewport?.removeEventListener('scroll', adjustViewport); host.remove(); } };
}
