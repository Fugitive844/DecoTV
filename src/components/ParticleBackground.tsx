export default function ParticleBackground() {
  // 使用静态背景，避免空闲页面持续绘制大面积模糊、混合图层和 SVG 噪点。
  return (
    <div className='fixed inset-0 z-[-1] overflow-hidden' aria-hidden='true'>
      <div className='absolute inset-0 bg-linear-to-b from-neutral-950 via-slate-950 to-black dark:from-neutral-950 dark:via-slate-950 dark:to-black' />
      <div className='absolute inset-0 bg-linear-to-b from-slate-100 via-gray-50 to-white dark:opacity-0 transition-opacity duration-500' />
    </div>
  );
}
