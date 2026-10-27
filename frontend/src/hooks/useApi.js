import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Runs an API call and tracks loading/error/data for it.
 *
 * Every screen needs the same three states, and getting them subtly wrong (a
 * spinner that never clears, a stale response overwriting a newer one) is the
 * most common bug in this kind of UI — so it lives in one place.
 *
 * @param fn      an async function that performs the call
 * @param deps    re-run when these change
 * @param enabled skip the call entirely while false
 */
export function useApi(fn, deps = [], enabled = true) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(enabled)
  const reqId = useRef(0)

  const run = useCallback(async () => {
    if (!enabled) return
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const result = await fn()
      if (id === reqId.current) setData(result) // ignore a response that a newer call has superseded
    } catch (e) {
      if (id === reqId.current) setError(e)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled])

  useEffect(() => { run() }, [run])

  return { data, error, loading, reload: run, setData }
}

/** Wraps a mutating call: tracks in-flight state and per-field server errors. */
export function useMutation(fn) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const mutate = useCallback(async (...args) => {
    setBusy(true)
    setError(null)
    try {
      return { ok: true, data: await fn(...args) }
    } catch (e) {
      setError(e)
      return { ok: false, error: e }
    } finally {
      setBusy(false)
    }
  }, [fn])

  return { mutate, busy, error, fieldErrors: error?.fields ?? {}, clearError: () => setError(null) }
}

/** Re-renders on an interval so countdowns tick without a full data refetch. */
export function useTicker(ms = 30000) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}
