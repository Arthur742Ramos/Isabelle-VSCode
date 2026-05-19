package dev.isabelle.vscode.server

/**
 * Per-`(uri, version, session)` snapshot cache for the Phase 3
 * proof-state path. Backed by an LRU map bounded to 16 entries (the
 * vast majority of users have <8 theory files open; 16 covers AFP
 * power users without unbounded memory growth).
 *
 * Locked design (plan.md):
 *
 *   - Lazy populate: first `proofState/getWithPide` for a key
 *     submits `use_theories` and caches the resulting Snapshot.
 *     Subsequent calls at the same key reuse the cached Snapshot
 *     for sub-second response.
 *   - Drop on version bump: `evictForUri(uri)` clears every cached
 *     entry for that uri so the next call after a `didChange`
 *     re-submits cleanly. No stale state risk.
 *   - Drop on session change: `evictForSession(session)` clears
 *     every cached entry for that session so an
 *     `Isabelle: Select Active Session` change invalidates the
 *     whole cache.
 *   - NO background pre-submit on document open.
 *
 * Thread safety: backed by a synchronized LinkedHashMap. The Phase
 * 2a registry already serializes PIDE worker calls through a
 * single-thread executor, so contention is minimal — but the cache
 * is also reachable from the dispatcher's main thread (for evict
 * calls bound to `document/update` / setting changes), so we
 * synchronize defensively.
 */
final class SnapshotCache(maxEntries: Int = SnapshotCache.DefaultMaxEntries) {
  import SnapshotCache.Key

  private val store = new java.util.LinkedHashMap[Key, AnyRef](16, 0.75f, true) {
    override def removeEldestEntry(eldest: java.util.Map.Entry[Key, AnyRef]): Boolean =
      this.size() > maxEntries
  }

  def get(uri: String, version: Int, session: String): Option[AnyRef] =
    synchronized {
      Option(store.get(Key(uri, version, session)))
    }

  def put(uri: String, version: Int, session: String, snapshot: AnyRef): Unit =
    synchronized {
      store.put(Key(uri, version, session), snapshot)
    }

  /** Drop every cached entry for the given uri. Called by the
    * `document/update` path so a new version re-submits cleanly. */
  def evictForUri(uri: String): Int = synchronized {
    val it = store.entrySet().iterator()
    var removed = 0
    while (it.hasNext) {
      val entry = it.next()
      if (entry.getKey.uri == uri) {
        it.remove()
        removed += 1
      }
    }
    removed
  }

  /** Drop every cached entry for the given session. Called when the
    * `isabelle.session.active` setting changes. */
  def evictForSession(session: String): Int = synchronized {
    val it = store.entrySet().iterator()
    var removed = 0
    while (it.hasNext) {
      val entry = it.next()
      if (entry.getKey.session == session) {
        it.remove()
        removed += 1
      }
    }
    removed
  }

  /** Drop the entire cache. Used by tests + cleanup. */
  def clear(): Unit = synchronized(store.clear())

  /** Diagnostic: current number of cached entries. */
  def size: Int = synchronized(store.size())
}

object SnapshotCache {
  /** Bound on cache size. Vast majority of users have <8 theories
    * open; 16 covers AFP power users without unbounded memory
    * growth. Tunable here so a future setting could expose it. */
  val DefaultMaxEntries: Int = 16

  private[server] final case class Key(uri: String, version: Int, session: String)
}
