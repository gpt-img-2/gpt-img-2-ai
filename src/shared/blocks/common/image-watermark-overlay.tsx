import { cn } from '@/shared/lib/utils';

const WATERMARK_MARKS = ['top-[52%] left-[28%]'];

export function ImageWatermarkOverlay({
  label = 'https://image3.org',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 z-10 overflow-hidden',
        className
      )}
    >
      {WATERMARK_MARKS.map((positionClass) => (
        <span
          key={positionClass}
          className={cn(
            'absolute rotate-[-24deg] text-[11px] font-semibold whitespace-nowrap text-white/28 [text-shadow:0_1px_2px_rgba(0,0,0,0.34)] sm:text-xs',
            positionClass
          )}
        >
          {label}
        </span>
      ))}
      <div className="absolute top-3 left-3 rounded bg-black/24 px-2 py-1 text-[10px] font-semibold text-white/68 shadow-sm backdrop-blur-sm">
        {label}
      </div>
    </div>
  );
}
