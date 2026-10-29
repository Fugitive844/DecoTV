// 测试用内存键值实现，语义与 IStorage 的通用键值原语一致。
export function createMemoryKv() {
  const kv = new Map();
  const zsets = new Map();
  const read = (key) => {
    const entry = kv.get(key);
    if (!entry) return null;
    if (entry.expireAt && entry.expireAt <= Date.now()) {
      kv.delete(key);
      return null;
    }
    return entry.value;
  };
  const sorted = (key) =>
    [...(zsets.get(key)?.entries() || [])].sort(
      (a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1),
    );
  const api = {
    failNextWrites: 0,
    async kvGet(key) {
      return read(key);
    },
    async kvMGet(keys) {
      return keys.map(read);
    },
    async kvSet(key, value, options = {}) {
      if (options.nx && read(key) !== null) return false;
      kv.set(key, {
        value,
        expireAt: options.px ? Date.now() + options.px : 0,
      });
      return true;
    },
    async kvDel(keys) {
      keys.forEach((key) => kv.delete(key));
    },
    async kvCompareAndSet(key, expected, value, px) {
      if (api.failNextWrites > 0) {
        api.failNextWrites--;
        throw new Error('模拟数据库写入失败');
      }
      if (read(key) !== expected) return false;
      if (value === null) kv.delete(key);
      else kv.set(key, { value, expireAt: px ? Date.now() + px : 0 });
      return true;
    },
    async zAdd(key, score, member) {
      if (!zsets.has(key)) zsets.set(key, new Map());
      zsets.get(key).set(member, score);
    },
    async zRem(key, members) {
      members.forEach((member) => zsets.get(key)?.delete(member));
    },
    async zRangeByScore(key, min, max, limit) {
      return sorted(key)
        .filter(([, score]) => score >= min && score <= max)
        .slice(0, limit)
        .map(([member]) => member);
    },
    async zRangeAll(key) {
      return sorted(key).map(([member]) => member);
    },
  };
  return api;
}
