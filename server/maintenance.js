// Cleanup is independent of request latency. Expiry checks still happen at use time.
export function startMaintenance(db, { setTimer = setInterval, clearTimer = clearInterval, onError = error => console.error("Expired data cleanup failed", error) } = {}) {
  let flight = null, stopped = false;
  function sweep() {
    if (stopped || flight) return flight;
    flight = (async () => {
      const now = Date.now();
      for (const table of ["sessions", "challenges", "rate_limits"]) {
        await db.run(`DELETE FROM ${table} WHERE expires_at < ?`, now);
      }
    })().catch(onError).finally(() => { flight = null; });
    return flight;
  }
  const timer = setTimer(sweep, 60000);
  timer.unref();
  void sweep();
  return async () => {
    stopped = true;
    clearTimer(timer);
    await flight;
  };
}
