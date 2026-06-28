export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-track">
      <div style={{ width: `${value}%` }} />
    </div>
  );
}
