// Human-verified context for attendance comparisons. Never modifies reported attendance.
const KINDS = new Set(["attendance_restriction","temporary_venue","venue_transition","capacity_change"]);

export function normalizeDisruption(row) {
  const school_id=Number(row.school_id), from_year=Number(row.from_year), to_year=Number(row.to_year);
  if(!Number.isInteger(school_id)||school_id<=0 || !Number.isInteger(from_year) ||
     !Number.isInteger(to_year)||from_year>to_year||from_year<2001||to_year>2026 ||
     !KINDS.has(row.kind)||!row.title||!row.description||
     !/^https:\/\//.test(row.source_url||""))
    throw new Error("Invalid source-verified attendance disruption record");
  return {school_id,from_year,to_year,kind:row.kind,title:row.title,
    description:row.description,source_url:row.source_url};
}

// Annual historical chart: show the context for the year actually plotted.
export function disruptionsInSeason(records,schoolId,year) {
  const id=Number(schoolId), season=Number(year);
  return records.filter(d=>d.school_id===id&&d.from_year<=season&&d.to_year>=season);
}

// Mark only a documented onset in historical charts, avoiding a marker on every year of an ongoing venue change.
export function disruptionsStarting(records,schoolId,year) {
  const id=Number(schoolId), season=Number(year);
  return records.filter(d=>d.school_id===id&&d.from_year===season);
}

// Compare endpoints, rather than assuming every temporary disruption between them alters the comparison.
// Temporary venues and restrictions matter when either endpoint falls inside the affected interval.
// Lasting venue / capacity changes matter when the interval crosses their effective season.
export function disruptionsForComparison(records,schoolId,fromYear,toYear) {
  const id=Number(schoolId), from=Number(fromYear), to=Number(toYear);
  if(!Number.isFinite(from)||!Number.isFinite(to))return [];
  if(from===to)return disruptionsInSeason(records,id,to);
  if(to<from)return [];
  return records.filter(d=>{
    if(d.school_id!==id)return false;
    if(d.kind==="temporary_venue"||d.kind==="attendance_restriction")
      return (from>=d.from_year&&from<=d.to_year)||(to>=d.from_year&&to<=d.to_year);
    return d.from_year>from&&d.from_year<=to;
  });
}
