package dev.isabelle.vscode.server

import org.scalatest.funsuite.AnyFunSuite

final class SnapshotCacheSpec extends AnyFunSuite {
  test("put + get returns the cached value for the same (uri, version, session)") {
    val cache = new SnapshotCache()
    val snap = new Object
    cache.put("file:///a.thy", 1, "HOL", snap)
    assert(cache.get("file:///a.thy", 1, "HOL").contains(snap))
  }

  test("different versions for the same uri are distinct cache keys") {
    val cache = new SnapshotCache()
    val snap1 = new Object
    val snap2 = new Object
    cache.put("file:///a.thy", 1, "HOL", snap1)
    cache.put("file:///a.thy", 2, "HOL", snap2)
    assert(cache.get("file:///a.thy", 1, "HOL").contains(snap1))
    assert(cache.get("file:///a.thy", 2, "HOL").contains(snap2))
  }

  test("evictForUri drops every entry for the supplied uri across all versions and sessions") {
    val cache = new SnapshotCache()
    cache.put("file:///a.thy", 1, "HOL", new Object)
    cache.put("file:///a.thy", 2, "HOL", new Object)
    cache.put("file:///a.thy", 1, "Pure", new Object)
    cache.put("file:///b.thy", 1, "HOL", new Object)

    val evicted = cache.evictForUri("file:///a.thy")

    assert(evicted == 3)
    assert(cache.get("file:///a.thy", 1, "HOL").isEmpty)
    assert(cache.get("file:///a.thy", 2, "HOL").isEmpty)
    assert(cache.get("file:///a.thy", 1, "Pure").isEmpty)
    assert(cache.get("file:///b.thy", 1, "HOL").isDefined, "evicting one uri must not drop others")
  }

  test("evictForSession drops every entry whose session matches") {
    val cache = new SnapshotCache()
    cache.put("file:///a.thy", 1, "HOL", new Object)
    cache.put("file:///b.thy", 1, "HOL", new Object)
    cache.put("file:///a.thy", 1, "Pure", new Object)

    val evicted = cache.evictForSession("HOL")

    assert(evicted == 2)
    assert(cache.get("file:///a.thy", 1, "HOL").isEmpty)
    assert(cache.get("file:///b.thy", 1, "HOL").isEmpty)
    assert(cache.get("file:///a.thy", 1, "Pure").isDefined)
  }

  test("LRU bound: cache size never exceeds maxEntries") {
    val cache = new SnapshotCache(maxEntries = 3)
    for (i <- 1 to 6) {
      cache.put(s"file:///$i.thy", 1, "HOL", new Object)
    }
    assert(cache.size == 3)
    // The earliest entries (1, 2, 3) should have been evicted.
    assert(cache.get("file:///1.thy", 1, "HOL").isEmpty)
    assert(cache.get("file:///2.thy", 1, "HOL").isEmpty)
    assert(cache.get("file:///3.thy", 1, "HOL").isEmpty)
    assert(cache.get("file:///4.thy", 1, "HOL").isDefined)
    assert(cache.get("file:///5.thy", 1, "HOL").isDefined)
    assert(cache.get("file:///6.thy", 1, "HOL").isDefined)
  }

  test("LRU access: get() promotes an entry so it survives later evictions") {
    val cache = new SnapshotCache(maxEntries = 3)
    cache.put("file:///a.thy", 1, "HOL", new Object)
    cache.put("file:///b.thy", 1, "HOL", new Object)
    cache.put("file:///c.thy", 1, "HOL", new Object)
    // Touch a.thy so it becomes the most-recently used.
    cache.get("file:///a.thy", 1, "HOL")
    // Now insert d.thy — b.thy should be evicted, not a.thy.
    cache.put("file:///d.thy", 1, "HOL", new Object)
    assert(cache.get("file:///a.thy", 1, "HOL").isDefined)
    assert(cache.get("file:///b.thy", 1, "HOL").isEmpty)
  }

  test("clear drops everything") {
    val cache = new SnapshotCache()
    cache.put("file:///a.thy", 1, "HOL", new Object)
    cache.clear()
    assert(cache.size == 0)
  }
}
