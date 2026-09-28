const extensionApi = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
let initialized = false;

function duration(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function render(state) {
  const limitMs = state.limitMinutes * 60_000;
  const hasBonus = state.usedMs >= limitMs && !state.blocked;
  $('used').textContent = duration(state.usedMs);
  $('progress').value = Math.min(100, state.usedMs / limitMs * 100);
  $('remaining').textContent = state.blocked ? 'Daily limit reached' : hasBonus ? `${state.bonusRemaining} bonus Shorts left` : `${duration(limitMs - state.usedMs)} left`;
  $('limit-label').textContent = `${state.limitMinutes} min limit`;
  $('status-title').textContent = state.blocked ? 'Your daily time is up.' : hasBonus ? 'You earned a little extra.' : 'Make room for something else.';
  $('status-copy').textContent = state.blocked ? 'Solve the Sudoku on Shorts to unlock 3 more, or return tomorrow.' : hasBonus ? 'The feed blocks again after your bonus Shorts.' : 'Shorts will pause when your time is up.';
  $('status-dot').classList.toggle('blocked', state.blocked);
  if (!initialized) {
    $('minutes').value = state.limitMinutes;
    initialized = true;
  }
}

async function request(message) {
  const response = await extensionApi.runtime.sendMessage(message);
  if (response?.error || !response?.state) throw new Error(response?.error || 'Could not load your timer. Reopen the extension to try again.');
  render(response.state);
}

function feedback(message, error = false) {
  $('feedback').textContent = message;
  $('feedback').classList.toggle('error', error);
}

$('limit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const minutes = Number($('minutes').value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    feedback('Choose a whole number from 1 to 1440.', true);
    return;
  }
  $('save').disabled = true;
  try {
    await request({ type: 'setLimit', minutes });
    feedback('Daily limit saved.');
  } catch (error) {
    feedback(error.message, true);
  } finally {
    $('save').disabled = false;
  }
});

async function refresh() {
  try { await request({ type: 'getState' }); }
  catch (error) { feedback(error.message, true); }
}
refresh();
setInterval(refresh, 1000);
