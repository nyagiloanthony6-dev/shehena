import { regionsFor } from "@/lib/domain";
import { useStore } from "./store";

/** <option>s for a region select: the company's offices first, then every other place it can use
 *  (Tanzanian regions for road companies; international origins too for air cargo companies). */
export function RegionOptions({ offices, onlyOffices = false }: { offices: string[]; onlyOffices?: boolean }) {
  const { company } = useStore();
  const all = regionsFor(company);
  const mine = all.filter(([c]) => offices.includes(c)).sort((a, b) => offices.indexOf(a[0]) - offices.indexOf(b[0]));
  const rest = all.filter(([c]) => !offices.includes(c));
  if (onlyOffices || offices.length < 2) return <>{(onlyOffices ? mine : all).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</>;
  return (
    <>
      <optgroup label="Our offices">{mine.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</optgroup>
      <optgroup label="Other places">{rest.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</optgroup>
    </>
  );
}
