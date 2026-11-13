// Pure transformations shared by the browser prototype and Node tests.
// No external API requests, interpolation, or missing-as-zero conversion.
export const FIRST_YEAR = 2001;
export const LAST_YEAR = 2026;

export function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeSchool(raw) {
  const numeric = ["season", "school_id", "completed_home_games", "reported_home_games",
    "missing_home_games", "zero_home_games", "total_reported_attendance",
    "average_reported_attendance", "cfbd_games", "supplemented_games",
    "partial_season", "covid_exception"];
  const row = { ...raw };
  for (const key of numeric) row[key] = numberOrNull(row[key]);
  return row;
}

export function normalizeConference(raw) {
  const numeric = ["season", "completed_home_games", "reported_home_games",
    "missing_home_games", "average_reported_attendance",
    "programs_with_reported_attendance", "partial_season", "covid_exception",
    "eligible_schools", "verified_schools", "coverage_complete"];
  const row = { ...raw };
  for (const key of numeric) row[key] = numberOrNull(row[key]);
  return row;
}

export function normalizeLocation(raw) {
  return { ...raw, school_id: numberOrNull(raw.school_id),
    latitude: numberOrNull(raw.latitude), longitude: numberOrNull(raw.longitude),
    capacity: numberOrNull(raw.capacity), source_year: numberOrNull(raw.source_year) };
}

// Capacity is an independently sourced 2026 venue reference, not a historical series.
// A missing or invalid capacity is unknown, never interpreted as zero.
export function capacityUtilization(row, venue) {
  if (Number(row?.season) !== 2026 || Number(venue?.source_year) !== 2026) return null;
  const capacity = numberOrNull(venue?.capacity);
  const average = numberOrNull(row?.average_reported_attendance);
  if (!Number.isInteger(capacity) || capacity <= 0 || average === null ||
      Number(row?.reported_home_games) <= 0) return null;
  return average / capacity * 100;
}

// Every school with reported 2026 attendance must have a capacity to publish
// a whole-conference percentage. Games provide the weights, not school counts.
export function conferenceCapacityUtilization(members, schoolIndex, locations) {
  let totalAttendance = 0, seatGameCapacity = 0, eligible = 0, covered = 0;
  for (const school of members) {
    const id = Number(school.school_id);
    const row = schoolIndex.get(`${id}:2026`);
    if (!row || Number(row.reported_home_games) <= 0 ||
        numberOrNull(row.average_reported_attendance) === null) continue;
    eligible++;
    const venue = locations.get(id);
    if (capacityUtilization(row, venue) === null) continue;
    const games = Number(row.reported_home_games);
    const cap = Number(venue.capacity);
    totalAttendance += numberOrNull(row.total_reported_attendance) ??
      Number(row.average_reported_attendance) * games;
    seatGameCapacity += cap * games;
    covered++;
  }
  return {percent: eligible && eligible === covered && seatGameCapacity > 0 ?
    totalAttendance / seatGameCapacity * 100 : null, covered, eligible};
}

export function isFullyComparable(row) {
  return !!row && (!isQuarantinedYear(row.season) || ["ncaa_official_verified","ncaa_early_primary","university_early_verified","kenn_secondary"].includes(row.attendance_source)) &&
    row.reported_home_games > 0 && row.missing_home_games === 0 &&
    row.partial_season === 0 && row.covid_exception === 0 &&
    row.average_reported_attendance !== null;
}

export function compareSchool(before, after, metric = "pct") {
  if (!isFullyComparable(before) || !isFullyComparable(after)) return null;
  const oldValue = before.average_reported_attendance;
  const newValue = after.average_reported_attendance;
  if (metric === "pct" && oldValue === 0) return null;
  const difference = newValue - oldValue;
  return { difference, value: metric === "pct" ? 100 * difference / oldValue : difference,
    before: oldValue, after: newValue };
}

// This intentionally compares two *different* periods: a completed 2025 annual
// average and a provisional 2026 YTD average. It is not matched-week YoY.
export function compareProvisionalYtd(before, after, metric = "pct") {
  if (Number(before?.season) !== 2025 || !isFullyComparable(before) ||
      Number(after?.season) !== 2026 || after.reported_home_games <= 0 ||
      after.missing_home_games !== 0 ||
      after.completed_home_games !== after.reported_home_games ||
      !after.attendance_source || after.attendance_source === "cfbd_2026_ytd" ||
      !Number.isFinite(after.average_reported_attendance)) return null;
  const oldValue = before.average_reported_attendance;
  const newValue = after.average_reported_attendance;
  if (metric === "pct" && oldValue === 0) return null;
  const difference = newValue - oldValue;
  return {difference, value:metric === "pct" ? 100*difference/oldValue : difference,
    before:oldValue, after:newValue, provisional:true};
}

export function schoolYearIndex(schools) {
  return new Map(schools.map(row => [`${row.school_id}:${row.season}`, row]));
}

// Verified name lineages, deliberately limited to the 2001–2026 data window.
// Source: Pac-12 conference history; American Athletic's institutional history.
// Do not infer other predecessor relationships (e.g. WAC → Mountain West).
export const CONFERENCE_LINEAGES = Object.freeze({
  "Pac-12": [
    {name:"Pac-10",from:2001,to:2010},
    {name:"Pac-12",from:2011,to:2026},
  ],
  "American Athletic": [
    {name:"Big East",from:2001,to:2012},
    {name:"American Athletic",from:2013,to:2026},
  ],
});

export function conferenceLineageNames(conference) {
  return CONFERENCE_LINEAGES[conference]?.map(group=>group.name) ?? null;
}

// Conference series are population-specific: the 2026 cohort follows today's
// programs backward; historical membership follows each season's league.
// Dense years deliberately leave a gap when a conference has no source row.
export function conferenceTrendSeries(currentRows, historicalRows, conference, mode, followLineage = false) {
  if (mode !== "fixed" && mode !== "historical") {
    throw new Error(`Unknown conference membership mode: ${mode}`);
  }
  const source = mode === "fixed" ? currentRows : historicalRows;
  const lineage = mode === "historical" && followLineage ? CONFERENCE_LINEAGES[conference] : null;
  const byYear = new Map(source.filter(row => {
    if (!lineage) return row.conference === conference;
    return lineage.some(group => row.conference === group.name &&
      row.season >= group.from && row.season <= group.to);
  }).map(row => [row.season, row]));
  return Array.from({length: LAST_YEAR - FIRST_YEAR + 1}, (_, i) => {
    const year = FIRST_YEAR + i;
    const row = byYear.get(year);
    return {
      year,
      conference: row?.conference ?? null,
      average: (["ncaa_official_verified","ncaa_early_primary_subset","early_annual_with_kenn"].includes(row?.attendance_source) || !isQuarantinedYear(year)) &&
        row?.reported_home_games > 0 && row?.coverage_complete !== 0
        ? row.average_reported_attendance : null,
      reported: row?.reported_home_games ?? 0,
      completed: row?.completed_home_games ?? 0,
      missing: row?.missing_home_games ?? 0,
      eligible: row?.eligible_schools ?? 0,
      verified: row?.verified_schools ?? 0,
      attendanceSource: row?.attendance_source ?? null,
      exception: !!(row?.covid_exception || row?.partial_season),
    };
  });
}

// Era groups are frozen to a single season's membership before comparing
// attendance, so realignment cannot masquerade as attendance growth or loss.
export const HISTORICAL_P5 = Object.freeze(["ACC","Big Ten","Big 12","Pac-10","Pac-12","SEC"]);
export const MODERN_P4 = Object.freeze(["ACC","Big Ten","Big 12","SEC"]);

export function powerGroupMemberIds(membershipRows, cohort, category, baseline, target, levelMode = false) {
  if(category !== "p5" && category !== "p4") throw new Error("Unknown power-conference category");
  const anchor = category === "p5" ? (levelMode ? target : baseline) : target;
  if(category === "p5" && (anchor < 2014 || anchor > 2023)) return [];
  if(category === "p4" && anchor < 2024) return [];
  const eligible = new Set(category === "p5" ? HISTORICAL_P5 : MODERN_P4);
  const validIds = new Set(cohort.map(s=>Number(s.school_id)));
  const members = anchor === 2026
    ? cohort.filter(s=>eligible.has(s.conference_2026))
    : membershipRows.filter(row=>Number(row.season) === anchor && eligible.has(row.historical_conference));
  return [...new Set(members.map(row=>Number(row.school_id)).filter(id=>validIds.has(id)))].sort((a,b)=>a-b);
}

// A positive minimum requires an observed ending-season home average. Zero
// preserves the existing unavailable markers and all unfiltered programs.
export function meetsMinimumAttendance(point, minimum = 0) {
  if (!(minimum > 0)) return true;
  const target = point.target;
  return target?.reported_home_games > 0 &&
    Number.isFinite(target.average_reported_attendance) &&
    target.average_reported_attendance >= minimum;
}

export function selectedPrograms(cohort, schoolIndex, locations, filters) {
  const points = [];
  for (const school of cohort) {
    if (filters.conference !== "All" && school.conference_2026 !== filters.conference) continue;
    const schoolId = Number(school.school_id);
    const baseline = schoolIndex.get(`${schoolId}:${filters.target === 2026 ? 2025 : filters.baseline}`);
    const target = schoolIndex.get(`${schoolId}:${filters.target}`);
    const geo = locations.get(schoolId);
    const comparison = filters.metric === "attendance" ? null :
      filters.target === 2026 ? compareProvisionalYtd(baseline,target,filters.metric) :
        compareSchool(baseline,target,filters.metric);
    const value = filters.metric === "attendance"
      ? target?.average_reported_attendance ?? null
      : comparison?.value ?? null;
    points.push({ ...school, school_id: schoolId, baseline, target, geo,
      comparison, value,
      mappable: !!geo && Number.isFinite(geo.longitude) && Number.isFinite(geo.latitude) });
  }
  return points;
}

export function coverageLabel(row) {
  if (!row || row.completed_home_games === 0) return "No FBS home-game data";
  if (row.reported_home_games === 0) return "Attendance unavailable";
  const total = `${row.reported_home_games} of ${row.completed_home_games} games reported`;
  if (row.partial_season) return `${total} · season in progress`;
  if (row.covid_exception) return `${total} · COVID-era season`;
  return total;
}

export function changeFormat(value, metric) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const magnitude = Math.abs(value);
  return sign + magnitude.toLocaleString("en-US", {
    maximumFractionDigits: metric === "pct" ? 1 : 0,
    minimumFractionDigits: metric === "pct" ? 1 : 0,
  }) + (metric === "pct" ? "%" : "");
}

export function attendanceFormat(value) {
  return value == null || !Number.isFinite(value) ? "N/A" :
    Math.round(value).toLocaleString("en-US");
}

// Fixed, filter-independent reference magnitudes for continuous marker scales.
// Higher values continue to produce larger symbols without a hard cutoff.
export const MARKER_SCALE_ANCHORS = Object.freeze({pct: 100, absolute: 50000, attendance: 110000});
export function markerRadius(value, metric) {
  if (value === null || !Number.isFinite(value)) return 4.3;
  const anchor = MARKER_SCALE_ANCHORS[metric];
  if (!anchor) throw new Error(`Unknown map metric: ${metric}`);
  return 5.2 + 8 * Math.sqrt(Math.abs(value) / anchor);
}

export function customGroupMembers(cohort, selectedIds) {
  const ids = new Set(selectedIds.map(Number));
  return cohort.filter(s => ids.has(Number(s.school_id)));
}

/** Resolve an annual benchmark's membership for the 2026 weekly view. */
export function weeklyBenchmarkSchoolIds(benchmark, school, cohort, groupIds) {
  if(benchmark.type==="custom")
    return customGroupMembers(cohort,groupIds).map(member=>Number(member.school_id));
  if(!["historical","fixed","selected"].includes(benchmark.type))
    throw new Error("Unknown 2026 weekly benchmark: "+benchmark.type);
  const conference=benchmark.type==="selected"?benchmark.conference:school.conference_2026;
  return cohort.filter(member=>member.conference_2026===conference)
    .map(member=>Number(member.school_id));
}

/**
 * Cumulative home attendance per reported game for any 2026 school cohort.
 * An absent game is never treated as zero; later weeks retain the last average.
 * The caller supplies the latest verified week so all comparison lines align.
 */
export function weeklyReportedGroupSeries(schoolIds, gamesBySchool, throughWeek) {
  const totalsByWeek=new Map();
  const ids=new Set(schoolIds.map(Number).filter(Number.isInteger));
  for(const id of ids){
    for(const game of gamesBySchool.get(id)||[]){
      const week=Number(game[0]),attendance=Number(game[3]);
      if(!Number.isInteger(week)||week<0||!Number.isFinite(attendance)||
        game[3]===null||game[3]===""||attendance<0)continue;
      let weekTotal=totalsByWeek.get(week);
      if(!weekTotal){weekTotal={attendance:0,games:0,schools:new Set()};totalsByWeek.set(week,weekTotal);}
      weekTotal.attendance+=attendance;
      weekTotal.games++;
      weekTotal.schools.add(id);
    }
  }
  if(!totalsByWeek.size)return [];
  const first=Math.min(...totalsByWeek.keys());
  const last=Math.max(first,Number.isInteger(throughWeek)?throughWeek:first);
  const reportedSchools=new Set();
  const points=[];
  let total=0,games=0;
  for(let week=first;week<=last;week++){
    const additions=totalsByWeek.get(week);
    if(additions){
      total+=additions.attendance;
      games+=additions.games;
      for(const id of additions.schools)reportedSchools.add(id);
    }
    points.push({week,average:total/games,reportedGames:games,reportingSchools:reportedSchools.size});
  }
  return points;
}

export function customGroupSeries(members, schoolIndex) {
  const ids = [...new Set(members.map(s => Number(s.school_id)))];
  return Array.from({length: LAST_YEAR-FIRST_YEAR+1},(_,i)=>{
    const year=FIRST_YEAR+i;
    const rows=ids.map(id=>schoolIndex.get(`${id}:${year}`));
    const eligible=ids.length;
    const verified=rows.filter(isFullyComparable).length;
    const complete=eligible>0 && verified===eligible;
    const known=rows.filter(Boolean);
    const reported=known.reduce((sum,r)=>sum+(r.reported_home_games||0),0);
    const completed=known.reduce((sum,r)=>sum+(r.completed_home_games||0),0);
    const missing=known.reduce((sum,r)=>sum+(r.missing_home_games||0),0);
    const total=known.reduce((sum,r)=>sum+(r.total_reported_attendance||0),0);
    return {year,average:complete && reported>0?total/reported:null,
      reported,completed,missing,eligible,verified,
      exception:known.some(r=>!!(r.partial_season||r.covid_exception))};
  });
}

/**
 * Source-quality quarantine based on the historical CFBD audit manifest.
 * These are source anomalies, not inferred replacement attendance values.
 * 2020 is intentionally excluded: zero crowds can be genuine restrictions.
 */
export const QUARANTINED_ATTENDANCE_YEARS = Object.freeze([2004, 2005, 2009, 2010, 2011]);
export function isQuarantinedYear(year) {
  return QUARANTINED_ATTENDANCE_YEARS.includes(Number(year));
}


/** An independent CFBD season drilldown, NOT the components of an NCAA average.
 * Home designation is CFBD's game designation, not NCAA's credited-home rule.
 * An ESPN/CFBD UTC kickoff date is not always the local calendar date.
 */
/**
 * Only explicit university-confirmed sellouts can receive a badge.
 * Attendance or listed venue capacity must never be used to infer sellouts.
 */
export function verifiedSelloutIndex(rows) {
  const index=new Map();
  for(const row of rows) {
    const season=Number(row.season), schoolId=Number(row.school_id);
    const gameId=Number(row.game_id), attendance=Number(row.attendance);
    const sourceUrl=String(row.source_url||"").trim();
    let parsedUrl;
    try {parsedUrl=new URL(sourceUrl);} catch {throw new Error("Invalid verified sellout source URL");}
    if(!Number.isInteger(season)||season<2001||!Number.isSafeInteger(schoolId)||schoolId<=0||
      !Number.isSafeInteger(gameId)||gameId<=0||!Number.isInteger(attendance)||attendance<=0||
      row.verification_status!=="official_confirmed"||parsedUrl.protocol!=="https:")
      throw new Error("Invalid official sellout annotation");
    const key=season+":"+schoolId+":"+gameId;
    if(index.has(key))throw new Error("Duplicate official sellout annotation: "+key);
    index.set(key,{attendance,sourceUrl});
  }
  return index;
}

export function verifiedSelloutForGame(index, game, schoolId, season) {
  const annotation=index.get(Number(season)+":"+Number(schoolId)+":"+Number(game.gameId));
  return annotation && annotation.attendance===game.attendance ? annotation : null;
}

export function cfbdHomeGameDetails(gameRows, schoolId, year) {
  if (isQuarantinedYear(year)) return [];
  // Game details intentionally cover regular-season home venues only.
  // Postseason appearances and neutral-site designations remain in raw CFBD records.
  return gameRows.filter(r =>
    Number(r.season) === Number(year) &&
    Number(r.completed) === 1 &&
    r.season_type === "regular" &&
    Number(r.home_team_id) === Number(schoolId) &&
    Number(r.neutral_site) === 0
  ).map(r => ({
    gameId:Number(r.game_id),
    opponent:r.away_team || "Unknown opponent",
    utcDate:String(r.start_date || "").slice(0,10),
    startDate:String(r.start_date || ""),
    attendance:numberOrNull(r.attendance),
    neutral:false,postseason:false,homeDesignated:true,
    designation:"Home",venue:r.venue || "",
  })).sort((a,b) => a.startDate.localeCompare(b.startDate) || a.gameId-b.gameId);
}

/**
 * Convert *only* nationally reconciled NCAA school-season records to the
 * existing chart row interface. CFBD is used solely for historical membership
 * and names; no CFBD attendance value is read by this transformation.
 *
 * Incomplete group-years are withheld rather than showing selected-school
 * averages as though the whole conference were present.
 */
export function buildNCAAAnnualChartData(annualRows, historicalMembership) {
  const identity = new Map(historicalMembership.map(r=>
    [String(r.season)+":"+String(r.school_id),r]));
  const years = new Set(annualRows.map(r=>Number(r.season)));
  const adjudicatedYears = new Set(annualRows.filter(r=>
    r.verification_status === "ncaa_official_adjudicated").map(r=>Number(r.season)));
  const annualByKey = new Map();
  const schools = [];
  for(const entry of annualRows) {
    if(!["ncaa_official_verified","ncaa_official_school_table_verified","ncaa_official_adjudicated"].includes(entry.verification_status))
      throw new Error("Unverified NCAA annual row blocked");
    const year = Number(entry.season), id=Number(entry.school_id);
    const key=year+":"+id;
    if(annualByKey.has(key)) throw new Error("Duplicate NCAA school-season "+key);
    const member=identity.get(key);
    if(!member) throw new Error("No season-specific football identity for "+key);
    const games=Number(entry.credited_home_games), total=Number(entry.credited_home_attendance_total);
    if(!Number.isInteger(games)||games<1||!Number.isInteger(total)||total<0)
      throw new Error("Invalid NCAA official annual data "+key);
    const average=total/games;
    const supplement=entry.verification_status==="ncaa_official_adjudicated";
    const exception=entry.exception_code||"";
    if(supplement) {
      const sourceSha={2006:"3a5cb7b4b88672daa948b14f842ac566eb794c56751ffe0379a92dde4e7efc10",
        2012:"e01a096861fad26de8189fe029eb96d90c7cd5f2d144de0c0f9c8c40c4b610c7"};
      if(entry.source_pdf_sha256!==sourceSha[year])
        throw new Error("Unrecognized NCAA adjudicated source "+key);
    }
    if(exception==="pdf_contains_stale_2011_duplicate") {
      if(!supplement||year!==2012||![98,264,265,275,277,2711,2751].includes(id)||
        !/^\d+\/\d+\/\d+$/.test(entry.original_2011_tuple||""))
        throw new Error("Invalid 2012 duplicate exception "+key);
    } else if(exception==="printed_average_divisor_error") {
      if(!supplement||year!==2006||id!==2433||games!==5||total!==111564||
        Number(entry.published_average)!==18594)
        throw new Error("Invalid 2006 NCAA published average exception "+key);
    } else if(exception) throw new Error("Unknown NCAA source exception "+key);
    if(Math.abs(average-Number(entry.published_average))>1.01 &&
      exception!=="printed_average_divisor_error")
      throw new Error("Invalid NCAA published average "+key);
    const row=normalizeSchool({
      ...member, season:year, school_id:id, completed_home_games:games,
      reported_home_games:games, missing_home_games:0, zero_home_games:0,
      total_reported_attendance:total,average_reported_attendance:average,
      cfbd_games:0,supplemented_games:0,partial_season:0,covid_exception:0,
      attendance_source:entry.verification_status,
      source_url:entry.source_url, source_edition:entry.source_edition,
      source_exception:exception, source_published_average:Number(entry.published_average)
    });
    annualByKey.set(key,row);
    schools.push(row);
  }
  function conferences(mode) {
    const bucket=new Map();
    for(const member of historicalMembership) {
      const year=Number(member.season), id=Number(member.school_id);
      if(!years.has(year)) continue;
      const conference=mode==="fixed"?member.conference_2026:member.historical_conference;
      if(!conference) continue;
      const key=year+":"+conference;
      if(!bucket.has(key))bucket.set(key,{season:year,conference,
        eligible_schools:0,verified_schools:0,reported_home_games:0,
        completed_home_games:0, missing_home_games:0,total:0});
      const item=bucket.get(key);
      item.eligible_schools++;
      const observation=annualByKey.get(year+":"+id);
      if(observation) {
        item.verified_schools++;
        item.reported_home_games+=observation.reported_home_games;
        item.completed_home_games+=observation.completed_home_games;
        item.total+=observation.total_reported_attendance;
      }
    }
    return [...bucket.values()].map(r=>normalizeConference({
      season:r.season,conference:r.conference,eligible_schools:r.eligible_schools,
      verified_schools:r.verified_schools,
      coverage_complete:Number(r.eligible_schools===r.verified_schools),
      reported_home_games:r.reported_home_games,
      completed_home_games:r.completed_home_games,
      missing_home_games:0,
      total_reported_attendance:r.total,
      average_reported_attendance:r.eligible_schools===r.verified_schools &&
        r.reported_home_games>0 ? r.total/r.reported_home_games : null,
      partial_season:0,covid_exception:0,
      attendance_source:r.season===2025 ? "ncaa_official_school_table_verified" :
        adjudicatedYears.has(r.season) ? "ncaa_official_adjudicated" : "ncaa_official_verified",
    }));
  }
  return {schools, currentConferenceRows:conferences("fixed"),
          historicalConferenceRows:conferences("historical"),
          verifiedYears:[...years].sort((a,b)=>a-b)};
}

/**
 * Early-year recovery is deliberately separate from the protected NCAA release.
 * Preserve original NCAA / university values where available. The owner has
 * accepted Kenn's archival transcription (D) for DISPLAY as a secondary source
 * in otherwise missing early years; D never becomes NCAA-verified.
 */
export function buildEarlyAnnualChartData(earlyRows, historicalMembership) {
  const allowed = new Set([
    "ncaa_original_report", "ncaa_archival_top50",
    "university_primary_verified", "archival_provisional"
  ]);
  const identity = new Set(historicalMembership.map(r=>String(r.season)+":"+String(r.school_id)));
  const seen = new Set();
  const selected = [];
  const source = new Map();
  for (const r of earlyRows) {
    const year=Number(r.season), id=Number(r.school_id), key=year+":"+id;
    const games=Number(r.credited_home_games);
    const total=Number(r.credited_home_attendance_total);
    const avg=Number(r.average_attendance);
    if (year<2001 || year>2004 || !identity.has(key) || seen.has(key) ||
        !allowed.has(r.source_classification) ||
        !Number.isInteger(games) || games<1 || !Number.isInteger(total) || total<0 ||
        !Number.isFinite(avg) || Math.abs(avg-total/games)>0.000001)
      throw new Error("Invalid early NCAA-era candidate "+key);
    seen.add(key);
    const verified=r.source_classification!=="archival_provisional";
    if (r.quality_category!==(verified
        ? r.source_classification==="university_primary_verified"?"B":"A"
        : "D") ||
        r.verification_status!==(verified?"verified":"provisional"))
      throw new Error("Misclassified early NCAA-era candidate "+key);
    if ((r.source_classification==="ncaa_original_report" && year!==2003) ||
        (r.source_classification==="ncaa_archival_top50" && year!==2004) ||
        (r.source_classification==="university_primary_verified" && ![2001,2002].includes(year)) ||
        (r.source_classification==="archival_provisional" &&
          r.source_url!=="https://kenn.com/blog/sports-attendance/ncaa-football-attendance/") ||
        !String(r.source_url).startsWith("https://"))
      throw new Error("Unsupported early source "+key);
    source.set(key, r.source_classification);
    selected.push({...r,exception_code:"",verification_status:"ncaa_official_verified",
      published_average:r.average_attendance});
  }
  // Reuse the season-accurate, game-weighted reducer without altering the
  // protected official NCAA dataset. The synthetic verified status above is
  // internal only; public-facing rows restore their true source classification.
  const result=buildNCAAAnnualChartData(selected,historicalMembership);
  const sourceFor=r=>source.get(r.season+":"+r.school_id);
  const memberByKey=new Map(historicalMembership.map(r=>
    [String(r.season)+":"+String(r.school_id),r]));
  const kennGroups=mode=>{
    const groups=new Set();
    for (const r of selected) {
      if(sourceFor(r)!=="archival_provisional") continue;
      const member=memberByKey.get(r.season+":"+r.school_id);
      const conf=mode==="fixed"?member.conference_2026:member.historical_conference;
      if(conf) groups.add(r.season+":"+conf);
    }
    return groups;
  };
  const currentKenn=kennGroups("fixed"),historicalKenn=kennGroups("historical");
  return {
    schools:result.schools.map(r=>({...r,
      attendance_source:sourceFor(r)==="archival_provisional"?"kenn_secondary":
        sourceFor(r)==="university_primary_verified"
          ?"university_early_verified":"ncaa_early_primary"})),
    currentConferenceRows:result.currentConferenceRows.map(r=>({...r,
      attendance_source:currentKenn.has(r.season+":"+r.conference)
        ?"early_annual_with_kenn":"ncaa_early_primary_subset"})),
    historicalConferenceRows:result.historicalConferenceRows.map(r=>({...r,
      attendance_source:historicalKenn.has(r.season+":"+r.conference)
        ?"early_annual_with_kenn":"ncaa_early_primary_subset"})),
    verifiedYears:result.verifiedYears
  };
}

/** Source-distinct 2021–2024 CFBD annual values; D/E are never chart inputs. */
export function buildCFBDGapAnnualChartData(gapRows,membership) {
  const identity=new Set(membership.map(r=>r.season+":"+r.school_id));
  const seen=new Set(),eligible=[];
  for(const r of gapRows) {
    const year=Number(r.season),id=Number(r.school_id),key=year+":"+id;
    if(seen.has(key)||!identity.has(key)||year<2021||year>2024)
      throw new Error("Invalid/duplicate historical CFBD identity "+key);
    seen.add(key);
    const state=r.verification_status;
    if(!["independently_verified","validation_supported","provisional","unavailable"].includes(state))
      throw new Error("Invalid CFBD source classification "+key);
    const games=Number(r.credited_home_games),total=Number(r.total_home_attendance),
      missing=Number(r.missing_attendance_games),zeros=Number(r.zero_attendance_games),
      review=Number(r.accounting_review_games),avg=Number(r.average_attendance);
    if(!Number.isInteger(games)||games<1||!Number.isInteger(total)||total<0||
      !Number.isInteger(missing)||missing<0||!Number.isInteger(zeros)||zeros<0||
      !Number.isInteger(review)||review<0||Math.abs(total/games-avg)>0.000001)
      throw new Error("Invalid CFBD annual arithmetic "+key);
    if(state==="independently_verified"||state==="validation_supported") {
      // Actual spectator-free Hawaii games (2021), independently corroborated by
      // its athletics department, are reported zeros—not missing attendance.
      const genuineClosedDoorZeros=year===2021&&id===62&&zeros===3&&
        r.zero_game_ids==="401310698|401310705|401310712"&&
        r.verification_reference?.startsWith("https://hawaiiathletics.com/");
      if(missing||(zeros&&!genuineClosedDoorZeros)||review||r.quality_category!==(state==="independently_verified"?"B":"C"))
        throw new Error("Unqualified CFBD annual value "+key);
      eligible.push({season:year,school_id:id,credited_home_games:games,
        credited_home_attendance_total:total,published_average:avg,
        verification_status:"ncaa_official_verified",
        source_url:r.source_url||"https://collegefootballdata.com/",
        source_edition:"CFBD game-derived annual 2021–2024"});
    }
  }
  // Reuse the historical-identity and game-weighted conference aggregator.
  // This synthetic, in-memory input never touches the approved NCAA release.
  const annual=buildNCAAAnnualChartData(eligible,membership);
  const source=new Map(gapRows.map(r=>[r.season+":"+r.school_id,r.verification_status]));
  return {
    schools:annual.schools.map(r=>({...r,attendance_source:
      source.get(r.season+":"+r.school_id)==="independently_verified"
        ?"cfbd_derived_independently_verified":"cfbd_derived_validation_supported"})),
    currentConferenceRows:annual.currentConferenceRows.map(r=>({...r,attendance_source:"cfbd_derived_annual"})),
    historicalConferenceRows:annual.historicalConferenceRows.map(r=>({...r,attendance_source:"cfbd_derived_annual"})),
    verifiedYears:annual.verifiedYears,
  };
}

// Display-only classification; raw data and comparisons are never rounded away.
// An "essentially unchanged" glyph means less than 1% of baseline attendance.
// Visual tuning: 0 = perfectly straight; 0.015 = barely curved; 0.025 = subtle; 0.05 = more pronounced.
// This is the sideways bow at the shaft midpoint as a fraction of shaft length.
export const MAP_ARROW_BEND = 0.025;
export const MAP_NEUTRAL_PCT = 1;
export const MAP_NEUTRAL_GLYPH_PATH = "M-5,0L5,0";
export const MAP_NEUTRAL_TIP_PATH = "M0.5,-3.2L5,0L0.5,3.2";
export function isMapNeutral(value, metric = "pct", baselineAverage = null) {
  if (value === null || !Number.isFinite(value)) return false;
  if (metric === "pct") return Math.abs(value) < MAP_NEUTRAL_PCT;
  if (metric === "absolute") return value === 0 ||
    (Number.isFinite(baselineAverage) && baselineAverage > 0 &&
      100 * Math.abs(value) / baselineAverage < MAP_NEUTRAL_PCT);
  throw new Error("Near-flat threshold applies to change metrics only");
}

// Very slightly bowed open-chevron arrows: overall tilt encodes direction, length encodes magnitude.
// Small changes get a genuine small mark rather than the old 12px floor.
export function arrowGeometry(value, metric = "pct", baselineAverage = null) {
  if (value === null || !Number.isFinite(value)) return null;
  if (metric !== "pct" && metric !== "absolute") throw new Error("Arrows encode change only");
  const strokeWidth = 1.4;
  if (isMapNeutral(value, metric, baselineAverage))
    return {path:MAP_NEUTRAL_GLYPH_PATH,tipPath:MAP_NEUTRAL_TIP_PATH,
      hitSegments:[[-5,0,5,0],[.5,-3.2,5,0],[5,0,.5,3.2]],
      length:10,angleDeg:0,strokeWidth:1.5,magnitude:0,direction:0};
  const anchor = MARKER_SCALE_ANCHORS[metric];
  // Log compression keeps extreme arrows legible while preserving differences
  // even beyond the old 100% / 50,000-fan reference points.
  const magnitude = Math.log1p(4 * Math.abs(value) / anchor) / Math.log(5);
  const length = 10 + 24 * magnitude;
  const angleDeg = 35;
  const angle = angleDeg * Math.PI / 180;
  const direction = value > 0 ? 1 : -1;
  const ux = Math.cos(angle), uy = -direction * Math.sin(angle);
  const tailX = -length * ux / 2, tailY = -length * uy / 2;
  const tipX = length * ux / 2, tipY = length * uy / 2;
  const headLength = Math.min(5.6, length * .38), headHalfWidth = Math.min(3.6, length * .24);
  const baseX = tipX - headLength * ux, baseY = tipY - headLength * uy;
  const leftX = baseX - headHalfWidth * uy, leftY = baseY + headHalfWidth * ux;
  const rightX = baseX + headHalfWidth * uy, rightY = baseY - headHalfWidth * ux;
  const point = (x,y) => `${x.toFixed(2)},${y.toFixed(2)}`;
  // The single knob above controls a small perpendicular bow; endpoints and overall angle stay fixed.
  // Reverse the bow with the direction so rises and falls mirror each other.
  const bendPx = length * MAP_ARROW_BEND;
  const bowX = -uy * bendPx * direction, bowY = ux * bendPx * direction;
  const midX = (tailX + tipX) / 2 + bowX, midY = (tailY + tipY) / 2 + bowY;
  const controlX = (tailX + tipX) / 2 + 2 * bowX;
  const controlY = (tailY + tipY) / 2 + 2 * bowY;
  const path = MAP_ARROW_BEND === 0
    ? `M${point(tailX,tailY)}L${point(tipX,tipY)}`
    : `M${point(tailX,tailY)}Q${point(controlX,controlY)} ${point(tipX,tipY)}`;
  // Keep the chevron open; a closed triangle at this size reads as a thick slash.
  const tipPath = `M${point(leftX,leftY)}L${point(tipX,tipY)}L${point(rightX,rightY)}`;
  return {path,tipPath,
    hitSegments:[[tailX,tailY,midX,midY],[midX,midY,tipX,tipY],
      [leftX,leftY,tipX,tipY],[tipX,tipY,rightX,rightY]],
    length,angleDeg,strokeWidth,magnitude,direction,bendPx};
}

export function sourceLabel(source) {
  if (source === "kenn_secondary" || source === "early_annual_with_kenn") return "Kenn · secondary";
  if (source === "university_early_verified") return "University record";
  if (source === "ncaa_early_primary" || source === "ncaa_early_primary_subset" || source?.startsWith("ncaa_official")) return "NCAA";
  if (source === "official_conference_2026_pilot") return "Conference · YTD";
  if (source === "official_reports_2026_ytd") return "Official reports · YTD";
  if (source === "official_school_2026") return "University · YTD";
  if (source === "cfbd_2026_ytd") return "CFBD · YTD";
  if (source?.startsWith("cfbd_derived")) return "CFBD-derived";
  return "Unavailable";
}

// Seasonal membership is looked up independently each year, never inferred from modern affiliation.
export function historicalConferenceSchoolSeries(schoolId, memberships, historicalConferenceRows) {
  const membershipsByYear = new Map(memberships.filter(r => Number(r.school_id) === Number(schoolId))
    .map(r => [Number(r.season), r.historical_conference]));
  const rows = new Map(historicalConferenceRows.map(r => [`${r.season}:${r.conference}`,r]));
  return Array.from({length: LAST_YEAR - FIRST_YEAR + 1}, (_,i) => {
    const year = FIRST_YEAR + i;
    const conference = membershipsByYear.get(year) || null;
    const row = rows.get(`${year}:${conference}`);
    const eligible = row?.eligible_schools ?? 0, verified = row?.verified_schools ?? 0;
    const valid = row && row.reported_home_games > 0 && row.coverage_complete !== 0 &&
      (["ncaa_official_verified","ncaa_official_adjudicated","ncaa_official_school_table_verified",
        "ncaa_early_primary_subset","early_annual_with_kenn","cfbd_derived_annual"].includes(row.attendance_source));
    return {year, conference, average:valid ? row.average_reported_attendance : null,
      reported:row?.reported_home_games ?? 0, completed:row?.completed_home_games ?? 0,
      missing:row?.missing_home_games ?? 0, eligible, verified,
      attendanceSource:row?.attendance_source ?? null, exception: false};
  });
}

// 2026 is a provisional CFBD level, not an NCAA credited-home annual series.
export function aggregate2026Ytd(gameRows, cohort, asOf = null) {
  const latest = gameRows.reduce((n,r) => Math.max(n,Date.parse(r.retrieved_at)||0),0);
  const cutoff = asOf ? Date.parse(asOf) : latest;
  if (!Number.isFinite(cutoff) || cutoff <= 0) throw new Error("2026 snapshot missing a valid retrieval time");
  const rows = new Map(cohort.map(s => [Number(s.school_id), {
    school_id:Number(s.school_id), school_name:s.school_name, season:2026,
    completed_home_games:0, reported_home_games:0, missing_home_games:0,
    zero_home_games:0, total_reported_attendance:0, average_reported_attendance:null,
    partial_season:1, covid_exception:0, attendance_source:"cfbd_2026_ytd",
    source_url:"https://collegefootballdata.com/", data_through:new Date(latest).toISOString(),
  }]));
  const exceptions = [];
  for (const game of gameRows) {
    if (Number(game.season) !== 2026) throw new Error("Unexpected season in 2026 YTD snapshot");
    if (Number(game.completed) !== 1 || game.season_type !== "regular" ||
      Number(game.neutral_site) !== 0 || game.home_classification !== "fbs") continue;
    const kickoff = Date.parse(game.start_date);
    if (!Number.isFinite(kickoff) || kickoff > cutoff) continue;
    const row = rows.get(Number(game.home_team_id));
    if (!row) continue;
    row.completed_home_games++;
    const attendance = numberOrNull(game.attendance);
    if (attendance === null) { row.missing_home_games++; continue; }
    if (attendance < 0 || !Number.isInteger(attendance)) {
      exceptions.push({gameId:game.game_id,reason:"invalid attendance"}); row.missing_home_games++; continue;
    }
    row.reported_home_games++;
    row.total_reported_attendance += attendance;
    if (attendance === 0) row.zero_home_games++;
  }
  for (const row of rows.values()) {
    if (row.reported_home_games) row.average_reported_attendance =
      row.total_reported_attendance / row.reported_home_games;
  }
  return {rows:[...rows.values()], dataThrough:new Date(latest).toISOString(),exceptions};
}


/**
 * Compute a provisional 2026 cohort benchmark from reported home-game crowds.
 * Withhold the endpoint unless every member has a reconciled, fully reported
 * official home-game record. In particular, a CFBD null is never a zero.
 */
export function conference2026Ytd(members, schoolIndex) {
  const ids = [...new Set(members.map(r => Number(r.school_id)))].filter(Number.isInteger);
  const rows = ids.map(id => schoolIndex.get(id+":2026"));
  const eligible=ids.length;
  const verified=rows.filter(r => r && r.reported_home_games>0 &&
    r.missing_home_games===0 && r.completed_home_games===r.reported_home_games &&
    r.attendance_source && r.attendance_source!=="cfbd_2026_ytd").length;
  const reported=rows.reduce((n,r)=>n+(r?.reported_home_games || 0),0);
  const completed=rows.reduce((n,r)=>n+(r?.completed_home_games || 0),0);
  const missing=rows.reduce((n,r)=>n+(r?.missing_home_games || 0),0);
  const total=rows.reduce((n,r)=>n+(r?.total_reported_attendance || 0),0);
  return {year:2026,average:eligible>0 && verified===eligible && reported>0 ? total/reported:null,
    reported,completed,missing,eligible,verified,
    attendanceSource:"official_reports_2026_ytd",exception:true};
}

/**
 * Layer a *separate* verified 2026 conference pilot over null CFBD attendance.
 * Do not mutate, rewrite, or claim the original CFBD games were supplemented.
 */
export function overlay2026OfficialGames(cfbdGames, officialGames) {
  const byId = new Map();
  for (const row of officialGames) {
    const key = String(row.game_id);
    const value = numberOrNull(row.attendance);
    if (!Number.isInteger(value) || value <= 0 || byId.has(key))
      throw new Error("Invalid or duplicate official 2026 pilot game");
    byId.set(key, row);
  }
  return cfbdGames.map(game => {
    if (Number(game.season)!==2026 || numberOrNull(game.attendance)!==null) return game;
    const official = byId.get(String(game.game_id));
    if (!official) return game;
    if (Number(official.school_id)!==Number(game.home_team_id) ||
        Number(game.completed)!==1 || game.season_type!=="regular" ||
        Number(game.neutral_site)!==0)
      throw new Error("Official pilot game does not match qualifying CFBD schedule");
    return {...game, attendance:String(official.attendance),
      attendance_source:official.source_type || "official_conference_2026_pilot", source_url:official.source_url};
  });
}

/** Use each school's latest cumulative weekly row, never sum weekly averages. */
export function merge2026OfficialWeekly(cfbdYtd, officialWeekly, officialGames) {
  const latest = new Map();
  for (const raw of officialWeekly) {
    const id = Number(raw.school_id), week = Number(raw.week);
    if (!Number.isInteger(id) || !Number.isInteger(week) || week<0) throw new Error("Invalid pilot weekly key");
    if (!latest.has(id) || week>Number(latest.get(id).week)) latest.set(id,raw);
  }
  const bySchoolSource = new Map(officialGames.map(row => [Number(row.school_id),row.source_url]));
  const rows = cfbdYtd.rows.map(row=>{
    const weekly = latest.get(Number(row.school_id));
    if (!weekly) return row;
    const completed = numberOrNull(weekly.completed_home_games);
    const reported = numberOrNull(weekly.reported_home_games);
    const missing = numberOrNull(weekly.missing_home_games);
    const total = numberOrNull(weekly.total_reported_attendance);
    if (![completed,reported,missing,total].every(Number.isInteger) ||
        completed !== row.completed_home_games ||
        reported+missing!==completed || total<0 || reported>completed)
      throw new Error("2026 official weekly coverage fails CFBD schedule reconciliation");
    const average = reported ? total/reported : null;
    const published = numberOrNull(weekly.average_reported_attendance);
    if (average!==null && (published===null || Math.abs(average-published)>.011))
      throw new Error("2026 official weekly average arithmetic mismatch");
    return {...row,reported_home_games:reported,missing_home_games:missing,
      total_reported_attendance:total,average_reported_attendance:average,
      attendance_source:weekly.attendance_source || "official_conference_2026_pilot",
      source_url:bySchoolSource.get(Number(row.school_id)) ?? null,
      data_through:weekly.data_through};
  });
  const updated = officialWeekly.reduce((latest,row) => {
    const ms=Date.parse(row.data_through);
    return Number.isFinite(ms)&&ms>latest?ms:latest;
  },Date.parse(cfbdYtd.dataThrough));
  return { ...cfbdYtd, rows, dataThrough:new Date(updated).toISOString() };
}
