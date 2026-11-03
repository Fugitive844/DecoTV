import type { IpLocation } from '@/lib/ip-location.types';

export function IpLocationHeaders({
  className = 'px-3 py-2',
  ipLabel = 'IP',
}: {
  className?: string;
  ipLabel?: string;
}) {
  return (
    <>
      {[ipLabel, '国家', '地区', '运营商'].map((label) => (
        <th key={label} className={`${className} whitespace-nowrap`}>
          {label}
        </th>
      ))}
    </>
  );
}

export default function IpLocationCells({
  location,
  className = 'px-3 py-2',
  onIpClick,
  hidden = false,
}: {
  location?: IpLocation | null;
  className?: string;
  onIpClick?: () => void;
  hidden?: boolean;
}) {
  const empty = hidden ? '—' : location ? '未知' : '未记录';
  const cellClass = `${className} whitespace-nowrap`;
  return (
    <>
      <td className={cellClass}>
        {onIpClick ? (
          <button
            onClick={onIpClick}
            title='查看 IP 历史'
            aria-label={`查看历史：${location?.ip || '未记录'}`}
            className='inline-flex items-center gap-2 text-blue-600 hover:underline dark:text-blue-400'
          >
            <span className='font-mono'>{location?.ip || empty}</span>
            <span className='text-xs'>历史</span>
          </button>
        ) : (
          <span className='font-mono'>{location?.ip || empty}</span>
        )}
        {location?.source === 'nginx-backfill' && (
          <span
            className='ml-2 text-xs text-amber-600'
            title='历史日志回填：依据 Nginx 请求时间推断，使用当前地理数据库解析'
          >
            回填
          </span>
        )}
      </td>
      <td className={cellClass}>{location?.country || empty}</td>
      <td className={cellClass}>
        {[location?.region, location?.city].filter(Boolean).join(' · ') ||
          empty}
      </td>
      <td
        className={cellClass}
        title={[
          location?.organization,
          location?.asn ? `AS${location.asn}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      >
        {location?.isp || empty}
      </td>
    </>
  );
}
