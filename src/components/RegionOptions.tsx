import { REGIONS } from "@/lib/domain";

/** <option>s for a region select: the company's offices first, then every other region. */
export function RegionOptions({ offices, onlyOffices = false }: { offices: string[]; onlyOffices?: boolean }) {
  const mine = REGIONS.filter(([c]) => offices.includes(c)).sort((a, b) => offices.indexOf(a[0]) - offices.indexOf(b[0]));
  const rest = REGIONS.filter(([c]) => !offices.includes(c));
  if (onlyOffices || offices.length < 2) return <>{(onlyOffices ? mine : REGIONS).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</>;
  return (
    <>
      <optgroup label="Our offices">{mine.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</optgroup>
      <optgroup label="Other regions">{rest.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</optgroup>
    </>
  );
}
