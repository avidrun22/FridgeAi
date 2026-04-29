// Compact +/- day stepper. The number is a real input, so users can also
// type a value directly (e.g. for a 90-day shelf life — faster than tapping
// + ninety times). The +/- buttons just adjust the input value.
export default function DayStepper({ value, onChange, min = 0, max = 365, label, suffix = "days" }) {
  const set = (v) => {
    const num = Number.isFinite(v) ? v : parseInt(v, 10);
    if (!Number.isFinite(num)) return;
    onChange?.(Math.max(min, Math.min(max, num)));
  };
  return (
    <div className="mb-3">
      {label && <label className="block text-xs text-textSoft mb-1.5 font-medium uppercase tracking-wide">{label}</label>}
      <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => set(value - 1)}
          className={`w-11 h-11 flex items-center justify-center text-lg flex-shrink-0 ${value <= min ? "text-muted" : "text-accent hover:bg-bg"}`}
          disabled={value <= min}
          aria-label="Decrease"
        >−</button>
        <div className="flex-1 flex flex-col items-center py-1 px-2 border-l border-r border-border">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") return; // allow temp-empty while typing
              set(parseInt(v, 10));
            }}
            onBlur={(e) => {
              if (e.target.value === "") set(min);
            }}
            className="w-full text-center text-base font-bold text-text bg-transparent border-0 outline-none p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[10px] text-textSoft -mt-0.5 pointer-events-none">{suffix}</span>
        </div>
        <button
          type="button"
          onClick={() => set(value + 1)}
          className={`w-11 h-11 flex items-center justify-center text-lg flex-shrink-0 ${value >= max ? "text-muted" : "text-accent hover:bg-bg"}`}
          disabled={value >= max}
          aria-label="Increase"
        >+</button>
      </div>
    </div>
  );
}
