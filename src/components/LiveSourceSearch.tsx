'use client';

import type {
  LiveSourceSearchCondition,
  LiveSourceSearchGroups,
} from '@/lib/live-source-options';

const emptyCondition = (): LiveSourceSearchCondition => ({
  field: 'name',
  operator: 'contains',
  keyword: '',
});

export default function LiveSourceSearch({
  groups,
  onChange,
  disabled,
}: {
  groups: LiveSourceSearchGroups;
  onChange: (groups: LiveSourceSearchGroups) => void;
  disabled?: boolean;
}) {
  const updateCondition = (
    groupIndex: number,
    conditionIndex: number,
    patch: Partial<LiveSourceSearchCondition>,
  ) =>
    onChange(
      groups.map((group, index) =>
        index === groupIndex
          ? group.map((condition, itemIndex) =>
              itemIndex === conditionIndex
                ? { ...condition, ...patch }
                : condition,
            )
          : group,
      ),
    );
  const inputClass =
    'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
  const buttonClass =
    'rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700';

  return (
    <fieldset
      disabled={disabled}
      className='space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700'
    >
      <legend className='px-1 text-sm font-medium text-gray-700 dark:text-gray-200'>
        直播源组合搜索
      </legend>
      <p className='text-xs text-gray-500 dark:text-gray-400'>
        同组条件为“且”，不同组为“或”；支持“不包含”，忽略大小写和空白条件。
      </p>
      <div className='flex flex-wrap gap-2'>
        <button
          type='button'
          className={buttonClass}
          onClick={() =>
            onChange([
              [
                { ...emptyCondition(), keyword: '大陆' },
                { ...emptyCondition(), keyword: '直播' },
              ],
            ])
          }
        >
          大陆且直播
        </button>
        <button
          type='button'
          className={buttonClass}
          onClick={() =>
            onChange([
              [
                { ...emptyCondition(), keyword: '大陆' },
                {
                  ...emptyCondition(),
                  operator: 'not-contains',
                  keyword: '香港',
                },
              ],
            ])
          }
        >
          大陆不含香港
        </button>
        <button
          type='button'
          className={buttonClass}
          onClick={() =>
            onChange([
              [{ ...emptyCondition(), keyword: '大陆' }],
              [{ ...emptyCondition(), keyword: '香港' }],
            ])
          }
        >
          大陆或香港
        </button>
        <button
          type='button'
          className={buttonClass}
          onClick={() => onChange([[emptyCondition()]])}
        >
          清空搜索
        </button>
      </div>
      {groups.map((group, groupIndex) => (
        <div key={groupIndex}>
          {groupIndex > 0 && (
            <div className='mb-2 text-xs font-semibold text-green-600 dark:text-green-400'>
              或者
            </div>
          )}
          <div className='space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-900'>
            {group.map((condition, conditionIndex) => (
              <div
                key={conditionIndex}
                className='flex flex-wrap items-center gap-2'
              >
                <span className='w-8 text-xs text-gray-500'>
                  {conditionIndex === 0 ? '条件' : '且'}
                </span>
                <select
                  aria-label={`第 ${groupIndex + 1} 组第 ${conditionIndex + 1} 条搜索字段`}
                  className={inputClass}
                  value={condition.field}
                  onChange={(event) =>
                    updateCondition(groupIndex, conditionIndex, {
                      field: event.target
                        .value as LiveSourceSearchCondition['field'],
                    })
                  }
                >
                  <option value='name'>名称</option>
                  <option value='key'>Key</option>
                  <option value='url'>M3U 地址</option>
                  <option value='any'>名称 / Key / 地址</option>
                </select>
                <select
                  aria-label={`第 ${groupIndex + 1} 组第 ${conditionIndex + 1} 条匹配方式`}
                  className={inputClass}
                  value={condition.operator}
                  onChange={(event) =>
                    updateCondition(groupIndex, conditionIndex, {
                      operator: event.target
                        .value as LiveSourceSearchCondition['operator'],
                    })
                  }
                >
                  <option value='contains'>包含</option>
                  <option value='not-contains'>不包含</option>
                </select>
                <input
                  aria-label={`第 ${groupIndex + 1} 组第 ${conditionIndex + 1} 条关键词`}
                  className={`${inputClass} min-w-32 flex-1`}
                  placeholder='输入关键词进行模糊匹配'
                  value={condition.keyword}
                  onChange={(event) =>
                    updateCondition(groupIndex, conditionIndex, {
                      keyword: event.target.value,
                    })
                  }
                />
                <button
                  type='button'
                  className={buttonClass}
                  aria-label={`删除第 ${groupIndex + 1} 组第 ${conditionIndex + 1} 条条件`}
                  onClick={() => {
                    const nextGroups = groups
                      .map((items, index) =>
                        index === groupIndex
                          ? items.filter(
                              (_, itemIndex) => itemIndex !== conditionIndex,
                            )
                          : items,
                      )
                      .filter((items) => items.length > 0);
                    onChange(
                      nextGroups.length > 0 ? nextGroups : [[emptyCondition()]],
                    );
                  }}
                >
                  删除
                </button>
              </div>
            ))}
            <button
              type='button'
              className={buttonClass}
              onClick={() =>
                onChange(
                  groups.map((items, index) =>
                    index === groupIndex ? [...items, emptyCondition()] : items,
                  ),
                )
              }
            >
              ＋ 且条件
            </button>
          </div>
        </div>
      ))}
      <button
        type='button'
        className={buttonClass}
        onClick={() => onChange([...groups, [emptyCondition()]])}
      >
        ＋ 或者（新增条件组）
      </button>
    </fieldset>
  );
}
