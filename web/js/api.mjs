// Calls to the local server that holds the session (web.js).

const token = document.querySelector('meta[name="jukorama-token"]').content;

/** The page has no server left to talk to. */
function lost(message) {
  const error = new Error(message);
  error.offline = true;
  return error;
}

/** JSON call. Rejects with the server's own message; `offline` when it is gone. */
export async function api(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Jukorama-Token': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw lost('La télé ne répond plus. Relance Voter-web.cmd, puis recharge cette page.');
  }
  // 401: the server was started again since this page was loaded, with a new token.
  if (response.status === 401) throw lost('La télé a été relancée depuis. Recharge cette page.');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Erreur ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * Follow a long call: while `pending` runs, ask the server where it is and
 * hand each answer ({ step, done, total } or null) to `onProgress`.
 */
export async function watch(pending, onProgress) {
  let running = true;
  const poll = async () => {
    while (running) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!running) break;
      try {
        const { progress } = await api('GET', '/api/progress');
        if (running) onProgress(progress);
      } catch {
        // The call being watched reports its own failure.
      }
    }
  };
  poll();
  try {
    return await pending;
  } finally {
    running = false;
  }
}
