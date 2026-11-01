(() => {
  const root = document.documentElement;
  const englishUi = root.lang === 'en';
  const authMessages = englishUi ? {
    show: 'Show password', hide: 'Hide password', required: 'This field is required.', short: 'Use at least 6 characters.', mismatch: 'The new passwords do not match.'
  } : {
    show: 'أظهر كلمة المرور', hide: 'أخفِ كلمة المرور', required: 'هذا الحقل مطلوب.', short: 'استخدم 6 أحرف على الأقل.', mismatch: 'كلمتا المرور الجديدتان غير متطابقتين.'
  };
  const themeButton = document.querySelector('#theme-toggle');
  let theme = 'light';
  try { theme = localStorage.getItem('tendro-theme') === 'dark' ? 'dark' : 'light'; } catch { /* Keep light mode when storage is unavailable. */ }
  const applyTheme = (value) => {
    theme = value === 'dark' ? 'dark' : 'light';
    root.dataset.theme = theme;
    if (themeButton) {
      themeButton.textContent = theme === 'dark' ? themeButton.dataset.lightLabel : themeButton.dataset.darkLabel;
      themeButton.setAttribute('aria-pressed', String(theme === 'dark'));
    }
  };
  applyTheme(theme);
  themeButton?.addEventListener('click', () => {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
    try { localStorage.setItem('tendro-theme', theme); } catch { /* Theme still changes for this page. */ }
  });

  const networkBanner = document.querySelector('#network-status');
  let bannerTimer;
  const networkWords = englishUi
    ? { offline: 'Internet connection lost. Your current page and draft remain available on this device.', online: 'Connection restored.', queued: 'Your changes are saved as a draft and will be sent when the connection returns.' }
    : { offline: 'انقطع الإنترنت. ستبقى هذه الصفحة ومدخلاتك محفوظة على هذا الجهاز.', online: 'عاد الاتصال بالإنترنت.', queued: 'تغييراتك محفوظة كمسودة، وستُرسل عند عودة الاتصال.' };
  const showNetwork = (message, kind, hideAfter = 0) => {
    if (!networkBanner) return;
    clearTimeout(bannerTimer);
    networkBanner.textContent = message;
    networkBanner.className = `network-status ${kind}`;
    networkBanner.hidden = false;
    if (hideAfter) bannerTimer = setTimeout(() => { networkBanner.hidden = true; }, hideAfter);
  };
  if (!navigator.onLine) showNetwork(networkWords.offline, 'offline');
  window.addEventListener('offline', () => showNetwork(networkWords.offline, 'offline'));
  window.addEventListener('online', () => showNetwork(networkWords.online, 'online', 4500));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* App remains usable when offline caching is unavailable. */ });
  }
  document.querySelectorAll('.dashboard-toast').forEach((toast) => setTimeout(() => toast.remove(), 3000));

  document.querySelectorAll('[data-password-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const input = document.getElementById(toggle.dataset.passwordToggle);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? toggle.dataset.hideLabel : toggle.dataset.showLabel;
      toggle.setAttribute('aria-label', toggle.textContent);
      input.focus();
    });
  });

  document.querySelectorAll('.auth-form').forEach((authForm) => {
    const newPassword = authForm.querySelector('input[name="new"]');
    const confirmation = authForm.querySelector('input[name="confirm"]');
    const updateConfirmation = () => {
      if (!confirmation || !newPassword) return;
      confirmation.setCustomValidity(confirmation.value && confirmation.value !== newPassword.value ? authMessages.mismatch : '');
      showInlineError(confirmation);
    };
    const showInlineError = (field) => {
      const error = field.closest('label')?.querySelector('.field-error');
      let message = '';
      if (field.validity.valueMissing) message = authMessages.required;
      else if (field.validity.tooShort) message = authMessages.short;
      else if (field.validity.customError) message = authMessages.mismatch;
      field.setAttribute('aria-invalid', String(Boolean(message)));
      field.closest('label')?.classList.toggle('has-error', Boolean(message));
      if (error) error.textContent = message;
    };
    authForm.querySelectorAll('input,select').forEach((field) => {
      field.addEventListener('invalid', () => showInlineError(field), true);
      field.addEventListener('input', () => {
        if (field === newPassword || field === confirmation) updateConfirmation();
        showInlineError(field);
      });
      field.addEventListener('change', () => showInlineError(field));
    });
    authForm.addEventListener('submit', (event) => {
      updateConfirmation();
      if (!authForm.reportValidity()) { event.preventDefault(); return; }
      const submit = authForm.querySelector('.auth-submit');
      if (submit) {
        submit.disabled = true;
        submit.classList.add('is-loading');
        submit.textContent = authForm.dataset.loadingLabel || (englishUi ? 'Please wait...' : 'يرجى الانتظار...');
      }
      authForm.setAttribute('aria-busy', 'true');
    });
  });

  document.querySelectorAll('form[data-confirm]').forEach((confirmForm) => {
    confirmForm.addEventListener('submit', (event) => {
      if (!window.confirm(confirmForm.dataset.confirm || 'Are you sure?')) event.preventDefault();
    });
  });

  const form = document.querySelector('#section-form');
  if (!form) return;

  const match = location.pathname.match(/^\/s\/(\d+)/);
  if (!match) return;
  const sectionId = match[1];
  const draftKey = `tendro-section-draft:${sectionId}`;
  const state = document.querySelector('#save-state');
  const isEnglish = document.documentElement.lang === 'en';
  const words = isEnglish ? {
    draftPrompt: 'An unsaved draft exists, and the saved data has changed. Restoring the draft will replace conflicting fields on this page. Restore it?',
    restored: 'An unsaved draft was restored', noChanges: 'No unsaved changes', dirty: 'Unsaved changes', saving: 'Saving changes...', saved: 'Changes saved',
    failed: 'Could not save', preserved: 'Your entries are preserved. Please try again.', notConfirmed: 'The server did not confirm the save.', pending: 'Saved, but translation is pending. Check the Google API key and save again.', offline: 'You are offline. Your changes are saved locally and will be sent when the connection returns.', retrying: 'Connection is unstable. Retrying your save…',
    deleteFailed: 'Could not delete the comment.', noComments: 'No comments.'
  } : {
    draftPrompt: 'توجد مسودة غير محفوظة، والبيانات الحالية في قاعدة البيانات أحدث أو مختلفة. استعادة المسودة ستستبدل الحقول المتعارضة في الصفحة فقط. هل تريد استعادتها؟',
    restored: 'تمت استعادة مسودة غير محفوظة', noChanges: 'لا توجد تغييرات غير محفوظة', dirty: 'تغييرات غير محفوظة', saving: 'جارٍ حفظ التغييرات...', saved: 'تم حفظ التغييرات',
    failed: 'تعذّر الحفظ', preserved: 'بقيت مدخلاتك محفوظة، حاول مجددًا', notConfirmed: 'لم يؤكد الخادم حفظ التغييرات', pending: 'تم حفظ النص الأصلي، لكن الترجمة معلّقة. تحقق من مفتاح Google API ثم احفظ مجددًا.', offline: 'أنت غير متصل. حفظنا تغييراتك محليًا وسنرسلها عند عودة الاتصال.', retrying: 'الاتصال غير مستقر. سنعيد محاولة الحفظ…',
    deleteFailed: 'تعذّر حذف التعليق.', noComments: 'لا توجد تعليقات.'
  };
  const button = document.querySelector('#save-all');
  const comment = document.querySelector('#comment-draft');
  const fields = [...form.querySelectorAll('textarea, select, input[type="radio"]')];
  const baseline = JSON.parse(form.dataset.baseline || '{}');
  const snapshot = (overrides = {}) => fields.map((field) => {
    if (field.type === 'radio') return `${field.name}:${field.value}:${field.checked}`;
    const value = Object.hasOwn(overrides, field.name) ? overrides[field.name] : field.value;
    return `${field.name}:${value}`;
  }).join('|');
  let savedSnapshot = snapshot();
  let pendingComment = '';
  let saving = false;
  let restoredDraft = false;
  let pendingRequestId = '';
  let pendingRequestComment = '';
  let queuedSave = false;
  let retryTimer = null;
  let retryDelay = 2000;

  const draftFields = () => {
    const data = Object.fromEntries(fields.filter((f) => f.name && f.type !== 'radio').map((f) => [f.name, f.value]));
    const selectedMode = form.querySelector('input[name="mode"]:checked');
    if (selectedMode) data.mode = selectedMode.value;
    return data;
  };
  const storeDraft = () => {
    const hasChanges = snapshot() !== savedSnapshot || !!pendingComment || queuedSave;
    if (!hasChanges) return;
    const draft = JSON.stringify({ version: 2, sectionId, baseline, fields: draftFields(), pendingRequestId, pendingRequestComment, queuedSave, updatedAt: Date.now() });
    try { localStorage.setItem(draftKey, draft); } catch { /* Browser storage may be disabled or full. */ }
  };
  const currentMatchesBaseline = (data) => {
    const f = data.fields || {};
    return (f.content ?? baseline.content) === baseline.content
      && (f.status ?? baseline.status) === baseline.status
      && (f.mode ?? baseline.mode) === baseline.mode
      && (f.editor ?? baseline.editor) === baseline.editor;
  };
  const restoreDraft = () => {
    try {
      const data = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (!data) return;
      if (![1, 2].includes(data.version) || data.sectionId !== sectionId || !data.fields) { localStorage.removeItem(draftKey); return; }
      const sameBaseline = JSON.stringify(data.baseline) === JSON.stringify(baseline);
      const differsFromSaved = !currentMatchesBaseline(data);
      if (!sameBaseline || differsFromSaved) {
        const restore = window.confirm(words.draftPrompt);
        if (!restore) {
          localStorage.removeItem(draftKey);
          return;
        }
      }
      fields.forEach((field) => {
        if (field.type === 'radio') field.checked = data.fields[field.name] === field.value;
        else if (Object.hasOwn(data.fields, field.name)) field.value = data.fields[field.name];
      });
      if (data.fields.mode) {
        const radio = form.querySelector(`input[name="mode"][value="${CSS.escape(data.fields.mode)}"]`);
        if (radio) radio.checked = true;
      }
      pendingComment = String(data.fields.comment || '');
      pendingRequestId = String(data.pendingRequestId || '');
      pendingRequestComment = String(data.pendingRequestComment || '');
      queuedSave = Boolean(data.queuedSave);
      restoredDraft = true;
    } catch { localStorage.removeItem(draftKey); }
  };
  restoreDraft();
  savedSnapshot = snapshot();
  const updateState = () => {
    if (saving) return;
    const changed = snapshot() !== savedSnapshot || !!pendingComment;
    state.textContent = changed ? words.dirty : words.noChanges;
    state.className = `save-state${changed ? ' dirty' : ''}`;
    if (changed || queuedSave) storeDraft();
    else localStorage.removeItem(draftKey);
  };
  const commentsList = document.querySelector('#comments-list');
  const commentCount = document.querySelector('#comment-count');
  const queueRetry = (immediate = false) => {
    if (retryTimer) clearTimeout(retryTimer);
    if (!queuedSave) return;
    if (!navigator.onLine) {
      showNetwork(networkWords.offline, 'offline');
      state.textContent = words.offline;
      state.className = 'save-state failed';
      storeDraft();
      return;
    }
    retryTimer = setTimeout(() => {
      if (!saving && queuedSave) form.requestSubmit(button);
    }, immediate ? 250 : retryDelay);
    if (!immediate) retryDelay = Math.min(retryDelay * 2, 60000);
    state.textContent = words.retrying;
    state.className = 'save-state saving';
  };
  window.addEventListener('online', () => {
    retryDelay = 2000;
    if (queuedSave) queueRetry(true);
  });
  window.addEventListener('offline', () => {
    storeDraft();
    if (queuedSave) queueRetry();
  });
  commentsList?.addEventListener('click', async (event) => {
    const deleteButton = event.target.closest('[data-delete-comment]');
    if (!deleteButton || deleteButton.disabled) return;
    const commentId = deleteButton.dataset.deleteComment;
    deleteButton.disabled = true;
    storeDraft();
    try {
      const response = await fetch(`/c/${commentId}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Requested-With': 'fetch'
        },
        body: new URLSearchParams({ _csrf: deleteButton.dataset.csrf || '' }),
        credentials: 'same-origin'
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || words.deleteFailed);
      location.href = `/?deleted=${result.sectionId}#section-${result.sectionId}`;
      return;
    } catch (error) {
      deleteButton.disabled = false;
      deleteButton.title = error.message || 'تعذّر حذف التعليق';
    }
  });
  fields.forEach((field) => field.addEventListener('input', updateState));
  fields.forEach((field) => field.addEventListener('change', updateState));
  window.addEventListener('pagehide', storeDraft);
  if (restoredDraft) {
    state.textContent = queuedSave ? (navigator.onLine ? words.retrying : words.offline) : words.restored;
    state.className = queuedSave ? 'save-state failed' : 'save-state dirty';
    if (queuedSave && navigator.onLine) queueRetry(true);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    pendingComment = comment?.value.trim() || '';
    if (pendingComment && (!pendingRequestId || pendingRequestComment !== pendingComment)) {
      try {
        if (crypto.randomUUID) pendingRequestId = crypto.randomUUID();
        else {
          const bytes = Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
          pendingRequestId = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
        }
      } catch { pendingRequestId = `${Date.now().toString(16).padStart(12, '0').slice(-12)}-0000-4000-8000-000000000000`; }
      pendingRequestComment = pendingComment;
    }
    queuedSave = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (!navigator.onLine) {
      button.disabled = false;
      state.textContent = words.offline;
      state.className = 'save-state failed';
      showNetwork(networkWords.queued, 'offline');
      storeDraft();
      return;
    }
    saving = true;
    const submittedComment = pendingComment;
    const submittedFields = draftFields();
    const payload = new URLSearchParams(new FormData(form));
    if (comment) payload.set('comment', submittedComment);
    if (pendingRequestId) payload.set('client_request_id', pendingRequestId);
    button.disabled = true;
    state.textContent = words.saving;
    state.className = 'save-state saving';
    storeDraft();
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'fetch' },
        body: payload,
        ...(typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(30000) } : {}),
        credentials: 'same-origin'
      });
      if (!response.ok) {
        let message = words.failed;
        try { message = (await response.json()).error || message; } catch { /* Keep generic message. */ }
        const error = new Error(message);
        error.retryable = response.status >= 500 || response.status === 429;
        throw error;
      }
      const result = await response.json();
      if (!result.ok) throw new Error(words.notConfirmed);
      if (comment && submittedComment && comment.value.trim() === submittedComment) comment.value = '';
      pendingComment = comment?.value.trim() || '';
      submittedFields.comment = '';
      savedSnapshot = snapshot(submittedFields);
      pendingRequestId = '';
      pendingRequestComment = '';
      queuedSave = snapshot() !== savedSnapshot || !!pendingComment;
      if (!queuedSave) localStorage.removeItem(draftKey);
      state.textContent = result.translationPending ? words.pending : words.saved;
      state.className = `save-state ${result.translationPending ? 'failed' : 'saved'}`;
      if (!queuedSave) { location.href = `/?saved=${result.sectionId}#section-${result.sectionId}`; return; }
      if (queuedSave) {
        storeDraft();
        state.textContent = words.dirty;
        state.className = 'save-state dirty';
      }
    } catch (error) {
      state.textContent = `${error.message || words.failed} — ${words.preserved}`;
      state.className = 'save-state failed';
      storeDraft();
      if (error.retryable || ['TypeError', 'AbortError', 'TimeoutError'].includes(error.name) || !navigator.onLine) {
        queuedSave = true;
        storeDraft();
        if (!navigator.onLine) showNetwork(networkWords.queued, 'offline');
        queueRetry();
      } else {
        queuedSave = false;
        storeDraft();
      }
    } finally {
      saving = false;
      button.disabled = false;
    }
  });
})();
