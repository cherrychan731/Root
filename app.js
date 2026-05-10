let TEXTS = [];
let QUESTIONS = [];
let textsLoaded = false;
let questionsLoaded = false;
const loadedQuestionTextIds = new Set();
const questionLoadPromises = new Map();
let currentUser = null;
let currentProfile = null;
let currentRoundSaved = false;
let authBusy = false;

const supabaseClient = window.supabaseClient;
const MODE_QUESTION_COUNTS = { easy: 10, normal: 20, master: 25 };
const DSE_YEARS = ['26', '27', '28', '29', '30', '31', '32'];
const PRACTICE_MODES = [
  { id: 'easy', icon: '簡', label: '簡易', en: 'Easy', count: 10, sub: '10 題挑戰' },
  { id: 'normal', icon: '普', label: '普通', en: 'Normal', count: 20, sub: '20 題挑戰' },
  { id: 'master', icon: '師', label: '大師', en: 'Master', count: 25, sub: '25 題挑戰' },
  { id: 'hell', icon: '獄', label: '地獄', en: 'Hell', count: '全部', sub: '全部題目' },
];

const state = {
  user: null,
  selectedTextId: null,
  mode: null,
  queue: [],
  firstCorrect: 0,
  retries: 0,
  streak: 0,
  score: 0,
  baseScore: 0,
  streakBonus: 0,
  accBonus: 0,
  attempted: new Set(),
  currentQ: null,
  totalForRound: 0,
  lbTab: 'all',
  answersLog: [],
  prefs: { sound: true, notice: false },
  passwordRecovery: false,
};

const $ = (id) => document.getElementById(id);

function show(id) {
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
  $('screen-' + id)?.classList.add('active');
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

function showLoading(container, message = '載入中...') {
  if (container) container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function showEmpty(container, message) {
  if (container) container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function showError(container, message, error) {
  if (error) console.error(error);
  if (container) container.innerHTML = `<div class="empty-state error-state">${escapeHtml(message)}</div>`;
}

function setFieldError(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

function requireSupabase(errorId) {
  if (supabaseClient) return true;
  if (errorId) setFieldError(errorId, 'Supabase 設定未完成，請檢查 config.js。');
  else toast('Supabase 設定未完成');
  return false;
}

function friendlyAuthError(error) {
  const message = error?.message || String(error || '');
  if (/timed out/i.test(message)) return '連線太久沒有回應，請檢查網絡後再試。';
  if (/email not confirmed/i.test(message)) {
    return '此帳號仍需電郵確認。若要註冊後即時登入，請在 Supabase Auth 關閉 Confirm email。';
  }
  if (/invalid login credentials/i.test(message)) return '電郵或密碼不正確。';
  if (/rate limit|security purposes|after \d+ seconds/i.test(message)) return '嘗試太頻密，請稍等約 1 分鐘再試。';
  return message || '登入失敗，請稍後再試。';
}

function withTimeout(promise, ms, label = 'request') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]);
}

function userStateFromAuth(user) {
  const meta = user?.user_metadata || {};
  const fallbackName = meta.nickname || user?.email?.split('@')[0] || '同學';
  return {
    username: fallbackName,
    nickname: meta.nickname || fallbackName,
    fullName: meta.full_name || '',
    dseYear: meta.dse_year || '',
    email: user?.email || '',
  };
}

async function safeSetSignedInUser(user) {
  try {
    await withTimeout(setSignedInUser(user), 8000, 'profile load');
    return true;
  } catch (error) {
    console.error(error);
    currentUser = user;
    currentProfile = null;
    state.user = userStateFromAuth(user);
    return false;
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function modeLabel(mode) {
  return ({ easy: '簡易', normal: '普通', master: '大師', hell: '地獄' })[mode] || '普通';
}

function formatDseYear(year) {
  const value = String(year || '').trim();
  if (!value) return 'DSE —';
  return /dse/i.test(value) ? value.toUpperCase().replace(/\s+/g, ' ') : `${value} DSE`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function fmtDate(value) {
  return new Date(value).toLocaleDateString('zh-HK', { month: 'short', day: 'numeric' });
}

function pct(value) {
  return Number(value || 0).toFixed(1) + '%';
}

function updateScrollFade(scroller) {
  if (!scroller) return;
  const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
  scroller.classList.toggle('at-end', atEnd);
  scroller.classList.toggle('is-scrollable', scroller.scrollWidth > scroller.clientWidth + 4);
}

function bindHorizontalScroller(scroller) {
  if (!scroller) return;
  updateScrollFade(scroller);
  if (scroller.dataset.scrollFadeBound) return;
  scroller.dataset.scrollFadeBound = '1';
  scroller.addEventListener('scroll', () => updateScrollFade(scroller), { passive: true });
}

function bindDragScroller(scroller) {
  if (!scroller || scroller.dataset.dragScrollBound) return;
  scroller.dataset.dragScrollBound = '1';
  let isDown = false;
  let startX = 0;
  let startScroll = 0;
  scroller.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    isDown = true;
    startX = event.clientX;
    startScroll = scroller.scrollLeft;
    scroller.classList.add('is-dragging');
  });
  scroller.addEventListener('pointermove', (event) => {
    if (!isDown) return;
    scroller.scrollLeft = startScroll - (event.clientX - startX);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) => {
    scroller.addEventListener(name, () => {
      isDown = false;
      scroller.classList.remove('is-dragging');
    });
  });
}

function loadPrefs() {
  try {
    state.prefs = { ...state.prefs, ...(JSON.parse(localStorage.getItem('dsePrefs') || '{}')) };
  } catch {
    state.prefs = { sound: true, notice: false };
  }
}

function savePrefs() {
  localStorage.setItem('dsePrefs', JSON.stringify(state.prefs));
}

function applyPrefs() {
  $('swSound')?.classList.toggle('on', !!state.prefs.sound);
  $('swNotice')?.classList.toggle('on', !!state.prefs.notice);
}

function playTone(ok) {
  if (!state.prefs.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 740 : 220;
    gain.gain.value = 0.035;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // Audio is optional.
  }
}

function initYearPicker() {
  const wrap = $('regYearPicker');
  if (!wrap || wrap.dataset.ready) return;
  wrap.dataset.ready = '1';
  const defaultYear = '30';
  wrap.innerHTML = DSE_YEARS.map((y) => `<div class="year-chip ${y === defaultYear ? 'selected' : ''}" data-yr="${y}">${y}<span class="yc-suf">DSE</span></div>`).join('');
  if ($('regDseYear')) $('regDseYear').value = defaultYear;
  bindDragScroller(wrap);
  wrap.querySelectorAll('.year-chip').forEach((el) => el.addEventListener('click', () => {
    wrap.querySelectorAll('.year-chip').forEach((x) => x.classList.remove('selected'));
    el.classList.add('selected');
    if ($('regDseYear')) $('regDseYear').value = el.dataset.yr;
  }));
}

function initSettingsYears() {
  const select = $('setYearSelect');
  if (!select || select.dataset.ready) return;
  select.dataset.ready = '1';
  let html = '';
  DSE_YEARS.forEach((value) => {
    html += `<option value="${value}">${value} DSE</option>`;
  });
  select.innerHTML = html;
}

function ensureForgotPasswordLink() {
  if ($('btnForgotPassword')) return;
  const loginForm = $('form-login');
  const loginButton = $('btnLogin');
  if (!loginForm || !loginButton) return;
  loginButton.insertAdjacentHTML('afterend', '<button id="btnForgotPassword" class="btn-ghost text-sm w-full" style="background:none;border:none;cursor:pointer;color:var(--muted);text-decoration:underline;text-underline-offset:4px;">忘記密碼？</button><div id="resetNotice" class="auth-note hidden"></div>');
}

function ensurePasswordRecoveryForm() {
  if ($('form-recovery')) return;
  const registerForm = $('form-register');
  if (!registerForm) return;
  registerForm.insertAdjacentHTML('afterend', `
    <div id="form-recovery" class="space-y-4 hidden">
      <div>
        <div class="label mb-2">新密碼</div>
        <input id="newPassword" class="input" type="password" placeholder="至少 6 個字" />
      </div>
      <div>
        <div class="label mb-2">確認新密碼</div>
        <input id="newPasswordConfirm" class="input" type="password" placeholder="再次輸入新密碼" />
      </div>
      <div id="recoveryError" class="text-xs hidden" style="color:var(--red-soft);"></div>
      <button id="btnUpdatePassword" class="btn btn-primary w-full mt-2">更新密碼</button>
      <button id="btnBackToLogin" class="btn-ghost text-sm w-full" style="background:none;border:none;cursor:pointer;color:var(--muted);text-decoration:underline;text-underline-offset:4px;">返回登入</button>
    </div>`);
}

function showAuthPanel(which) {
  document.querySelectorAll('[data-auth-tab]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.authTab === which);
  });
  $('form-login')?.classList.toggle('hidden', which !== 'login');
  $('form-register')?.classList.toggle('hidden', which !== 'register');
  $('form-recovery')?.classList.toggle('hidden', which !== 'recovery');
  const tabs = document.querySelector('[data-auth-tab]')?.parentElement;
  if (tabs) tabs.classList.toggle('hidden', which === 'recovery');
  if (which !== 'login') setFieldError('loginError', '');
  if (which !== 'register') setFieldError('regError', '');
}

async function initSession() {
  if (!supabaseClient) {
    show('auth');
    return;
  }
  prefetchPracticeData();
  const isRecoveryUrl = window.location.hash.includes('type=recovery') || window.location.search.includes('type=recovery');
  try {
    const { data, error } = await withTimeout(supabaseClient.auth.getSession(), 8000, 'session load');
    if (error) throw error;
    const sessionUser = data?.session?.user || null;
    if (sessionUser) {
      currentUser = sessionUser;
      state.user = userStateFromAuth(sessionUser);
      safeSetSignedInUser(sessionUser).then((profileReady) => {
        if (!profileReady) toast('帳號資料稍後再載入');
        if (profileReady && $('screen-home')?.classList.contains('active')) enterHome();
      });
      if (isRecoveryUrl) {
        state.passwordRecovery = true;
        show('auth');
        showAuthPanel('recovery');
      } else {
        show('home');
      }
    } else {
      if (!authBusy) show('auth');
    }
  } catch (error) {
    console.error(error);
    setFieldError('loginError', friendlyAuthError(error));
    if (!authBusy) show('auth');
  }
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (authBusy && event === 'SIGNED_IN') return;
    if (event === 'PASSWORD_RECOVERY') {
      state.passwordRecovery = true;
      if (session?.user) await safeSetSignedInUser(session.user);
      show('auth');
      showAuthPanel('recovery');
      return;
    }
    if (session?.user) {
      currentUser = session.user;
      state.user = state.user || userStateFromAuth(session.user);
      safeSetSignedInUser(session.user).then((profileReady) => {
        if (profileReady && $('screen-home')?.classList.contains('active')) enterHome();
      });
    }
    else {
      currentUser = null;
      currentProfile = null;
      state.user = null;
    }
  });
}

async function setSignedInUser(user) {
  currentUser = user;
  let { data: profile, error } = await supabaseClient
    .from('dse_profiles')
    .select('username,nickname,full_name,dse_year')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) console.error(error);

  const meta = user.user_metadata || {};
  if (!profile) {
    const fallbackName = meta.nickname || user.email?.split('@')[0] || '同學';
    const { error: upsertError } = await supabaseClient.from('dse_profiles').upsert({
      user_id: user.id,
      username: fallbackName,
      nickname: meta.nickname || fallbackName,
      full_name: meta.full_name || null,
      dse_year: meta.dse_year || null,
      updated_at: new Date().toISOString(),
    });
    if (!upsertError) {
      const refetched = await supabaseClient
        .from('dse_profiles')
        .select('username,nickname,full_name,dse_year')
        .eq('user_id', user.id)
        .maybeSingle();
      profile = refetched.data || null;
    }
  }

  currentProfile = profile || null;
  state.user = {
    username: profile?.nickname || profile?.username || user.email?.split('@')[0] || '同學',
    nickname: profile?.nickname || profile?.username || '',
    fullName: profile?.full_name || '',
    dseYear: profile?.dse_year || '',
    email: user.email || '',
  };
  await refreshHomeStats();
}

async function upsertProfile(nickname, fullName, dseYear) {
  if (!supabaseClient || !currentUser) return;
  const { error } = await supabaseClient.from('dse_profiles').upsert({
    user_id: currentUser.id,
    username: nickname,
    nickname: nickname || null,
    full_name: fullName || null,
    dse_year: dseYear || null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function refreshHomeStats() {
  const recent = $('recentActivity');
  if (!currentUser || !supabaseClient) {
    if ($('statPlays')) $('statPlays').textContent = '0';
    if ($('statAcc')) $('statAcc').textContent = '0.0%';
    if ($('statTop')) $('statTop').textContent = '0';
    showEmpty(recent, '登入後會儲存練習紀錄。');
    return;
  }

  const { data, error } = await supabaseClient
    .from('dse_practice_rounds')
    .select('text_title,difficulty,accuracy,score,created_at')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    showError(recent, '近期戰績載入失敗。', error);
    return;
  }

  const rows = data || [];
  if ($('statPlays')) $('statPlays').textContent = rows.length;
  if ($('statAcc')) $('statAcc').textContent = rows.length ? pct(rows.reduce((sum, row) => sum + Number(row.accuracy || 0), 0) / rows.length) : '0.0%';
  if ($('statTop')) $('statTop').textContent = rows.length ? Math.max(...rows.map((row) => Number(row.score || 0))).toLocaleString() : '0';

  if (!recent) return;
  if (rows.length === 0) {
    showEmpty(recent, '完成練習後會在這裡顯示記錄。');
    return;
  }
  recent.innerHTML = rows.slice(0, 3).map((row) => `
    <div class="activity-row-loose">
      <div class="flex items-center gap-3 min-w-0">
        <span class="diff-pill diff-pill-${row.difficulty}">${modeLabel(row.difficulty)}</span>
        <span class="serif truncate" style="font-size:15px;font-weight:500;">${escapeHtml(row.text_title || '全部篇章')}</span>
      </div>
      <div class="flex items-center gap-5 text-sm" style="color:var(--muted);">
        <span class="serif" style="color:var(--charcoal);">${pct(row.accuracy)}</span>
        <span class="serif" style="color:var(--charcoal);">${Number(row.score || 0).toLocaleString()}</span>
      </div>
    </div>
  `).join('');
}

async function loadTextsFromSupabase() {
  if (textsLoaded) return;
  if (!supabaseClient) throw new Error('Supabase client not available');
  const { data: texts, error: textError } = await supabaseClient
    .from('dse_texts')
    .select('text_code,title,author,short_author')
    .eq('active', true)
    .order('text_code', { ascending: true });
  if (textError) throw textError;

  TEXTS = (texts || []).map((text, index) => ({
    id: text.text_code,
    num: String(index + 1).padStart(2, '0'),
    title: text.title,
    author: text.author || '',
    shortAuthor: text.short_author || text.author || '',
  }));
  textsLoaded = true;
}

function normaliseQuestion(question) {
  return {
    id: question.question_code,
    text_id: question.text_code,
    question: question.question,
    a: question.option_a,
    b: question.option_b,
    c: question.option_c,
    d: question.option_d,
    answer: question.option_a,
    correctText: question.option_a,
    explain: question.explanation,
    dse_year: question.dse_year,
    name_tag: question.name_tag,
    questionDifficulty: question.difficulty || 'normal',
    skill: question.skill || '未分類',
  };
}

function mergeQuestions(questions) {
  const byId = new Map(QUESTIONS.map((question) => [question.id, question]));
  (questions || []).forEach((question) => {
    const normalised = normaliseQuestion(question);
    byId.set(normalised.id, normalised);
  });
  QUESTIONS = [...byId.values()];
}

async function loadQuestionsFromSupabase(textId = null) {
  const loadAll = textId === null || textId === 0;
  if (loadAll && questionsLoaded) return;
  if (!loadAll && (questionsLoaded || loadedQuestionTextIds.has(textId))) return;
  if (!supabaseClient) throw new Error('Supabase client not available');
  const cacheKey = loadAll ? '__all__' : String(textId);
  if (questionLoadPromises.has(cacheKey)) return questionLoadPromises.get(cacheKey);

  let query = supabaseClient
    .from('dse_questions')
    .select('question_code,text_code,question,option_a,option_b,option_c,option_d,explanation,dse_year,name_tag,skill,difficulty')
    .eq('active', true);
  if (!loadAll) query = query.eq('text_code', textId);

  const loadPromise = query
    .then(({ data: questions, error: questionError }) => {
      if (questionError) throw questionError;
      mergeQuestions(questions || []);
      if (loadAll) {
        questionsLoaded = true;
        (questions || []).forEach((question) => loadedQuestionTextIds.add(question.text_code));
      } else {
        loadedQuestionTextIds.add(textId);
      }
    })
    .finally(() => {
      questionLoadPromises.delete(cacheKey);
    });
  questionLoadPromises.set(cacheKey, loadPromise);
  return loadPromise;
}

function prefetchTexts() {
  if (!supabaseClient || textsLoaded) return;
  loadTextsFromSupabase().catch((error) => console.error(error));
}

function prefetchPracticeData() {
  prefetchTexts();
}

function updateQuestionCountLabel() {
  const count = $('questionCountLabel');
  if (!count) return;
  count.textContent = questionsLoaded ? `${TEXTS.length} 篇 · ${QUESTIONS.length} 題` : `${TEXTS.length} 篇 · 選擇後載入題目`;
}

function selectedQuestionTextId() {
  return state.selectedTextId === 0 ? null : state.selectedTextId;
}

async function ensureSelectedQuestionsLoaded() {
  await loadQuestionsFromSupabase(selectedQuestionTextId());
}

function bindNavigation() {
  document.querySelectorAll('[data-back]').forEach((el) => el.addEventListener('click', () => show(el.dataset.back)));
  document.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => {
    const target = el.dataset.go;
    if (target === 'texts') return renderTexts();
    if (target === 'leaderboard') return renderLeaderboard();
    if (target === 'history') return renderHistory();
    if (target === 'settings') {
      renderSettings();
      return show('settings');
    }
    return show(target);
  }));
}

function bindAuth() {
  document.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
    showAuthPanel(tab.dataset.authTab);
  }));

  $('btnLogin')?.addEventListener('click', async () => {
    if (!requireSupabase('loginError')) return;
    if (authBusy) return;
    const email = $('loginEmail')?.value.trim() || '';
    const password = $('loginPassword')?.value || '';
    if (!email || !password) {
      setFieldError('loginError', '請輸入電郵和密碼');
      return;
    }
    const button = $('btnLogin');
    authBusy = true;
    if (button) {
      button.disabled = true;
      button.textContent = '登入中...';
    }
    try {
      const { data, error } = await withTimeout(
        supabaseClient.auth.signInWithPassword({ email, password }),
        12000,
        'login'
      );
      if (error) {
        setFieldError('loginError', friendlyAuthError(error));
        return;
      }
      setFieldError('loginError', '');
      currentUser = data.user;
      state.user = userStateFromAuth(data.user);
      enterHome();
      safeSetSignedInUser(data.user).then((profileReady) => {
        if (!profileReady) toast('帳號資料稍後再載入');
        if (profileReady && $('screen-home')?.classList.contains('active')) enterHome();
      });
    } catch (error) {
      console.error(error);
      setFieldError('loginError', friendlyAuthError(error));
    } finally {
      authBusy = false;
      if (button) {
        button.disabled = false;
        button.textContent = '登入';
      }
    }
  });

  $('btnRegister')?.addEventListener('click', async () => {
    if (!requireSupabase('regError')) return;
    if (authBusy) return;
    const nickname = $('regNickname')?.value.trim() || '';
    const fullName = $('regFullName')?.value.trim() || '';
    const dseYear = $('regDseYear')?.value.trim() || '';
    const email = $('regEmail')?.value.trim() || '';
    const password = $('regPassword')?.value || '';
    if (!nickname) {
      setFieldError('regError', '請輸入顯示用昵稱');
      return;
    }
    if (!/^[\u4e00-\u9fff]{2,4}$/.test(fullName)) {
      setFieldError('regError', '請輸入 2 至 4 個中文字的中文全名');
      return;
    }
    if (!email || password.length < 6) {
      setFieldError('regError', '請輸入電郵，密碼最少 6 個字');
      return;
    }
    const button = $('btnRegister');
    authBusy = true;
    if (button) {
      button.disabled = true;
      button.textContent = '建立中...';
    }
    try {
      const { data, error } = await withTimeout(
        supabaseClient.auth.signUp({
          email,
          password,
          options: { data: { nickname, full_name: fullName, dse_year: dseYear } },
        }),
        12000,
        'signup'
      );
      if (error) {
        setFieldError('regError', friendlyAuthError(error));
        return;
      }
      setFieldError('regError', '');
      if (data.user && data.session) {
        currentUser = data.user;
        state.user = { username: nickname, nickname, fullName, dseYear, email };
        enterHome();
        safeSetSignedInUser(data.user).then(() => upsertProfile(nickname, fullName, dseYear).catch((profileError) => console.error(profileError)));
        return;
      }
      const loginResult = await withTimeout(
        supabaseClient.auth.signInWithPassword({ email, password }),
        12000,
        'login'
      );
      if (loginResult.error) {
        setFieldError('regError', friendlyAuthError(loginResult.error));
        return;
      }
      if (loginResult.data?.user) {
        currentUser = loginResult.data.user;
        state.user = { username: nickname, nickname, fullName, dseYear, email };
        enterHome();
        safeSetSignedInUser(loginResult.data.user).then(() => upsertProfile(nickname, fullName, dseYear).catch((profileError) => console.error(profileError)));
        return;
      }
      setFieldError('regError', '帳號已建立，但暫時未能自動登入。請稍後再試。');
    } catch (error) {
      console.error(error);
      setFieldError('regError', friendlyAuthError(error));
    } finally {
      authBusy = false;
      if (button) {
        button.disabled = false;
        button.textContent = '建立帳號';
      }
    }
  });

  $('btnGuest')?.addEventListener('click', () => {
    currentUser = null;
    currentProfile = null;
    state.user = null;
    enterHome();
  });
  $('btnForgotPassword')?.addEventListener('click', resetPassword);
  $('btnUpdatePassword')?.addEventListener('click', updateRecoveredPassword);
  $('btnBackToLogin')?.addEventListener('click', async () => {
    state.passwordRecovery = false;
    if (supabaseClient) await supabaseClient.auth.signOut();
    showAuthPanel('login');
  });
  $('btnLogout')?.addEventListener('click', signOut);
  $('setLogout')?.addEventListener('click', signOut);
}

async function resetPassword() {
  if (!requireSupabase('loginError')) return;
  const email = $('loginEmail')?.value.trim() || '';
  if (!email) {
    setFieldError('loginError', '請先輸入電郵地址');
    return;
  }
  setFieldError('loginError', '');
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href.split('#')[0],
  });
  if (error) {
    setFieldError('loginError', '暫時未能寄出重設電郵，請稍後再試。');
    console.error(error);
    return;
  }
  const notice = $('resetNotice');
  if (notice) {
    notice.textContent = '如這個電郵已註冊，重設密碼連結會寄到該信箱。';
    notice.classList.remove('hidden');
  }
  toast('請檢查電郵信箱');
}

async function updateRecoveredPassword() {
  if (!requireSupabase('recoveryError')) return;
  const password = $('newPassword')?.value || '';
  const confirm = $('newPasswordConfirm')?.value || '';
  if (password.length < 6) {
    setFieldError('recoveryError', '新密碼最少 6 個字');
    return;
  }
  if (password !== confirm) {
    setFieldError('recoveryError', '兩次輸入的新密碼不一致');
    return;
  }
  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) {
    setFieldError('recoveryError', '密碼更新失敗，請重新開啟重設連結。');
    console.error(error);
    return;
  }
  state.passwordRecovery = false;
  setFieldError('recoveryError', '');
  await supabaseClient.auth.signOut();
  showAuthPanel('login');
  toast('密碼已更新，請重新登入');
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser = null;
  currentProfile = null;
  state.user = null;
  show('auth');
}

async function enterHome() {
  if ($('homeUsername')) $('homeUsername').textContent = state.user ? state.user.username : '訪客';
  $('guestBanner')?.classList.toggle('hidden', !!state.user);
  prefetchPracticeData();
  show('home');
  refreshHomeStats().catch((error) => {
    console.error(error);
    showError($('recentActivity'), '近期戰績載入失敗。', error);
  });
}

async function renderTexts() {
  const wrap = $('textList');
  if (!wrap) return;
  showLoading(wrap, '載入篇章中...');
  show('texts');
  try {
    await loadTextsFromSupabase();
  } catch (error) {
    showError(wrap, '篇章載入失敗，請稍後再試。', error);
    toast('篇章載入失敗');
    return;
  }
  state.selectedTextId = null;
  if ($('btnTextNext')) $('btnTextNext').disabled = true;
  if (TEXTS.length === 0) {
    showEmpty(wrap, '暫時未有可用篇章。');
    return;
  }

  const allCard = `
    <div class="text-card" data-text-id="0">
      <span class="serif num-glyph" style="font-size:28px;color:var(--gold);width:54px;text-align:center;font-weight:600;">全</span>
      <div class="flex-1 min-w-0">
        <div class="serif" style="font-size:16px;font-weight:600;">全部篇章</div>
        <div id="questionCountLabel" class="text-xs mt-0.5" style="color:var(--muted);">${TEXTS.length} 篇 · ${questionsLoaded ? QUESTIONS.length + ' 題' : '選擇後載入題目'}</div>
      </div>
      <span class="pill pill-gold">混合</span>
    </div>`;
  const cards = TEXTS.map((text) => `
    <div class="text-card" data-text-id="${escapeHtml(text.id)}">
      <span class="serif num-glyph" style="font-size:28px;color:#C8BFB0;width:54px;text-align:center;font-weight:500;">${text.num}</span>
      <div class="flex-1 min-w-0">
        <div class="serif truncate" style="font-size:16px;font-weight:600;">${escapeHtml(text.title)}</div>
      </div>
    </div>`).join('');
  wrap.innerHTML = allCard + cards;
  wrap.querySelectorAll('.text-card').forEach((card) => card.addEventListener('click', () => {
    wrap.querySelectorAll('.text-card').forEach((item) => item.classList.remove('selected', 'all-selected'));
    const rawId = card.dataset.textId;
    state.selectedTextId = rawId === '0' ? 0 : rawId;
    card.classList.add(state.selectedTextId === 0 ? 'all-selected' : 'selected');
    if ($('btnTextNext')) $('btnTextNext').disabled = false;
  }));
}

async function renderDifficulty() {
  const wrap = $('diffList');
  if (!wrap) return;
  showLoading(wrap, '載入題數中...');
  show('difficulty');
  try {
    await ensureSelectedQuestionsLoaded();
  } catch (error) {
    showError(wrap, '題數載入失敗，請稍後再試。', error);
    return;
  }
  const selected = state.selectedTextId === 0 ? { num: '全', title: '全部篇章' } : TEXTS.find((text) => text.id === state.selectedTextId);
  if ($('diffSelectedTag')) $('diffSelectedTag').textContent = selected ? ((selected.num !== '全' ? selected.num + ' · ' : '') + selected.title) : '—';
  const base = state.selectedTextId === 0 ? QUESTIONS : QUESTIONS.filter((question) => question.text_id === state.selectedTextId);
  const unique = [...new Map(base.map((question) => [question.id, question])).values()];
  const counts = PRACTICE_MODES.reduce((acc, mode) => {
    const requested = mode.id === 'hell' ? unique.length : MODE_QUESTION_COUNTS[mode.id] || 10;
    acc[mode.id] = Math.min(requested, unique.length);
    return acc;
  }, {});
  wrap.innerHTML = PRACTICE_MODES.map((mode) => `
    <div class="diff-card ${counts[mode.id] ? '' : 'disabled'}" data-mode="${mode.id}">
      <span class="serif" style="width:48px;height:48px;border-radius:50%;background:var(--cream);display:inline-flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;color:var(--sage-dark);">${mode.icon}</span>
      <div class="flex-1">
        <div class="serif" style="font-size:18px;font-weight:600;">${mode.label}</div>
        <div class="text-xs mt-0.5" style="color:var(--muted);letter-spacing:.05em;">${mode.en} · ${counts[mode.id] ? `抽 ${counts[mode.id]} 題` : '暫無題目'}</div>
      </div>
      <span class="diff-check hidden check">✓</span>
    </div>`).join('');
  state.mode = null;
  if ($('btnGoConfirm')) $('btnGoConfirm').disabled = true;
  wrap.querySelectorAll('.diff-card').forEach((card) => card.addEventListener('click', () => {
    if (card.classList.contains('disabled')) return;
    wrap.querySelectorAll('.diff-card').forEach((item) => {
      item.classList.remove('selected');
      item.querySelector('.diff-check')?.classList.add('hidden');
    });
    card.classList.add('selected');
    card.querySelector('.diff-check')?.classList.remove('hidden');
    state.mode = card.dataset.mode;
    if ($('btnGoConfirm')) $('btnGoConfirm').disabled = false;
  }));
}

function availableQuestionPool() {
  const base = state.selectedTextId === 0 ? QUESTIONS : QUESTIONS.filter((question) => question.text_id === state.selectedTextId);
  const unique = new Map();
  base.forEach((question) => {
    if (!unique.has(question.id)) unique.set(question.id, question);
  });
  const pool = [...unique.values()];
  return pool;
}

async function renderConfirm() {
  const selected = state.selectedTextId === 0 ? { title: '全部篇章' } : TEXTS.find((text) => text.id === state.selectedTextId);
  if ($('confTextName')) $('confTextName').textContent = selected?.title || '—';
  const pill = $('confDiffPill');
  if (pill) {
    pill.className = 'diff-pill diff-pill-' + state.mode;
    pill.textContent = modeLabel(state.mode);
  }
  if ($('confQCount')) $('confQCount').textContent = '載入題庫中...';
  if ($('btnStartGame')) $('btnStartGame').disabled = true;
  show('confirm');
  try {
    await ensureSelectedQuestionsLoaded();
  } catch (error) {
    console.error(error);
    if ($('confQCount')) $('confQCount').textContent = '題庫載入失敗';
    toast('題庫載入失敗');
    return;
  }
  const pool = availableQuestionPool();
  const requested = state.mode === 'hell' ? pool.length : MODE_QUESTION_COUNTS[state.mode] || 10;
  const actual = Math.min(requested, pool.length);
  if ($('confQCount')) {
    $('confQCount').textContent = actual > 0 ? actual + ' 題' : '此篇章暫時未有題目';
    if (actual > 0 && actual < requested) $('confQCount').textContent += `（此篇章目前只有 ${actual} 題）`;
  }
  if ($('btnStartGame')) $('btnStartGame').disabled = actual === 0;
}

function pickQuestions() {
  const pool = availableQuestionPool();
  if (pool.length === 0) return [];
  shuffle(pool);
  const count = state.mode === 'hell' ? pool.length : Math.min(MODE_QUESTION_COUNTS[state.mode] || 10, pool.length);
  return pool.slice(0, count).map((question, index) => ({ ...question, roundId: `${question.id}_${index}_${Date.now()}` }));
}

async function startGame() {
  if ($('btnStartGame')) $('btnStartGame').disabled = true;
  try {
    await ensureSelectedQuestionsLoaded();
  } catch (error) {
    console.error(error);
    toast('題庫載入失敗');
    if ($('btnStartGame')) $('btnStartGame').disabled = false;
    return;
  }
  const qs = pickQuestions();
  if (qs.length === 0) {
    toast('此篇章暫時未有題目');
    return;
  }
  currentRoundSaved = false;
  state.queue = qs;
  state.totalForRound = qs.length;
  state.firstCorrect = 0;
  state.retries = 0;
  state.streak = 0;
  state.score = 0;
  state.baseScore = 0;
  state.streakBonus = 0;
  state.accBonus = 0;
  state.attempted = new Set();
  state.answersLog = [];
  const selected = state.selectedTextId === 0 ? { title: '全部篇章' } : TEXTS.find((text) => text.id === state.selectedTextId);
  if ($('gameTextName')) $('gameTextName').textContent = selected?.title || '—';
  if ($('gameDiffPill')) $('gameDiffPill').textContent = modeLabel(state.mode);
  if ($('gameQTotal')) $('gameQTotal').textContent = state.totalForRound;
  show('game');
  nextQuestion();
}

function nextQuestion() {
  if (state.queue.length === 0) {
    finishGame();
    return;
  }
  const q = state.queue.shift();
  state.currentQ = q;
  const firstTime = !state.attempted.has(q.roundId);
  $('qRetryBadge')?.classList.toggle('hidden', firstTime);
  if ($('gameQNum')) $('gameQNum').textContent = Math.min(state.attempted.size + 1, state.totalForRound);
  if ($('gameProgress')) $('gameProgress').style.width = (state.attempted.size / state.totalForRound * 100) + '%';
  updateAccScore();
  const tags = $('qTags');
  if (tags) {
    tags.innerHTML = '';
    if (q.dse_year) tags.insertAdjacentHTML('beforeend', `<span class="pill pill-gold">${q.dse_year} DSE</span>`);
  }
  if ($('qText')) $('qText').textContent = q.question;
  const opts = $('qOptions');
  if (opts) {
    const optionRows = shuffle(['a', 'b', 'c', 'd'].map((key) => q[key]).filter(Boolean));
    opts.innerHTML = '';
    q.correctLetter = '';
    optionRows.forEach((text, index) => {
      const letter = ['A', 'B', 'C', 'D'][index];
      if (text === (q.correctText || q.answer)) q.correctLetter = letter;
      const button = document.createElement('button');
      button.className = 'opt-btn';
      button.dataset.answer = text;
      button.dataset.letter = letter;
      button.innerHTML = `<span class="opt-letter">${letter}</span><span class="opt-text"></span>`;
      button.querySelector('.opt-text').textContent = text;
      button.addEventListener('click', () => answer(text));
      opts.appendChild(button);
    });
  }
  $('qExplain')?.classList.add('hidden');
}

function updateAccScore() {
  const attempts = state.attempted.size;
  const acc = attempts > 0 ? (state.firstCorrect / attempts * 100) : 0;
  if ($('gameAcc')) $('gameAcc').textContent = acc.toFixed(1) + '%';
  if ($('gameScore')) $('gameScore').textContent = state.score;
  const streakWrap = $('gameStreakWrap');
  if (streakWrap) {
    streakWrap.classList.toggle('hidden', state.streak <= 0);
    if ($('gameStreak')) $('gameStreak').textContent = state.streak;
  }
}

function answer(selectedAnswer) {
  const q = state.currentQ;
  const correctAnswer = q.correctText || q.answer;
  const correct = selectedAnswer === correctAnswer;
  playTone(correct);
  const opts = $('qOptions');
  opts?.querySelectorAll('.opt-btn').forEach((button) => {
    button.disabled = true;
    if (button.dataset.answer === correctAnswer) button.classList.add('correct');
    else if (button.dataset.answer === selectedAnswer && !correct) button.classList.add('wrong');
    else button.classList.add('faded');
  });
  const firstAttempt = !state.attempted.has(q.roundId);
  if (firstAttempt) state.attempted.add(q.roundId);
  state.answersLog.push({
    question_code: q.id,
    text_code: q.text_id,
    text_title: (TEXTS.find((text) => text.id === q.text_id)?.title) || '全部篇章',
    difficulty: state.mode,
    skill: q.skill || '未分類',
    selected_answer: selectedAnswer,
    correct_answer: correctAnswer,
    is_correct: correct,
    attempt_number: state.answersLog.filter((item) => item.question_code === q.id).length + 1,
  });
  if (correct) {
    if (firstAttempt) {
      state.firstCorrect += 1;
      state.baseScore += 10;
      state.streak += 1;
      state.streakBonus += state.streak * 2;
      state.score = state.baseScore + state.streakBonus + state.accBonus;
    }
  } else {
    state.streak = 0;
    state.retries += 1;
    toast('答錯了，請看解析後繼續');
  }
  if ($('qCorrectLetter')) $('qCorrectLetter').textContent = q.correctLetter || '';
  if ($('qExplainText')) $('qExplainText').textContent = q.explain || '請查看上方標示的正確選項。';
  $('qExplain')?.classList.remove('hidden');
  updateAccScore();
}

async function finishGame() {
  const acc = state.totalForRound > 0 ? (state.firstCorrect / state.totalForRound * 100) : 0;
  let bonus = 0;
  if (acc >= 100) bonus = 300;
  else if (acc >= 90) bonus = 150;
  else if (acc >= 80) bonus = 50;
  state.accBonus = bonus;
  state.score = state.baseScore + state.streakBonus + state.accBonus;
  if ($('resAcc')) $('resAcc').textContent = acc.toFixed(1);
  if ($('resBase')) $('resBase').textContent = state.baseScore;
  if ($('resStreak')) $('resStreak').textContent = state.streakBonus;
  if ($('resAccBonus')) $('resAccBonus').textContent = state.accBonus;
  if ($('resTotal')) $('resTotal').textContent = state.score;
  if ($('resTotalQ')) $('resTotalQ').textContent = state.totalForRound;
  if ($('resFirst')) $('resFirst').textContent = state.firstCorrect;
  if ($('resRetry')) $('resRetry').textContent = state.retries;
  if ($('resLabel')) $('resLabel').textContent = acc >= 90 ? '做得好' : '繼續練習';
  show('result');
  await saveRound(acc);
}

async function saveRound(acc) {
  if (currentRoundSaved || !currentUser || !supabaseClient) return;
  currentRoundSaved = true;
  const selected = state.selectedTextId === 0 ? { id: null, title: '全部篇章' } : TEXTS.find((text) => text.id === state.selectedTextId);
  const { data, error } = await supabaseClient.from('dse_practice_rounds').insert({
    user_id: currentUser.id,
    text_code: selected?.id || null,
    text_title: selected?.title || '全部篇章',
    difficulty: state.mode,
    total_questions: state.totalForRound,
    first_correct: state.firstCorrect,
    retries: state.retries,
    score: state.score,
    accuracy: Number(acc.toFixed(2)),
  }).select('id').single();
  if (error) {
    toast('紀錄儲存失敗，請檢查網絡後再試。');
    console.error(error);
    return;
  }
  if (state.answersLog.length) {
    const rows = state.answersLog.map((answerRow) => ({ ...answerRow, round_id: data.id, user_id: currentUser.id }));
    const answerResult = await supabaseClient.from('dse_practice_answers').insert(rows);
    if (answerResult.error) {
      console.error(answerResult.error);
      toast('答題細節儲存失敗，但總成績已保存。');
    }
  }
  await refreshHomeStats();
}

function renderSettings() {
  initSettingsYears();
  applyPrefs();
  if (!state.user) {
    if ($('setNickInput')) $('setNickInput').value = '';
    if ($('setFullInput')) $('setFullInput').value = '';
    if ($('setYearSelect')) $('setYearSelect').value = '29';
    if ($('setEmail')) $('setEmail').textContent = '未登入';
    document.querySelectorAll('#screen-settings .settings-form input, #screen-settings .settings-form select, #btnSaveSettings').forEach((el) => {
      el.disabled = true;
    });
    setFieldError('setError', '請先登入，才可修改帳號資料。');
    return;
  }
  document.querySelectorAll('#screen-settings .settings-form input, #screen-settings .settings-form select, #btnSaveSettings').forEach((el) => {
    el.disabled = false;
  });
  setFieldError('setError', '');
  if ($('setNickInput')) $('setNickInput').value = state.user.nickname || state.user.username || '';
  if ($('setFullInput')) $('setFullInput').value = state.user.fullName || '';
  if ($('setYearSelect')) $('setYearSelect').value = state.user.dseYear || '29';
  if ($('setEmail')) $('setEmail').textContent = state.user.email || '未登入';
}

async function saveSettings() {
  if (!currentUser) {
    toast('請先登入');
    return;
  }
  const nickname = $('setNickInput')?.value.trim() || '';
  const fullName = $('setFullInput')?.value.trim() || '';
  const dseYear = $('setYearSelect')?.value || '';
  if (!nickname) {
    setFieldError('setError', '請輸入顯示用昵稱');
    return;
  }
  if (!/^[\u4e00-\u9fff]{2,4}$/.test(fullName)) {
    setFieldError('setError', '請輸入 2 至 4 個中文字的中文全名');
    return;
  }
  try {
    await upsertProfile(nickname, fullName, dseYear);
    state.user = { ...state.user, username: nickname, nickname, fullName, dseYear };
    currentProfile = { ...(currentProfile || {}), username: nickname, nickname, full_name: fullName, dse_year: dseYear };
    if ($('homeUsername')) $('homeUsername').textContent = nickname;
    setFieldError('setError', '');
    toast('設定已儲存');
  } catch (error) {
    console.error(error);
    setFieldError('setError', '設定儲存失敗');
  }
}

async function renderLeaderboard() {
  show('leaderboard');
  const tabs = $('lbTabs');
  const list = $('lbList');
  if (!list) return;
  const tabDefs = [{ id: 'all', label: '全部' }, ...PRACTICE_MODES.map((mode) => ({ id: mode.id, label: mode.label }))];
  if (tabs) {
    tabs.innerHTML = tabDefs.map((tab) => `<div class="tab ${state.lbTab === tab.id ? 'active' : ''}" data-lb-tab="${tab.id}">${tab.label}</div>`).join('');
    tabs.querySelectorAll('[data-lb-tab]').forEach((tab) => tab.addEventListener('click', () => {
      state.lbTab = tab.dataset.lbTab;
      renderLeaderboard();
    }));
    const scroller = tabs.closest('.tab-scroll');
    tabs.querySelector('.tab.active')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    bindHorizontalScroller(scroller);
  }
  if (!supabaseClient) {
    showError(list, 'Supabase 設定未完成，暫時不能載入龍虎榜。');
    return;
  }
  showLoading(list, '載入龍虎榜中...');
  let query = supabaseClient
    .from('dse_leaderboard_entries')
    .select('nickname,dse_year,text_title,difficulty,score,accuracy,total_questions,first_correct,retries,created_at')
    .order('score', { ascending: false })
    .order('accuracy', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(200);
  if (state.lbTab !== 'all') query = query.eq('difficulty', state.lbTab);
  const { data, error } = await query;
  if (error) {
    showError(list, '龍虎榜載入失敗。', error);
    return;
  }
  const best = new Map();
  (data || []).forEach((row) => {
    const key = (row.nickname || '同學') + '|' + (row.dse_year || '');
    const old = best.get(key);
    if (!old || Number(row.score) > Number(old.score) || (Number(row.score) === Number(old.score) && Number(row.accuracy) > Number(old.accuracy))) {
      best.set(key, row);
    }
  });
  const rows = [...best.values()]
    .sort((a, b) => Number(b.score) - Number(a.score) || Number(b.accuracy) - Number(a.accuracy) || new Date(a.created_at) - new Date(b.created_at))
    .slice(0, 50);
  if (rows.length === 0) {
    showEmpty(list, '暫時未有排名。完成一次登入練習後，成績會出現在這裡。');
    return;
  }
  list.innerHTML = `
    <div class="leader-head">
      <span></span>
      <span>同學</span>
      <span>準繩度</span>
      <span>分數</span>
      <span>模式</span>
    </div>` + rows.map((row, index) => {
    const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : 'rank-other';
    const me = state.user && (row.nickname || '') === (state.user.nickname || state.user.username || '') ? ' me' : '';
    return `
      <div class="leader-row${me}">
        <span class="rank-medal ${rankClass}">${index + 1}</span>
        <div class="leader-person min-w-0">
          <div class="leader-name-line">
            <span class="leader-year">${escapeHtml(formatDseYear(row.dse_year))}</span>
            <span class="serif truncate" style="font-size:15px;font-weight:600;">${escapeHtml(row.nickname || '同學')}</span>
          </div>
          <div class="leader-sub">${escapeHtml(row.text_title || '全部篇章')} · ${fmtDate(row.created_at)}</div>
        </div>
        <div class="leader-metric">
          <span class="metric-label">準繩度</span>
          <span class="metric-value metric-accuracy">${pct(row.accuracy)}</span>
        </div>
        <div class="leader-metric">
          <span class="metric-label">分數</span>
          <span class="leader-score">${Number(row.score || 0).toLocaleString()}</span>
        </div>
        <span class="pill pill-cream leader-mode">${modeLabel(row.difficulty)}</span>
      </div>`;
  }).join('');
}

function summariseGroup(rows, key, fallback = '未分類') {
  const groups = new Map();
  rows.forEach((row) => {
    const name = row[key] || fallback;
    const group = groups.get(name) || { name, total: 0, correct: 0 };
    group.total += 1;
    if (row.is_correct) group.correct += 1;
    groups.set(name, group);
  });
  return [...groups.values()]
    .map((group) => ({ ...group, accuracy: group.total ? group.correct / group.total * 100 : 0 }))
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
}

function questionKindFromCode(code = '') {
  const match = String(code).match(/-([TCKX])-?\d*$/i) || String(code).match(/-([TCKX])-/i);
  const kind = match ? match[1].toUpperCase() : '';
  if (kind === 'T') return '文辭';
  if (kind === 'C') return '內容';
  if (kind === 'K') return '結構';
  if (kind === 'X') return '內容';
  return '';
}

function normaliseDseQuestionKind(value, questionCode = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (['內容', 'content', 'comprehension'].includes(raw)) return '內容';
  if (['文辭', '字詞', '翻譯', 'translation', 'language', 'wording', 'vocab', 'vocabulary'].includes(raw)) return '文辭';
  if (['結構', '手法', 'technique', 'structure', 'writing'].includes(raw)) return '結構';
  return questionKindFromCode(questionCode) || '內容';
}

function dseKindClass(name) {
  if (name === '內容') return 'easy';
  if (name === '文辭') return 'normal';
  if (name === '結構') return 'master';
  return 'hell';
}

function shortTextTitle(title = '') {
  return String(title || '全部篇章')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/論仁、論孝、論君子/g, '論語')
    .replace(/聲聲慢·秋情/g, '聲聲慢')
    .trim();
}

function questionDifficultyLabel(value) {
  const raw = String(value || '').trim().toLowerCase();
  const labels = {
    easy: '基礎',
    normal: '標準',
    medium: '標準',
    master: '進階',
    hard: '進階',
    hell: '挑戰',
  };
  return labels[raw] || value || '未標示';
}

function averageAccuracy(rows) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + Number(row.accuracy || 0), 0) / rows.length;
}

function describeTrend(rows) {
  if (rows.length < 4) return { label: '資料累積中', detail: '多完成幾場後，會比較近期表現變化。', delta: 0 };
  const size = Math.min(5, Math.floor(rows.length / 2));
  const recent = averageAccuracy(rows.slice(0, size));
  const previous = averageAccuracy(rows.slice(size, size * 2));
  const delta = recent - previous;
  if (delta >= 5) return { label: '正在進步', detail: `最近 ${size} 場比之前高 ${delta.toFixed(1)}%。`, delta };
  if (delta <= -5) return { label: '最近回落', detail: `最近 ${size} 場比之前低 ${Math.abs(delta).toFixed(1)}%。`, delta };
  return { label: '表現穩定', detail: `最近 ${size} 場和之前相差 ${Math.abs(delta).toFixed(1)}%。`, delta };
}

function describeAccuracy(avgAcc) {
  if (avgAcc >= 90) return '非常穩，可以開始挑戰更長題量。';
  if (avgAcc >= 75) return '基礎不錯，重點是減少重試。';
  if (avgAcc >= 60) return '有一定掌握，先集中補弱項。';
  return '仍在打底，建議先用短題量建立準確率。';
}

function renderStudentFocus(groups) {
  const items = groups.filter((group) => group && group.total >= 2).slice(0, 3);
  if (!items.length) return '<div class="focus-empty">完成更多題目後，這裡會列出最需要加強的地方。</div>';
  return items.map((group) => `
    <div class="focus-row">
      <div>
        <div class="focus-name">${escapeHtml(group.label || group.name)}</div>
        <div class="focus-sub">${group.total} 題紀錄</div>
      </div>
      <div class="focus-acc">${group.accuracy.toFixed(1)}%</div>
    </div>`).join('');
}

function renderHistoryInsights(rows, answerRows, dseKindGroups, textKindGroups, questionDifficultyGroups) {
  const plays = rows.length;
  const avgAcc = averageAccuracy(rows);
  const totalQuestions = rows.reduce((sum, row) => sum + Number(row.total_questions || 0), 0);
  const retryTotal = rows.reduce((sum, row) => sum + Number(row.retries || 0), 0);
  const retryRate = totalQuestions ? retryTotal / totalQuestions * 100 : 0;
  const trend = describeTrend(rows);
  const weakKind = dseKindGroups.filter((group) => group.total >= 3).sort((a, b) => a.accuracy - b.accuracy || b.total - a.total)[0];
  const hardLevel = questionDifficultyGroups.filter((group) => group.total >= 3).sort((a, b) => a.accuracy - b.accuracy || b.total - a.total)[0];
  const focusGroups = [
    ...textKindGroups.map((group) => ({ ...group, label: `${shortTextTitle(group.textTitle || group.name)}｜${group.kind || '內容'}` })),
    ...dseKindGroups.map((group) => ({ ...group, label: `${group.name}題` })),
    ...questionDifficultyGroups.map((group) => ({ ...group, label: `${group.name}題` })),
  ].sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
  const mainFocus = focusGroups.find((group) => group.total >= 2);
  const advice = mainFocus
    ? `下一次先做「${escapeHtml(mainFocus.label)}」。目標是先穩定答對，不急著增加題數。`
    : `下一次先完成一輪短題量練習，讓系統累積足夠紀錄。`;
  const status = `${trend.label}。${plays >= 3 ? describeAccuracy(avgAcc) : trend.detail}`;

  return `
    <div class="insight-panel">
      <div class="label analysis-title">表現分析</div>
      <div class="student-summary">
        <div class="summary-main">${escapeHtml(status)}</div>
        <div class="summary-meta">重試 ${retryTotal} 次 / ${totalQuestions || 0} 題 · 重試率 ${retryRate.toFixed(1)}%</div>
      </div>
      <div class="focus-list">${renderStudentFocus(focusGroups)}</div>
      <div class="advice-line">${advice}${weakKind ? ` 目前較弱的是「${escapeHtml(weakKind.name)}題」。` : ''}${hardLevel ? ` 題目難度上要留意「${escapeHtml(hardLevel.name)}題」。` : ''}</div>
    </div>`;
}

function renderAnalysisBars(title, groups, classPrefix = '') {
  if (!groups.length) return '';
  return `<div class="analysis-section"><div class="label analysis-title">${title}</div>` + groups.slice(0, 6).map((group) => `
    <div class="bar-row analysis-row">
      <span class="${classPrefix ? `diff-pill diff-pill-${classPrefix(group.className || group.name)}` : 'analysis-label'}">${escapeHtml(group.name)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.min(100, group.accuracy))}%;"></div></div>
      <span class="serif" style="text-align:right;font-weight:600;">${group.accuracy.toFixed(1)}%</span>
    </div>`).join('') + `</div>`;
}

function renderTextKindBars(groups) {
  if (!groups.length) return '';
  return `<div class="analysis-section"><div class="label analysis-title">重點弱項</div>` + groups.filter((group) => group.total >= 2).slice(0, 3).map((group) => `
    <div class="bar-row analysis-row compact-analysis-row">
      <span class="analysis-label compact-analysis-label">
        <span class="truncate">${escapeHtml(shortTextTitle(group.textTitle || group.name))}</span>
        <span class="mini-kind diff-pill diff-pill-${dseKindClass(group.kind)}">${escapeHtml(group.kind || '內容')}</span>
      </span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.min(100, group.accuracy))}%;"></div></div>
      <span class="serif" style="text-align:right;font-weight:600;">${group.accuracy.toFixed(1)}%</span>
    </div>`).join('') + `</div>`;
}

async function renderHistory() {
  const list = $('historyList');
  const summary = $('historySummary');
  const breakdown = $('historyBreakdown');
  show('history');
  if (!list) return;
  if (!currentUser) {
    if (summary) summary.innerHTML = '';
    if (breakdown) breakdown.innerHTML = '';
    showEmpty(list, '請登入以查看練習紀錄。');
    return;
  }
  showLoading(summary, '分析載入中...');
  if (breakdown) breakdown.innerHTML = '';
  showLoading(list, '載入練習紀錄中...');

  const [{ data: rounds, error: roundError }, { data: answers, error: answerError }] = await Promise.all([
    supabaseClient
      .from('dse_practice_rounds')
      .select('text_code,text_title,difficulty,total_questions,first_correct,retries,score,accuracy,created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(30),
    supabaseClient
      .from('dse_practice_answers')
      .select('question_code,text_code,text_title,difficulty,skill,is_correct,created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);
  if (roundError || answerError) {
    if (summary) summary.innerHTML = '';
    showError(list, '紀錄載入失敗。', roundError || answerError);
    return;
  }

  const rows = rounds || [];
  let answerRows = answers || [];
  if (!rows.length) {
    showEmpty(summary, '完成一次登入練習後，這裡會顯示分析。');
    if (breakdown) breakdown.innerHTML = '';
    list.innerHTML = '';
    return;
  }

  if (answerRows.length) {
    const codes = [...new Set(answerRows.map((row) => row.question_code).filter(Boolean))];
    const bankByCode = new Map();
    for (let i = 0; i < codes.length; i += 100) {
      const batch = codes.slice(i, i + 100);
      const { data: questionMeta, error: metaError } = await supabaseClient
        .from('dse_questions')
        .select('question_code,skill,difficulty')
        .in('question_code', batch);
      if (metaError) {
        console.error(metaError);
        break;
      }
      (questionMeta || []).forEach((question) => bankByCode.set(question.question_code, question));
    }
    answerRows = answerRows.map((row) => {
      const meta = bankByCode.get(row.question_code) || {};
      const rawSkill = meta.skill || row.skill || '';
      return {
        ...row,
        dseKind: normaliseDseQuestionKind(rawSkill, row.question_code),
        questionDifficulty: questionDifficultyLabel(meta.difficulty),
      };
    });
    answerRows = answerRows.map((row) => ({
      ...row,
      textKind: `${row.text_title || '全部篇章'}|${row.dseKind || '內容'}`,
    }));
  }

  const plays = rows.length;
  const avgAcc = averageAccuracy(rows);
  const topScore = Math.max(...rows.map((row) => Number(row.score || 0)));
  const retryTotal = rows.reduce((sum, row) => sum + Number(row.retries || 0), 0);
  if (summary) {
    summary.innerHTML = `
      <div class="mini-stats">
        <div class="mini-stat"><div class="num">${plays}</div><div class="cap">總挑戰</div></div>
        <div class="mini-stat"><div class="num">${avgAcc.toFixed(1)}%</div><div class="cap">平均準繩度</div></div>
        <div class="mini-stat"><div class="num">${topScore.toLocaleString()}</div><div class="cap">最高分</div></div>
      </div>`;
  }

  if (breakdown) {
    const modeGroups = summariseGroup(answerRows, 'difficulty').map((group) => ({ ...group, name: modeLabel(group.name), rawName: group.name }));
    const textGroups = summariseGroup(answerRows, 'text_title', '全部篇章');
    const dseKindGroups = summariseGroup(answerRows, 'dseKind', '內容');
    const textKindGroups = summariseGroup(answerRows, 'textKind', '全部篇章|內容').map((group) => {
      const [textTitle, kind] = String(group.name).split('|');
      return { ...group, textTitle, kind };
    });
    const questionDifficultyGroups = summariseGroup(answerRows, 'questionDifficulty', '未標示');
    breakdown.innerHTML = [
      renderHistoryInsights(rows, answerRows, dseKindGroups, textKindGroups, questionDifficultyGroups),
      renderTextKindBars(textKindGroups),
      `<div class="text-xs pt-3 pb-2" style="color:var(--muted);">只顯示最需要加強的部分；下方保留每場紀錄，方便回看。</div>`,
    ].join('');
  }

  list.innerHTML = rows.map((row) => `
    <div class="leader-row">
      <span class="rank-medal rank-other">${modeLabel(row.difficulty).slice(0, 1)}</span>
      <div class="min-w-0">
        <div class="serif truncate" style="font-size:15px;font-weight:600;">${escapeHtml(row.text_title || '全部篇章')}</div>
        <div class="leader-sub">${new Date(row.created_at).toLocaleString('zh-HK')} · ${row.first_correct}/${row.total_questions} 首次答對 · 重試 ${row.retries}</div>
      </div>
      <div class="leader-score">${Number(row.score || 0).toLocaleString()}</div>
      <span class="pill pill-cream">${pct(row.accuracy)}</span>
    </div>`).join('');
}

function bindMisc() {
  $('btnTextNext')?.addEventListener('click', renderDifficulty);
  $('btnGoConfirm')?.addEventListener('click', renderConfirm);
  $('btnStartGame')?.addEventListener('click', startGame);
  $('btnNextQ')?.addEventListener('click', () => {
    if (state.attempted.size >= state.totalForRound && state.queue.length === 0) finishGame();
    else nextQuestion();
  });
  $('btnPlayAgain')?.addEventListener('click', startGame);
  $('btnHome')?.addEventListener('click', () => enterHome());
  $('btnSaveSettings')?.addEventListener('click', saveSettings);
  $('gameBackBtn')?.addEventListener('click', () => {
    if ($('exitModal')) $('exitModal').style.display = 'flex';
  });
  $('exitContinue')?.addEventListener('click', () => {
    if ($('exitModal')) $('exitModal').style.display = 'none';
  });
  $('exitConfirm')?.addEventListener('click', () => {
    if ($('exitModal')) $('exitModal').style.display = 'none';
    enterHome();
  });
  $('exitModal')?.addEventListener('click', (event) => {
    if (event.target === $('exitModal')) $('exitModal').style.display = 'none';
  });
  document.querySelectorAll('[data-toggle]').forEach((row) => row.addEventListener('click', async () => {
    const key = row.dataset.toggle;
    state.prefs[key] = !state.prefs[key];
    if (key === 'notice' && state.prefs.notice && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    savePrefs();
    applyPrefs();
    toast('偏好已更新');
  }));
}

ensureForgotPasswordLink();
ensurePasswordRecoveryForm();
loadPrefs();
initYearPicker();
initSettingsYears();
bindNavigation();
bindAuth();
bindMisc();
initSession();

