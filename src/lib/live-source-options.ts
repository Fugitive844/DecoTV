export const DEFAULT_LIVE_SOURCE_SORT_ORDER = 1000;

export function isValidLiveSourceSortOrder(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function getLiveSourceSortOrder(source: { sortOrder?: number }): number {
  return isValidLiveSourceSortOrder(source.sortOrder)
    ? source.sortOrder
    : DEFAULT_LIVE_SOURCE_SORT_ORDER;
}

// 返回副本；同值以原数组位置为准，兼容没有排序字段的历史配置。
export function sortLiveSources<T extends { sortOrder?: number }>(
  sources: readonly T[],
): T[] {
  return sources
    .map((source, index) => ({ source, index }))
    .sort(
      (a, b) =>
        getLiveSourceSortOrder(a.source) - getLiveSourceSortOrder(b.source) ||
        a.index - b.index,
    )
    .map(({ source }) => source);
}

export interface LiveSourceSearchCondition {
  field: 'name' | 'key' | 'url' | 'any';
  operator: 'contains' | 'not-contains';
  keyword: string;
}

// 组内条件全部满足（且），组间任意满足（或）。空白条件不参与匹配。
export type LiveSourceSearchGroups = LiveSourceSearchCondition[][];

export function matchesLiveSourceSearch(
  source: { name: string; key: string; url: string },
  groups: LiveSourceSearchGroups,
): boolean {
  const activeGroups = groups
    .map((group) => group.filter((condition) => condition.keyword.trim()))
    .filter((group) => group.length > 0);
  if (activeGroups.length === 0) return true;

  return activeGroups.some((group) =>
    group.every((condition) => {
      const keyword = condition.keyword.trim().normalize('NFKC').toLowerCase();
      const values =
        condition.field === 'any'
          ? [source.name, source.key, source.url]
          : [source[condition.field]];
      const contains = values.some((value) =>
        value.normalize('NFKC').toLowerCase().includes(keyword),
      );
      return condition.operator === 'not-contains' ? !contains : contains;
    }),
  );
}
