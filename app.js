import {
  FIRST_YEAR, LAST_YEAR, normalizeSchool, normalizeConference, normalizeLocation,
  schoolYearIndex, selectedPrograms, powerGroupMemberIds, compareSchool, compareProvisionalYtd, conferenceTrendSeries, conferenceLineageNames,
  changeFormat, attendanceFormat, markerRadius, cfbdHomeGameDetails, buildNCAAAnnualChartData, buildCFBDGapAnnualChartData, buildEarlyAnnualChartData,
  arrowGeometry, isMapNeutral, MAP_NEUTRAL_PCT, sourceLabel, historicalConferenceSchoolSeries, aggregate2026Ytd, customGroupMembers, customGroupSeries,
  overlay2026OfficialGames, merge2026OfficialWeekly, conference2026Ytd,
  verifiedSelloutIndex, verifiedSelloutForGame, weeklyReportedGroupSeries, weeklyBenchmarkSchoolIds,
} from "./model.mjs";
import {teamPalette, conferenceColor, colorsTooSimilar} from "./palettes.mjs";
import {normalizeDisruption, disruptionsInSeason, disruptionsStarting, disruptionsForComparison} from "./disruptions.mjs";
import {suggestedComparisonsFor} from "./suggested-comparisons.mjs?v=d4db359838be";

const d3 = window.d3;
const topojson = window.topojson;
const PUBLIC_BUILD = window.__PUBLIC_ATTENDANCE_BUILD__ === true;

const state = { baseline: 2019, target: 2025, metric: "pct", conference: "All", mapFocus: "all", schoolId: null,
  schoolBId: null, selectedConference: "ACC",
  groupIds: [], moverType:"school", keyStatsMembership:"fixed",
  benchmarks:[{key:"historical",type:"historical"}] };
const $ = id => document.getElementById(id);
const themeColor = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function formattedChange(value,metric) {
  // Keep the underlying sign when a tiny nonzero percentage rounds to ±0.0%.
  return changeFormat(value,metric);
}
function fansDelta(value) {
  if(Number.isFinite(value) && value!==0 && Math.abs(value)<2 && !Number.isInteger(value))
    return (value>0?"+":"−")+Math.abs(value).toFixed(2);
  return changeFormat(value,"absolute");
}
function mapGeometry(point) {
  return point.geometry ?? arrowGeometry(point.value, state.metric, point.comparison?.before);
}
// Enlarge change arrows on narrow screens while preserving their relative lengths,
// geographic anchors and inverse zoom scaling. Level-mode circles are unchanged.
const narrowMapQuery=window.matchMedia("(max-width:620px)");
function mapMarkerScale() {
  return state.metric!=="attendance" && narrowMapQuery.matches ? 1.4 : 1;
}
function mapMarkerTransform(point) {
  return `translate(${point.coordinates[0]},${point.coordinates[1]}) scale(${mapMarkerScale()/mapZoomScale})`;
}
function mapNeutral(point) {
  return state.metric !== "attendance" &&
    isMapNeutral(point.value, state.metric, point.comparison?.before);
}


let cohort = [];
let schools = [];
let conferenceRows = [];
let historicalConferenceRows = [];
let schoolIndex = new Map();
let candidateIndex = new Map();
let locations = new Map();
let verifiedCapacities = new Map();
let verifiedAnnualYears = new Set();
let membershipRows = [];
let ytdThrough = null;
function ytdDataThroughLabel() {
  if (!ytdThrough) return null;
  const date=new Date(ytdThrough);
  return Number.isNaN(date.getTime())?null:date.toLocaleDateString("en-US",{
    month:"short",day:"numeric",year:"numeric",timeZone:"UTC"
  });
}
let pilotGames = [];
let pilotWeekly = [];
let publicWeeklyThroughWeek = 0;
let publicOfficialGames = new Map();
let weeklySeriesSchoolId = null;
const hiddenWeeklySeries = new Set();
let disruptionRows = [];
let verifiedSellouts = new Map();
let availableYears = [];
let projection, viewport, zoom, stateMap;
let mapZoomScale = 1;
let hoveredPlotPoints = [];
let currentHoverSchoolId = null;
let currentPoints = [];
let mapPoints = [];
const gameSeasonCache = new Map();
let gameRequestId = 0;

function option(value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function renderGroupChips() {
  const container = $("groupChips");
  container.replaceChildren();
  for (const id of state.groupIds) {
    const school = cohort.find(s => Number(s.school_id) === id);
    if (!school) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-chip";
    button.textContent = `${school.school_name} ×`;
    button.setAttribute("aria-label", `Remove ${school.school_name} from custom group`);
    button.addEventListener("click", () => {
      state.groupIds = state.groupIds.filter(x => x !== id);
      renderGroupChips(); render();
    });
    container.append(button);
  }
  if (!state.groupIds.length) {
    const note = document.createElement("span"); note.textContent = "Add schools to compare their game-weighted average.";
    note.className = "trend-coverage-note"; container.append(note);
  }
  const mapChips=$("mapGroupChips");
  if (mapChips) {
    mapChips.replaceChildren();
    for (const id of state.groupIds) {
      const school=cohort.find(s=>Number(s.school_id)===id);
      if(!school)continue;
      const chip=document.createElement("button");
      chip.type="button";chip.className="group-chip";
      chip.textContent=school.school_name+" ×";
      chip.setAttribute("aria-label","Remove "+school.school_name+" from map group");
      chip.onclick=()=>{state.groupIds=state.groupIds.filter(x=>x!==id);renderGroupChips();render();};
      mapChips.append(chip);
    }
    if (!state.groupIds.length)mapChips.append(document.createTextNode("No schools added"));
  }
}

function benchmarkColor(benchmark, school) {
  if (benchmark.type==="custom") return "#75618D";
  if (benchmark.type==="historical" || benchmark.type==="fixed")
    return conferenceColor(school.conference_2026);
  return conferenceColor(benchmark.conference);
}
function swatchGradient(colors) {
  const shades=[...new Set(colors.filter(Boolean))];
  if (!shades.length) return "#52636A";
  if (shades.length===1) return shades[0];
  return "linear-gradient(90deg,"+shades.map((color,i)=>
    color+" "+(i/shades.length*100)+"%, "+color+" "+((i+1)/shades.length*100)+"%").join(",")+")";
}
function seriesSwatch(item) {
  if (!item.benchmark)
    return item.color;
  if (item.type==="historical" || (item.type==="selected" && item.followLineage))
    return swatchGradient(item.data.filter(d=>d.average!==null && d.conference).map(d=>conferenceColor(d.conference)));
  return item.color;
}
function seriesPointColor(item, observation) {
  return item.benchmark && (item.type==="historical" ||
    (item.type==="selected" && item.followLineage)) && observation?.conference ?
    conferenceColor(observation.conference) : item.color;
}
function benchmarkName(benchmark, school) {
  if (benchmark.type==="historical") return "School's historical conference";
  if (benchmark.type==="fixed") return "2026 "+school.conference_2026+" schools";
  if (benchmark.type==="custom") return "Custom group";
  const lineage = benchmark.followLineage ? conferenceLineageNames(benchmark.conference) : null;
  return (lineage ? lineage.join(" → ") : benchmark.conference)+" historical members";
}
function benchmarkFromControls() {
  const type=$("conferenceMode").value;
  const conference=type==="selected"?$("comparisonConference").value:null;
  const followLineage=type==="selected" && $("conferenceLineage").checked;
  const key=type==="selected"?"selected:"+conference+":"+(followLineage?"lineage":"literal"):type;
  return {key,type,conference,followLineage};
}
function syncBenchmarkDraftControls() {
  const type=$("conferenceMode").value,isSelected=type==="selected";
  $("selectedConferenceField").hidden=!isSelected;
  $("lineageControl").hidden=!isSelected || !conferenceLineageNames($("comparisonConference").value);
  $("conferenceLineage").disabled=$("lineageControl").hidden;
  $("lineageHelp").textContent=isSelected?(conferenceLineageNames($("comparisonConference").value)||[]).join(" → "):"";
  $("customGroupControls").hidden=type!=="custom" && !state.benchmarks.some(b=>b.type==="custom");
  $("addBenchmark").disabled=state.benchmarks.length>=3;
  $("addBenchmark").textContent=state.benchmarks.length>=3?"3 benchmarks max":"+ Add another benchmark";
  if(state.benchmarks.length>=3)$("additionalBenchmarkField").hidden=true;
}
function changePrimaryBenchmark() {
  const candidate=benchmarkFromControls();
  const extra=state.benchmarks.slice(1).filter(entry=>entry.key!==candidate.key);
  state.benchmarks=[candidate,...extra];
  hiddenWeeklySeries.clear();
  refreshSelectedSeriesCharts();
}
function addAnotherBenchmark(value) {
  if(!value || state.benchmarks.length>=3)return;
  const candidate=value.startsWith("selected:")?
    {key:value,type:"selected",conference:value.slice(9,-8),followLineage:false}:
    {key:value,type:value,conference:null,followLineage:false};
  if(!state.benchmarks.some(b=>b.key===candidate.key))
    state.benchmarks.push(candidate);
  $("additionalBenchmarkField").hidden=true;
  $("additionalBenchmarkSelect").value="";
  hiddenWeeklySeries.clear();
  refreshSelectedSeriesCharts();
}
function renderBenchmarkChips(school) {
  const container=$("benchmarkChips");container.replaceChildren();
  state.benchmarks.forEach((benchmark,i)=>{
    const element=document.createElement(i===0?"span":"button");
    if(i!==0) {
      element.type="button";
      element.setAttribute("aria-label","Remove "+benchmarkName(benchmark,school));
    }
    element.className="benchmark-chip"+(i===0?" primary-benchmark":"");
    const swatch=document.createElement("i");
    swatch.style.background=benchmark.type==="historical" ?
      swatchGradient(membershipRows.filter(r=>Number(r.school_id)===state.schoolId)
        .map(r=>conferenceColor(r.historical_conference))) : benchmarkColor(benchmark,school);
    const label=document.createElement("span");
    label.textContent=benchmarkName(benchmark,school)+(i===0?" · primary":" ×");
    element.append(swatch,label);
    if(i!==0)element.addEventListener("click",()=>{
      state.benchmarks=state.benchmarks.filter(item=>item.key!==benchmark.key);
      hiddenWeeklySeries.clear();
      refreshSelectedSeriesCharts();
    });
    container.append(element);
  });
  syncBenchmarkDraftControls();
}

function activeFocusIds() {
  if (state.mapFocus === "all") return null;
  if (state.mapFocus === "school") return new Set(state.schoolId===null?[]:[state.schoolId]);
  if (state.mapFocus === "conference") return new Set(cohort.filter(s=>
    s.conference_2026===state.conference).map(s=>Number(s.school_id)));
  if (state.mapFocus === "custom") return new Set(state.groupIds);
  if (state.mapFocus === "p5" || state.mapFocus === "p4") {
    return new Set(powerGroupMemberIds(membershipRows,cohort,state.mapFocus,
      state.baseline,state.target,state.metric==="attendance"));
  }
  return null;
}
function syncMapFocusControls() {
  // A P5 cohort has a meaningful historical anchor only in 2014–2023.
  const p5Anchor=state.metric==="attendance"?state.target:state.baseline;
  const p5Available=p5Anchor>=2014&&p5Anchor<=2023;
  const p4Available=state.target>=2024;
  const p5Option=$("mapFocusMode").querySelector('option[value="p5"]');
  const p4Option=$("mapFocusMode").querySelector('option[value="p4"]');
  p5Option.disabled=!p5Available;
  p4Option.disabled=!p4Available;
  if((state.mapFocus==="p5"&&!p5Available)||(state.mapFocus==="p4"&&!p4Available))
    state.mapFocus="all";
  $("mapFocusMode").value=state.mapFocus;
  $("mapConferenceField").hidden=state.mapFocus!=="conference";
  $("mapSchoolField").hidden=state.mapFocus!=="school";
  $("mapCustomGroupControls").hidden=state.mapFocus!=="custom";
  $("conferenceFilter").value=state.conference;
  $("schoolFilter").value=state.schoolId===null?"":String(state.schoolId);
  $("clearMapSelection").hidden=state.mapFocus==="all" && state.schoolId===null;
  const level=state.metric==="attendance";
  $("baselineYearField").hidden=level;
  $("comparisonDivider").hidden=level;
  $("targetYearLabel").textContent=level?"SEASON":"TO";
  const note=$("mapFocusNote");
  if(note)note.textContent=state.mapFocus==="p5"
    ? `Historical P5: schools in ACC, Big Ten, Big 12, Pac-10/12 or SEC in ${p5Anchor}; same schools tracked across selected years.`
    :state.mapFocus==="p4"
      ? `P4: ACC, Big Ten, Big 12 and SEC membership in ${state.target}; same schools tracked across selected years. The 2026 Pac-12 is separate.`
      :state.mapFocus==="custom"
        ? `${state.groupIds.length} schools in your custom group; add schools above.`
        :state.mapFocus==="conference"
          ? `Conference: ${state.conference} (2026 membership), tracked across selected years.`
          :"";
  if(note)note.hidden=!note.textContent;
}

function setupControls() {
  availableYears = [...verifiedAnnualYears].filter(y => y !== 2020).sort((a,b) => a-b);
  for (const year of availableYears) {
    const label = year === 2026 ? "2026 YTD" : String(year);
    if (year !== 2026) $("baselineYear").append(option(year,label));
    $("targetYear").append(option(year,label));
  }
  $("baselineYear").value = state.baseline;
  $("targetYear").value = state.target;
  const conferences = [...new Set(cohort.map(r => r.conference_2026))].sort();
  for (const name of conferences) $("conferenceFilter").append(option(name,name));
  state.conference=conferences.includes("ACC")?"ACC":conferences[0];
  $("conferenceFilter").value=state.conference;
  const historical = [...new Set(membershipRows.map(r => r.historical_conference).filter(Boolean))].sort();
  for (const name of historical) {
    $("comparisonConference").append(option(name,name));
    $("additionalBenchmarkSelect").append(option("selected:"+name+":literal",name+" · actual members each year"));
  }
  for(const [key,label] of [["historical","Selected school's actual conference by season"],
    ["fixed","2026 conference cohort · tracked backward"],["custom","Custom group · tracked backward"]])
    $("additionalBenchmarkSelect").append(option(key,label));
  $("comparisonConference").value = historical.includes(state.selectedConference) ? state.selectedConference : historical[0];
  state.selectedConference = $("comparisonConference").value;
  for (const school of [...cohort].sort((a,b) => a.school_name.localeCompare(b.school_name))) {
    $("schoolFilter").append(option(school.school_id,school.school_name));
    $("schoolBFilter").append(option(school.school_id,school.school_name));
    $("groupSchoolFilter").append(option(school.school_id,school.school_name));
    $("mapGroupSchoolFilter").append(option(school.school_id,school.school_name));
  }
  $("schoolFilter").value = "";
  $("schoolBFilter").value = "";
  $("conferenceMode").value = state.benchmarks[0]?.type||"historical";
  $("baselineYear").addEventListener("change", () => {
    state.baseline = Number($("baselineYear").value);
    if (state.baseline >= state.target) {
      state.target = availableYears.find(y => y > state.baseline) ?? 2026;
      if (state.target <= state.baseline) state.baseline = availableYears.filter(y => y < state.target).at(-1) ?? FIRST_YEAR;
    }
    if (state.target === 2026) state.baseline = 2025;
    synchronizeYears(); render();
  });
  $("targetYear").addEventListener("change", () => {
    state.target = Number($("targetYear").value);
    if (state.target === 2026) {
      // The provisional comparison is always 2025 full season vs 2026 YTD.
      state.baseline = 2025;
      state.metric = "pct";
    } else if (state.target <= state.baseline) {
      state.baseline = availableYears.filter(y => y < state.target).at(-1) ?? FIRST_YEAR;
    }
    synchronizeYears(); render();
  });
  $("mapFocusMode").addEventListener("change",()=>{
    state.mapFocus=$("mapFocusMode").value;
    if(state.mapFocus==="school")state.schoolId=null;
    else {state.schoolId=null;state.schoolBId=null;$("schoolBFilter").value="";}
    render();
  });
  $("conferenceFilter").addEventListener("change",()=>{
    state.conference=$("conferenceFilter").value;
    state.mapFocus="conference";render();
  });
  $("schoolFilter").addEventListener("change",()=>{
    state.schoolId=$("schoolFilter").value?Number($("schoolFilter").value):null;
    state.mapFocus=state.schoolId===null?"all":"school";
    if(state.schoolBId===state.schoolId){state.schoolBId=null;$("schoolBFilter").value="";}
    render();
  });
  $("clearMapSelection").addEventListener("click",clearMapSelection);
  $("mapAddGroupSchool").addEventListener("click",()=>{
    const id=Number($("mapGroupSchoolFilter").value);
    if(id&&!state.groupIds.includes(id))state.groupIds.push(id);
    renderGroupChips();render();
  });
  $("selectedConference").addEventListener("click",()=>{
    if(state.schoolId===null)return;
    const school=cohort.find(s=>Number(s.school_id)===state.schoolId);
    if(!school)return;
    state.conference=school.conference_2026;state.mapFocus="conference";
    state.schoolId=null;render();
  });
  $("schoolBFilter").addEventListener("change", () => {
    selectComparisonSchool($("schoolBFilter").value ? Number($("schoolBFilter").value) : null);
  });
  $("conferenceMode").addEventListener("change",changePrimaryBenchmark);
  $("comparisonConference").addEventListener("change",()=>{if($("conferenceMode").value==="selected")changePrimaryBenchmark();});
  $("conferenceLineage").addEventListener("change",changePrimaryBenchmark);
  $("addBenchmark").addEventListener("click",()=>{
    $("additionalBenchmarkField").hidden=!$("additionalBenchmarkField").hidden;
    if(!$("additionalBenchmarkField").hidden)$("additionalBenchmarkSelect").focus();
  });
  $("additionalBenchmarkSelect").addEventListener("change",()=>addAnotherBenchmark($("additionalBenchmarkSelect").value));
  $("addGroupSchool").addEventListener("click", () => {
    const id = Number($("groupSchoolFilter").value);
    if (id && !state.groupIds.includes(id)) state.groupIds.push(id);
    renderGroupChips(); render();
  });
  renderGroupChips();
  syncBenchmarkDraftControls();
  $("keyStatsMembership").addEventListener("change",()=>{state.keyStatsMembership=$("keyStatsMembership").value;renderMovers();});
  $("conferenceTableMembership").addEventListener("change",renderConferenceComparison);
  for (const button of document.querySelectorAll(".mover-type-button")) {
    button.addEventListener("click", () => {
      state.moverType=button.dataset.moverType;
      renderMovers();
    });
  }
  for (const button of document.querySelectorAll(".metric-button")) {
    button.addEventListener("click", () => {
      if (state.target <= state.baseline && button.dataset.metric !== "attendance") return;
      state.metric = button.dataset.metric; render();
    });
  }
  $("zoomIn").addEventListener("click",()=>d3.select("#atlasMap").transition().duration(160).call(zoom.scaleBy,1.35));
  $("zoomOut").addEventListener("click",()=>d3.select("#atlasMap").transition().duration(160).call(zoom.scaleBy,1/1.35));
  $("zoomReset").addEventListener("click",()=>d3.select("#atlasMap").transition().duration(160).call(zoom.transform,d3.zoomIdentity));
}

function selectComparisonSchool(next) {
  if (next !== null && state.schoolId === null) {
    state.schoolId = next; $("schoolFilter").value = next; state.schoolBId = null; $("schoolBFilter").value = "";
    render(); return;
  }
  state.schoolBId = next === state.schoolId ? null : next;
  if (state.schoolBId === null) $("schoolBFilter").value = "";
  refreshSelectedSeriesCharts();
}

function refreshSelectedSeriesCharts() {
  renderTrendChart();
  if (PUBLIC_BUILD && state.schoolId!==null && !$('weeklyTrendWrap').hidden)
    renderPilotWeeklyChart(state.schoolId,2026);
}

function renderSuggestedComparisons() {
  const container=$("suggestedComparisons");
  container.replaceChildren();
  const suggestions=suggestedComparisonsFor(state.schoolId,cohort);
  container.hidden=suggestions.length===0;
  if(!suggestions.length)return;
  const caption=document.createElement("span");
  caption.className="suggested-comparisons-label";
  caption.textContent="Suggested:";
  container.append(caption);
  for(const school of suggestions){
    const button=document.createElement("button");
    button.type="button";
    button.className="suggested-school-chip";
    button.textContent=school.school_name;
    button.setAttribute("aria-label","Compare with "+school.school_name);
    button.setAttribute("aria-pressed",String(Number(school.school_id)===state.schoolBId));
    button.addEventListener("click",()=>selectComparisonSchool(Number(school.school_id)===state.schoolBId ? null : Number(school.school_id)));
    container.append(button);
  }
}

function synchronizeYears() {
  $("baselineYear").value = state.baseline;
  $("targetYear").value = state.target;
  $("baselineYear").disabled = state.target === 2026;
}

function initializeMap(geo) {
  const svg = d3.select("#atlasMap");
  viewport = svg.append("g").attr("class","map-viewport");
  stateMap = viewport.append("g").attr("class","states");
  viewport.append("g").attr("class","map-points");
  projection = d3.geoAlbersUsa().scale(1180).translate([480,285]);
  if (geo && topojson && geo.objects?.states) {
    const states = topojson.feature(geo,geo.objects.states);
    projection.fitExtent([[35,45],[925,540]],states);
    stateMap.selectAll("path").data(states.features).join("path")
      .attr("class","state-shape").attr("d",d3.geoPath(projection));
  }
  zoom = d3.zoom().scaleExtent([1,5]).translateExtent([[-50,-50],[1010,645]])
    .extent([[0,0],[960,585]]).on("zoom",event=>{
      mapZoomScale=event.transform.k;
      viewport.attr("transform",event.transform);
      if (!$("mapSchoolChooser").hidden) closeSchoolChooser();
      // Keep symbols and their hit areas constant in screen pixels while zoom separates stadiums.
      viewport.select(".map-points").selectAll("g.map-marker")
        .attr("transform",mapMarkerTransform);
    });
  svg.call(zoom);
  svg.on("dblclick.zoom",null);
  svg.on("click.clearSelection",event=>{
    // D3 suppresses the click after a drag; marker clicks select a school.
    if(event.defaultPrevented || event.target.closest(".map-marker")) return;
    if(state.mapFocus!=="all" || state.schoolId!==null) clearMapSelection();
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape") closeSchoolChooser();
  });
  document.addEventListener("pointerdown",event=>{
    const chooser=$("mapSchoolChooser");
    if(!chooser.hidden && !chooser.contains(event.target) &&
        !event.target.closest(".map-marker")) closeSchoolChooser();
  });
}

function attendanceContext(schoolId) {
  return state.metric==="attendance"||state.target<=state.baseline ?
    disruptionsInSeason(disruptionRows,schoolId,state.target) :
    disruptionsForComparison(disruptionRows,schoolId,state.baseline,state.target);
}
function contextSummary(items) {
  return items.map(d=>d.title).join(" · ");
}

// Rank the actual visible strokes, in screen-equivalent marker coordinates.
// The hit shapes are 12px wide, and SVG zoom keeps their rendered width constant.
function distanceToSegment(x,y,[x1,y1,x2,y2]) {
  const vx=x2-x1,vy=y2-y1;
  const lengthSquared=vx*vx+vy*vy;
  const t=lengthSquared ? Math.max(0,Math.min(1,((x-x1)*vx+(y-y1)*vy)/lengthSquared)) : 0;
  return Math.hypot(x-(x1+t*vx),y-(y1+t*vy));
}

function mapPointerCandidates(event, fallback) {
  if (event.type==="focus" || !Number.isFinite(event.clientX) || !viewport)
    return [{point:fallback,distance:0,centerDistance:0}];
  const [x,y]=d3.pointer(event,viewport.node());
  const candidates=[];
  for(const point of hoveredPlotPoints) {
    const dx=(x-point.coordinates[0])*mapZoomScale/mapMarkerScale();
    const dy=(y-point.coordinates[1])*mapZoomScale/mapMarkerScale();
    const centerDistance=Math.hypot(dx,dy);
    const geometry=point.geometry;
    const distance=geometry?.hitSegments?.length ?
      Math.min(...geometry.hitSegments.map(segment=>distanceToSegment(dx,dy,segment))) :
      Math.max(0,centerDistance-(state.metric==="attendance" && point.value!=null ?
        markerRadius(point.value,"attendance") : 3.1));
    if(distance<=9/mapMarkerScale()) candidates.push({point,distance,centerDistance});
  }
  candidates.sort((a,b)=>a.distance-b.distance || a.centerDistance-b.centerDistance ||
    a.point.school_id-b.point.school_id);
  return candidates.length?candidates:[{point:fallback,distance:0,centerDistance:0}];
}

function closeSchoolChooser() {
  const chooser=$("mapSchoolChooser");
  if (!chooser) return;
  chooser.hidden=true;
  chooser.replaceChildren();
}

function showSchoolChooser(event,candidates) {
  hideTooltip();
  const chooser=$("mapSchoolChooser");
  chooser.replaceChildren();
  const head=document.createElement("div");head.className="map-chooser-head";
  const label=document.createElement("strong");label.textContent="Select school";
  const close=document.createElement("button");close.type="button";
  close.className="map-chooser-close";close.setAttribute("aria-label","Close school choices");
  close.textContent="×";close.addEventListener("click",closeSchoolChooser);
  head.append(label,close);chooser.append(head);
  for(const {point} of candidates) {
    const button=document.createElement("button");button.type="button";
    button.className="map-chooser-option";
    const name=document.createElement("span");name.textContent=point.school_name;
    const value=document.createElement("small");
    value.textContent=point.value==null?"Unavailable":
      state.metric==="attendance"?attendanceFormat(point.value):
      formattedChange(point.value,state.metric);
    button.append(name,value);
    button.addEventListener("click",()=>{closeSchoolChooser();selectSchool(point.school_id);});
    chooser.append(button);
  }
  chooser.hidden=false;
  const rect=document.querySelector(".map-stage").getBoundingClientRect();
  const x=Number.isFinite(event.clientX)?event.clientX-rect.left+12:12;
  const y=Number.isFinite(event.clientY)?event.clientY-rect.top+12:12;
  chooser.style.left=Math.max(6,Math.min(x,rect.width-chooser.offsetWidth-6))+"px";
  chooser.style.top=Math.max(6,Math.min(y,rect.height-chooser.offsetHeight-6))+"px";
}

function activateMapMarker(event,fallback) {
  event.stopPropagation();
  const candidates=mapPointerCandidates(event,fallback);
  const nearest=candidates[0];
  const ambiguous=candidates.filter(candidate=>candidate.distance<=5.5/mapMarkerScale() &&
    candidate.distance<=nearest.distance+2.5/mapMarkerScale());
  if (ambiguous.length>1) {
    showSchoolChooser(event,ambiguous);
    return;
  }
  closeSchoolChooser();
  selectSchool(nearest.point.school_id);
}

function focusMapMarker(point) {
  if (!point.coordinates || currentHoverSchoolId===point.school_id) return;
  const markers=viewport.select(".map-points").selectAll("g.map-marker");
  // Highlight only the arrow under the cursor; do not visually change neighbors.
  markers.classed("hovered",d=>d.school_id===point.school_id);
  markers.filter(d=>d.school_id===point.school_id).raise();
  currentHoverSchoolId=point.school_id;
}

function showTooltip(event, point) {
  if (!$("mapSchoolChooser").hidden) return;
  point=mapPointerCandidates(event,point)[0].point;
  focusMapMarker(point);
  const tip=$("mapTooltip"), row=point.target;
  const level=state.metric==="attendance";
  const metric=level ? `${attendanceFormat(point.value)} spectators / game` :
    point.comparison ? `${formattedChange(point.value,state.metric)} change` : "No comparable values";
  tip.replaceChildren();
  const name=document.createElement("b");name.textContent=point.school_name;
  const years=document.createElement("small");
  years.textContent=level ? `${state.target}${state.target===2026?" YTD (provisional)":""}` :
    state.target===2026 ? "2025 full season → 2026 YTD (provisional)" :
      `${state.baseline} → ${state.target}`;
  const value=document.createElement("span");value.textContent=metric;
  const averages=document.createElement("small");
  averages.className="map-tooltip-averages";
  const smallDelta=point.comparison?.difference!==0 && Number.isFinite(point.comparison?.difference) &&
    Math.abs(point.comparison.difference)<1.5;
  const averageLabel=v=>smallDelta&&Number.isFinite(v)?
    v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):attendanceFormat(v);
  averages.textContent=level ? "" :
    state.target===2026 ?
      `2025: ${averageLabel(point.baseline?.average_reported_attendance)} per game\n2026 YTD: ${averageLabel(row?.average_reported_attendance)} per game` :
      `${state.baseline}: ${averageLabel(point.baseline?.average_reported_attendance)} per game\n${state.target}: ${averageLabel(row?.average_reported_attendance)} per game`;
  averages.hidden=level;
  tip.append(name,years,value,averages);
  if (!level && mapNeutral(point)) {
    const note=document.createElement("small");
    note.className="map-tooltip-neutral";
    note.textContent=`Near-flat arrow (under ${MAP_NEUTRAL_PCT}% of baseline); displayed change is rounded.`;
    tip.append(note);
  }
  const context=attendanceContext(point.school_id);
  if(context.length){
    const flag=document.createElement("small");
    flag.className="disruption-tooltip-note";
    flag.textContent="Attendance context: "+contextSummary(context);
    tip.append(flag);
  }
  tip.hidden=false;
  const rect=document.querySelector(".map-stage").getBoundingClientRect();
  // Anchor to the actual marker, including keyboard focus. Favor its empty
  // side and otherwise place the tooltip above/below it, not over the arrow.
  const marker=viewport.select(".map-points").selectAll("g.map-marker")
    .filter(d=>d.school_id===point.school_id).node();
  const bounds=marker?.getBoundingClientRect();
  const x=bounds?(bounds.left+bounds.right)/2-rect.left :
    Number.isFinite(event.clientX)?event.clientX-rect.left:rect.width/2;
  const y=bounds?(bounds.top+bounds.bottom)/2-rect.top :
    Number.isFinite(event.clientY)?event.clientY-rect.top:rect.height/2;
  const width=tip.offsetWidth,height=tip.offsetHeight,gap=10,padding=6;
  const clamp=(v,max)=>Math.max(padding,Math.min(v,max-padding));
  let left,top;
  if(rect.width-x-gap>=width+padding) {
    left=x+gap;top=clamp(y-height/2,rect.height-height);
  } else if(x-gap>=width+padding) {
    left=x-width-gap;top=clamp(y-height/2,rect.height-height);
  } else {
    left=clamp(x-width/2,rect.width-width);
    top=clamp(y<rect.height/2?y+gap:y-height-gap,rect.height-height);
  }
  tip.style.left=`${left}px`;
  tip.style.top=`${top}px`;
}

function hideTooltip() {
  currentHoverSchoolId=null;
  $("mapTooltip").hidden = true;
  viewport?.select(".map-points").selectAll("g.map-marker")
    .classed("hovered",false);
}

function clearMapSelection() {
  hideTooltip();
  closeSchoolChooser();
  state.mapFocus="all";
  state.schoolId=null;
  state.schoolBId=null;
  $("schoolBFilter").value="";
  render();
}

function selectSchool(schoolId) {
  closeSchoolChooser();
  state.mapFocus="school";
  state.schoolId = schoolId;
  if (state.schoolBId === schoolId) {state.schoolBId = null; $("schoolBFilter").value = "";}
  $("schoolFilter").value = schoolId;
  render();
}

function renderMagnitudeKey() {
  const key=$("mapLengthKey"), samples=$("mapLengthSamples");
  key.hidden=state.metric === "attendance";
  if (key.hidden) return;
  samples.replaceChildren();
  const examples=state.metric==="pct" ?
    [{value:5,label:"5%"},{value:25,label:"25%"},{value:75,label:"75%"}] :
    [{value:2500,label:"2,500"},{value:12500,label:"12,500"},{value:37500,label:"37,500"}];
  const ns="http://www.w3.org/2000/svg";
  for (const example of examples) {
    const geometry=arrowGeometry(example.value,state.metric);
    const item=document.createElement("span");item.className="map-length-item";
    const svg=document.createElementNS(ns,"svg");
    svg.setAttribute("viewBox","-20 -17 40 34");svg.setAttribute("aria-hidden","true");
    for (const [shape,width] of [[geometry.path,geometry.strokeWidth],[geometry.tipPath,1.65]]) {
      const path=document.createElementNS(ns,"path");
      path.setAttribute("d",shape);path.setAttribute("fill","none");
      path.setAttribute("stroke",themeColor("--rise"));path.setAttribute("stroke-width",String(width));
      path.setAttribute("stroke-linecap","round");path.setAttribute("stroke-linejoin","round");
      svg.append(path);
    }
    const label=document.createElement("span");label.textContent=example.label;
    item.append(svg,label);samples.append(item);
  }
}

function renderMap() {
  closeSchoolChooser();
  const svg = d3.select("#atlasMap");
  const focusIds=activeFocusIds();
  const inFocus=d=>focusIds===null||focusIds.has(d.school_id);
  const plotting = mapPoints.map(p => ({...p,coordinates:p.mappable ?
    projection([p.geo.longitude,p.geo.latitude]) : null,
    geometry:state.metric==="attendance" ? null :
      arrowGeometry(p.value,state.metric,p.comparison?.before)})).filter(p => p.coordinates);
  hoveredPlotPoints=plotting;
  currentHoverSchoolId=null;
  const selection = viewport.select(".map-points").selectAll("g.map-marker")
    .data(plotting,d => d.school_id).join(
      enter => {
        const g = enter.append("g").attr("class","map-marker").attr("role","button").attr("tabindex",0);
        g.append("circle").attr("class","marker-ring");
        g.append("path").attr("class","marker-arrow");
        g.append("path").attr("class","marker-tip");
        g.append("circle").attr("class","marker-hit-circle");
        g.append("path").attr("class","marker-hit-shaft");
        g.append("path").attr("class","marker-hit-tip");
        g.append("title");
        return g;
      }, update => update, exit => exit.remove()
    )
    .attr("transform",mapMarkerTransform)
    .classed("hovered",false)
    .classed("active",d => d.school_id === state.schoolId)
    .classed("muted",d => !inFocus(d))
    .attr("aria-label",d => `${d.school_name}: ${d.value == null ? "unavailable" :
      state.metric === "attendance" ? attendanceFormat(d.value) + " reported average" :
        formattedChange(d.value,state.metric) + (mapNeutral(d) ? " (shown as essentially unchanged)" : "")}`+
      (attendanceContext(d.school_id).length?" · documented attendance context":""))
    .on("mouseenter",showTooltip).on("mousemove",showTooltip).on("mouseleave",hideTooltip)
    .on("focus",showTooltip).on("blur",hideTooltip)
    .on("click",activateMapMarker)
    .on("keydown",(event,d) => {if(event.key==="Enter"||event.key===" "){event.preventDefault();selectSchool(d.school_id);}});
  // Draw quiet context markers first so the highlighted conference remains legible.
  selection.sort((a,b) => Number(inFocus(a)) - Number(inFocus(b)) ||
    Number(a.school_id === state.schoolId) - Number(b.school_id === state.schoolId));
  selection.select(".marker-ring")
    .attr("r",d => state.metric === "attendance" && d.value !== null ? markerRadius(d.value,"attendance") :
      d.value === null ? 3.1 : 0)
    .attr("fill",d => d.value === null ? themeColor("--paper") : !inFocus(d) ? themeColor("--map-muted") : themeColor("--gold"))
    .attr("stroke",d => d.value === null ? themeColor("--neutral") : !inFocus(d) ? themeColor("--map-muted") : themeColor("--paper"))
    .attr("stroke-dasharray",d => d.value === null ? "1.5 1.5" : null);
  selection.select(".marker-arrow")
    .attr("d",d => state.metric === "attendance" ? null : mapGeometry(d)?.path ?? null)
    .attr("stroke",d => !inFocus(d) ? themeColor("--map-muted") : mapNeutral(d) ? themeColor("--neutral") : d.value > 0 ? themeColor("--rise") : themeColor("--fall"))
    .attr("stroke-width",d => {
      const g=state.metric==="attendance"?null:mapGeometry(d);
      return (g?.strokeWidth??0) + (d.school_id===state.schoolId?0.4:0);
    });
  selection.select(".marker-tip")
    .attr("d",d => state.metric === "attendance" ? null : mapGeometry(d)?.tipPath ?? null)
    .attr("stroke",d => !inFocus(d) ? themeColor("--map-muted") : mapNeutral(d) ? themeColor("--neutral") : d.value > 0 ? themeColor("--rise") : themeColor("--fall"))
    .attr("stroke-width",d => d.school_id === state.schoolId ? 1.95 : 1.65);
  // Stroke-only transparent targets follow the exact arrow instead of masking neighbors.
  selection.select(".marker-hit-circle")
    .attr("r",d=>state.metric==="attendance" && d.value!==null ?
      markerRadius(d.value,"attendance")+5 : d.value===null ? 10 : 0)
    .style("pointer-events",d=>state.metric==="attendance"||d.value===null?"all":"none");
  selection.select(".marker-hit-shaft")
    .attr("d",d=>state.metric==="attendance"?null:d.geometry?.path??null);
  selection.select(".marker-hit-tip")
    .attr("d",d=>state.metric==="attendance"?null:d.geometry?.tipPath??null);
  selection.select("title").text(d => `${d.school_name} · ${d.value == null ? "no reported value" :
    state.metric === "attendance" ? attendanceFormat(d.value) : formattedChange(d.value,state.metric)}`);
  const focusPoints = plotting.filter(inFocus);
  $("mapStatus").textContent=focusIds===null
    ? `${focusPoints.filter(p=>p.value!==null).length} of ${plotting.length} mapped schools with values`
    : `${focusPoints.length} highlighted · ${plotting.length} mapped schools`;
  $("mapTitle").textContent = state.metric === "attendance" ? "Average reported attendance" : "Change in home attendance";
  $("mapRange").textContent = state.metric === "attendance" ?
    state.target === 2026 ? "2026 YTD · official reports" : `${state.target} season` :
    state.target===2026 ? "2025 full season → 2026 YTD · provisional" :
      `${state.baseline} → ${state.target}`;
  const riseLegend = $("riseLegendItem");
  riseLegend.lastElementChild.textContent = state.metric === "attendance" ? "Reported level" : "Increase";
  riseLegend.querySelector("i").classList.toggle("rise",state.metric!=="attendance");
  riseLegend.querySelector("i").style.backgroundColor = state.metric === "attendance" ? "#a78c50" : "";
  $("fallLegendItem").hidden = state.metric === "attendance";
  $("unavailableLegendItem").lastElementChild.textContent = state.metric === "attendance" ? "Not reported" : "Not comparable";
  $("flatLegendItem").hidden = state.metric === "attendance";
  $("markerScaleLegend").hidden=state.metric!=="attendance";
  $("markerScaleLegend").textContent=state.metric==="attendance"
    ? "Circle size = reported attendance per game." : "";
  renderMagnitudeKey();
  svg.attr("aria-label",state.metric === "attendance"
    ? `2026 stadium locations showing ${state.target} reported attendance level`
    : `2026 stadium locations showing changes from ${state.baseline} to ${state.target}`);
}

function renderSchoolCard() {
  const panel = document.querySelector(".school-card");
  if (state.schoolId === null) {panel.hidden = true;return;}
  const item = cohort.find(s => Number(s.school_id) === state.schoolId);
  if (!item) {panel.hidden = true;return;}
  panel.hidden = false;
  const palette=teamPalette(state.schoolId);
  panel.style.setProperty("--school-primary",palette.primary);
  panel.style.setProperty("--school-secondary",palette.secondary);
  const before = schoolIndex.get(`${state.schoolId}:${state.target===2026?2025:state.baseline}`);
  const after = schoolIndex.get(`${state.schoolId}:${state.target}`);
  const change = state.target===2026 ?
    compareProvisionalYtd(before,after,"pct") : compareSchool(before,after,"pct");
  $("selectedName").textContent = item.school_name;
  $("selectedConference").textContent = `Conference: ${item.conference_2026} (2026)`;
  const level=state.metric==="attendance";
  $("selectedBefore").parentElement.hidden=level;
  $("selectedDifference").parentElement.hidden=level;
  $("selectedNowLabel").textContent = state.target === 2026 ? "2026 YTD average" : `${state.target} average`;
  $("selectedNow").textContent = attendanceFormat(after?.average_reported_attendance);
  $("selectedBeforeLabel").textContent = `${state.target===2026?2025:state.baseline} average`;
  $("selectedBefore").textContent = attendanceFormat(before?.average_reported_attendance);
  $("selectedDifferenceLabel").textContent = state.target===2026 ? "2026 YTD vs 2025" : "Change";
  const displayedChange = change?.value ?? null;
  $("selectedDifference").textContent = formattedChange(displayedChange,"pct");
  $("selectedDifference").style.color = themeColor(displayedChange===null||displayedChange===undefined?"--soft":displayedChange>=0?"--rise":"--fall");
  const candidate = candidateIndex.get(`${state.schoolId}:${state.target}`);
  const coverageText=(row,year)=>{
    if(!row) return `${year} · No qualified annual attendance`;
    const label=sourceLabel(row.attendance_source).replace(" · YTD","");
    const ncaa=row.attendance_source?.startsWith("ncaa_");
    const games=ncaa
      ? `${row.reported_home_games} credited home games`
      : `${row.reported_home_games} of ${row.completed_home_games} games reported`;
    return `${year}${year===2026?" YTD":""} · ${label} · ${games}` +
      (row.missing_home_games ? ` · ${row.missing_home_games} missing` : "") +
      (row.data_through ? ` · updated ${row.data_through.slice(0,10)}` : "");
  };
  $("selectedCoverage").textContent = after ? coverageText(after,state.target)
    : candidate ? `${state.target} · CFBD ${candidate.verification_status.replaceAll("_"," ")} · not qualified for annual trends`
    : `${state.target} · No qualified annual attendance`;
  const baselineYear=state.target===2026?2025:state.baseline;
  $("baselineSourceRow").hidden=level;
  $("baselineCoverage").textContent=coverageText(before,baselineYear);
  const baselineLink=$("baselineReportSource");
  baselineLink.hidden=level||!before?.source_url;
  if(before?.source_url) {
    baselineLink.href=before.source_url;
    baselineLink.textContent=`View ${baselineYear} source`;
  }
  const special = $("annualSpecialNote");
  const exception = item.school_name === "LSU" && state.target === 2015 && after
    ? "2015 home-credit exception"
    : item.school_name === "UL Monroe" && (state.baseline===2006||state.target===2006)
    ? "2006 printed-average exception" : "";
  special.replaceChildren();
  special.hidden = !exception;
  if (exception) {
    const link = document.createElement("a");
    link.href = "./methodology.html#adjustments";
    link.textContent = "Details in methodology";
    special.append(exception+" · ",link);
  }
  const link = $("annualReportSource");
  link.hidden = !after?.source_url && !(state.target===2026 && after?.reported_home_games>0);
  if(!link.hidden) {
    if(state.target===2026) {
      link.href="#gameDetailTitle";
      link.removeAttribute("target");
      link.textContent="Game sources";
    } else {
      link.href=after.source_url;
      link.target="_blank";
      link.textContent=`View ${state.target} source`;
    }
  }
  $("selectedStadium").textContent = locations.get(state.schoolId)?.stadium || "2026 stadium location unavailable";
  const context=attendanceContext(state.schoolId), notice=$("disruptionNotice");
  notice.replaceChildren();notice.hidden=!context.length;
  if(context.length) {
    const lead=document.createElement("strong");lead.textContent="Attendance context · ";
    notice.append(lead,document.createTextNode(contextSummary(context)+" · "));
    const detail=document.createElement("a");
    detail.href="./methodology.html#disruptions";detail.textContent="Why this is flagged";
    notice.append(detail);
  }
}

function renderMovers() {
  const section=$("moversSection");
  const level=state.metric==="attendance";
  const scopeConferences=new Set(currentPoints.map(s=>s.conference_2026).filter(Boolean));
  const canRankConferences=scopeConferences.size>1;
  document.querySelector(".mover-type-switch").hidden=!canRankConferences;
  if(!canRankConferences)state.moverType="school";
  const conferences=state.moverType==="conference";
  $("moversTitle").textContent="Key Stats · "+(level
    ? `${state.target}${state.target===2026?" YTD":""}`
    : `${state.target===2026?2025:state.baseline} vs. ${state.target===2026?"2026 YTD":state.target}`);
  section.hidden=false;
  $("keyStatsMembershipField").hidden=!conferences;
  $("keyStatsMembership").value=state.keyStatsMembership;
  for(const button of document.querySelectorAll(".mover-type-button")){
    const active=button.dataset.moverType===state.moverType;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  }

  const names=conferences
    ? [...new Set(currentPoints.map(s=>s.conference_2026))].filter(Boolean).sort()
    : [];
  const comparisonRows=conferences ? names.map(name=>{
    const historical=state.keyStatsMembership==="historical";
    const series=conferenceTrendSeries(conferenceRows,historicalConferenceRows,name,
      historical?"historical":"fixed");
    const members=cohort.filter(s=>s.conference_2026===name);
    const yearValue=year=>year===2026
      ? conference2026Ytd(members,schoolIndex).average
      : series.find(d=>d.year===year)?.average;
    const first=yearValue(state.baseline),last=yearValue(state.target);
    if(!Number.isFinite(last)||last<=0)return null;
    const difference=Number.isFinite(first)&&first>0?last-first:null;
    return {name,conference:name,average:last,result:difference===null?null:
      {difference,value:100*difference/first}};
  }).filter(Boolean) : currentPoints.map(school=>{
    const result=school.comparison;
    const average=school.target?.average_reported_attendance;
    if(!Number.isFinite(average)||school.target?.reported_home_games<=0)return null;
    return {name:school.school_name,school,average,result};
  }).filter(Boolean);

  const byAbsolute=state.metric==="absolute";
  const rank=row=>row.result?(byAbsolute?row.result.difference:row.result.value):null;
  const comparable=comparisonRows.filter(row=>rank(row)!==null&&Number.isFinite(rank(row)));
  const rises=comparable.filter(row=>rank(row)>0).sort((a,b)=>rank(a)-rank(b));
  const falls=comparable.filter(row=>rank(row)<0).sort((a,b)=>rank(a)-rank(b));
  const ranked=[...comparisonRows].sort((a,b)=>a.average-b.average);
  const entries={
    largestRise:level?null:rises.at(-1),
    largestFall:level?null:falls[0],
    highestAverage:ranked.at(-1),
    lowestAverage:ranked[0],
  };
  for(const id of ["largestRise","largestFall"]){
    $(id).hidden=level;
  }
  for(const [id,row] of Object.entries(entries)){
    const button=$(id);
    button.disabled=!row;
    const name=button.querySelector(".mover-school");
    name.replaceChildren();name.append(document.createTextNode(row?.name??"No qualifying result"));
    const context=row&&!conferences ?
      disruptionsForComparison(disruptionRows,row.school.school_id,state.baseline,state.target) : [];
    if(context.length){
      const mark=document.createElement("span");mark.className="mover-context-marker";
      mark.textContent=" · context";mark.title=contextSummary(context);name.append(mark);
    }
    const value=button.querySelector(".mover-value");
    value.replaceChildren();
    if(!row){value.textContent="—";button.onclick=null;continue;}
    const aLevel=id==="highestAverage"||id==="lowestAverage";
    value.append(document.createTextNode(aLevel?
      attendanceFormat(row.average)+" / game":formattedChange(row.result.value,byAbsolute?"absolute":"pct")));
    if(!aLevel){
      const detail=document.createElement("small");
      detail.textContent=fansDelta(row.result.difference)+" / game";
      value.append(detail);
    }
    button.title=(conferences?"Highlight "+row.conference+" on the map":"Show "+row.name+" on the map")+
      (context.length?" · Attendance context: "+contextSummary(context):"");
    button.onclick=conferences?()=>{
      state.conference=row.conference;state.mapFocus="conference";state.schoolId=null;render();
    }:()=>selectSchool(row.school.school_id);
  }
  const scope=conferences
    ? state.keyStatsMembership==="historical"
      ? "Actual conference members by year"
      : "Fixed 2026 conference members"
    : state.mapFocus==="p5"?"Historical P5 cohort"
    : state.mapFocus==="p4"?"P4 cohort"
    : state.mapFocus==="conference"?`${state.conference} · 2026 members`
    : state.mapFocus==="custom"?"Custom group":"";
  $("moversSubtitle").textContent=scope;
  $("moversSubtitle").hidden=!scope;
}

// Independent conference overview using the same validated aggregates as Key Stats.
// Historical names are literal: Pac-10/Pac-12 and Big East/American are not silently merged.
function renderConferenceComparison() {
  const basis=$("conferenceTableMembership").value;
  const historical=basis==="historical";
  const level=state.metric==="attendance";
  const fromYear=state.baseline,toYear=state.target;
  const label=year=>year===2026?"2026 YTD":String(year);
  $("conferenceTableFromHeading").textContent=label(fromYear)+" / game";
  $("conferenceTableToHeading").textContent=label(toYear)+" / game";
  $("conferenceTableFromHeading").hidden=level;
  $("conferenceTableChangeHeading").hidden=level;
  $("conferenceTablePctHeading").hidden=level;

  const rows=$("conferenceTableRows");
  rows.replaceChildren();
  const names=historical
    ? [...new Set(historicalConferenceRows.filter(row=>
        Number(row.season)===fromYear || (toYear!==2026 && Number(row.season)===toYear)
      ).map(row=>row.conference).concat(toYear===2026?
        cohort.map(row=>row.conference_2026):[]))].filter(Boolean)
    : [...new Set(cohort.map(row=>row.conference_2026))].filter(Boolean);
  const values=names.map(name=>{
    const series=conferenceTrendSeries(conferenceRows,historicalConferenceRows,name,
      historical?"historical":"fixed");
    const members=cohort.filter(row=>row.conference_2026===name);
    const value=year=>year===2026
      ? conference2026Ytd(members,schoolIndex).average
      : series.find(point=>point.year===year)?.average;
    const from=value(fromYear),to=value(toYear);
    if ((!Number.isFinite(from)||from<=0) && (!Number.isFinite(to)||to<=0))return null;
    const difference=from>0&&to>0?to-from:null;
    const pct=difference!==null?100*difference/from:null;
    return {name,from:from>0?from:null,to:to>0?to:null,difference,pct};
  }).filter(Boolean).filter(item=>!level||item.to!==null);

  const rank=row=>level?row.to:state.metric==="absolute"?row.difference:row.pct;
  values.sort((a,b)=>{
    const x=rank(a),y=rank(b);
    if(x===null&&y!==null)return 1;
    if(x!==null&&y===null)return -1;
    return x===null?a.name.localeCompare(b.name):(y-x)||a.name.localeCompare(b.name);
  });
  for(const item of values){
    const tr=document.createElement("tr");
    const name=document.createElement("th");
    name.scope="row";
    const swatch=document.createElement("i");
    swatch.className="conference-table-swatch";
    swatch.style.backgroundColor=conferenceColor(item.name);
    swatch.setAttribute("aria-hidden","true");
    name.append(swatch,document.createTextNode(item.name));
    tr.append(name);
    const cells=[
      item.from===null?"—":attendanceFormat(item.from),
      item.to===null?"—":attendanceFormat(item.to)+(toYear===2026?"*":""),
      item.difference===null?"—":fansDelta(item.difference),
      item.pct===null?"—":formattedChange(item.pct,"pct"),
    ];
    cells.forEach((text,i)=>{
      const td=document.createElement("td");
      td.textContent=text;
      if(i===0||i>=2)td.hidden=level;
      if(i>=2 && item.difference!==null)td.className=item.difference>0?
        "conference-positive":item.difference<0?"conference-negative":"";
      tr.append(td);
    });
    rows.append(tr);
  }
  $("conferenceComparisonSubtitle").textContent=level
    ? label(toYear)+" · spectators/game"
    : label(fromYear)+" → "+label(toYear)+" · spectators/game";
  $("conferenceComparisonNote").textContent=
    (historical
      ? "Actual conference members each year (realignment included)."
      : "Fixed 2026 conference membership across seasons.")+
    " — means unavailable."+
    (toYear===2026?" *2026 YTD is provisional.":"");
}


function compactSpectatorCount(value) {
  if(!Number.isFinite(value))return "—";
  if(Math.abs(value)>=1000000)return (value/1000000).toFixed(2)+"M";
  return Math.round(value).toLocaleString("en-US");
}

function renderAveragesSummary(levelMode,levelRows) {
  const rows=(levelMode?levelRows:currentPoints.filter(p=>p.comparison))
    .filter(p=>p.target?.reported_home_games>0 &&
      Number.isFinite(p.target?.total_reported_attendance));
  const sum=(list,getRow,field)=>list.reduce((n,p)=>{
    const value=Number(getRow(p)?.[field]);
    return n+(Number.isFinite(value)?value:0);
  },0);
  const toTotal=sum(rows,p=>p.target,"total_reported_attendance");
  const toGames=sum(rows,p=>p.target,"reported_home_games");
  const fromTotal=sum(rows,p=>p.baseline,"total_reported_attendance");
  const fromGames=sum(rows,p=>p.baseline,"reported_home_games");
  const toAverage=toGames>0?toTotal/toGames:null;
  const fromAverage=fromGames>0?fromTotal/fromGames:null;
  const hasComparison=!levelMode && Number.isFinite(fromAverage) && Number.isFinite(toAverage);
  const change=hasComparison?toAverage-fromAverage:null;
  const changePct=hasComparison && fromAverage>0?100*change/fromAverage:null;
  const beforeYear=state.target===2026?2025:state.baseline;
  const afterLabel=String(state.target)+(state.target===2026?" YTD":"");
  const fromLabel=$("baselineAverageLabel");
  const toLabel=$("targetAverageLabel");
  const changeLabel=$("overallChangeLabel");
  const fromValue=$("baselineAverage");
  const toValue=$("targetAverage");
  const changeValue=$("overallChange");
  const note=$("overallChangePercent");
  if(levelMode) {
    fromLabel.textContent="REPORTED HOME GAMES";
    fromValue.textContent=toGames>0?toGames.toLocaleString("en-US"):"—";
    toLabel.textContent=afterLabel+" AVG / GAME";
    toValue.textContent=Number.isFinite(toAverage)?attendanceFormat(toAverage):"—";
    changeLabel.textContent=afterLabel+" TOTAL SPECTATORS";
    changeValue.textContent=toGames>0?compactSpectatorCount(toTotal):"—";
    changeValue.style.color=themeColor("--ink");
    note.textContent="";
    fromValue.title="Reported home games in the selected season.";
    toValue.title="Pooled spectators per reported home game.";
    changeValue.title=toGames>0?Math.round(toTotal).toLocaleString("en-US")+" reported spectators":"";
    return;
  }
  fromLabel.textContent=beforeYear+" AVG / GAME";
  toLabel.textContent=afterLabel+" AVG / GAME";
  changeLabel.textContent="OVERALL CHANGE / GAME";
  fromValue.textContent=hasComparison?attendanceFormat(fromAverage):"—";
  toValue.textContent=hasComparison?attendanceFormat(toAverage):"—";
  changeValue.textContent=hasComparison?
    (change>0?"+":change<0?"−":"")+attendanceFormat(Math.abs(change)):"—";
  note.textContent=Number.isFinite(changePct)?
    (changePct>0?"+":"")+changePct.toFixed(1)+"%"+
      (state.target===2026?" · provisional":""):"";
  changeValue.style.color=themeColor(change===null?"--soft":change>=0?"--rise":"--fall");
  const hover="Weighted across "+rows.length+" comparable schools; each reported home game counts equally.";
  fromValue.title=hover+" "+fromGames+" games in "+beforeYear+".";
  toValue.title=hover+" "+toGames+" games in "+afterLabel+".";
  changeValue.title="Change in pooled spectators per reported home game; not the median school change.";
}

function renderStats() {
  const levelMode = state.metric === "attendance" || state.target <= state.baseline;
  const comparable = currentPoints.map(p=>p.comparison).filter(Boolean);
  const changes = comparable.map(p=>p.value).sort((a,b)=>a-b);
  const levelRows = currentPoints.filter(p=>Number.isFinite(p.target?.average_reported_attendance) &&
    p.target.reported_home_games>0);
  const ordered = [...levelRows].sort((a,b)=>a.target.average_reported_attendance-b.target.average_reported_attendance);
  for (const [id,label] of Object.entries(levelMode ? {
    comparableLabel:"REPORTING SCHOOLS",medianStatLabel:"MEDIAN / GAME",
    gainStatLabel:"HIGHEST / GAME",lossStatLabel:"LOWEST / GAME"
  } : {
    comparableLabel:"SCHOOLS COMPARED",medianStatLabel:state.metric==="absolute"?"MEDIAN CHANGE / GAME":"MEDIAN % CHANGE",
    gainStatLabel:"UP",lossStatLabel:"DOWN"
  })) $(id).textContent=label;
  $("comparableLabel").title=levelMode ?
    "Schools with reported home attendance in the selected season." :
    state.target===2026 ?
      "Schools with a valid 2025 full-season average and complete attendance for reported 2026 YTD home games." :
      `Schools with complete, eligible home-attendance averages in both ${state.baseline} and ${state.target}; missing, partial, and exception-flagged seasons are excluded.`;
  $("highSchoolName").hidden=!levelMode || !ordered.length;
  $("lowSchoolName").hidden=!levelMode || !ordered.length;
  if(levelMode) {
    $("comparableCount").textContent=`${levelRows.length}/${currentPoints.length}`;
    $("medianChange").textContent=attendanceFormat(ordered.length ?
      d3.median(ordered,p=>p.target.average_reported_attendance):null);
    $("gainCount").textContent=attendanceFormat(ordered.at(-1)?.target.average_reported_attendance);
    $("lossCount").textContent=attendanceFormat(ordered[0]?.target.average_reported_attendance);
    $("highSchoolName").textContent=ordered.at(-1)?.school_name ?? "";
    $("lowSchoolName").textContent=ordered[0]?.school_name ?? "";
    $("medianLabel").textContent=`Reported average spectators per home game · ${state.target===2026?"2026 YTD provisional":state.target}`;
  } else {
    $("comparableCount").textContent=comparable.length;
    $("gainCount").textContent=changes.filter(v=>v>0).length;
    $("lossCount").textContent=changes.filter(v=>v<0).length;
    $("medianChange").textContent=formattedChange(changes.length?d3.median(changes):null,state.metric);
    $("medianLabel").textContent=`Comparable programs · ${state.baseline}–${state.target}${state.target===2026?" YTD provisional":""}`;
  }
  $("comparisonNotice").hidden=state.target!==2026;
  const dataThrough=ytdDataThroughLabel();
  $("comparisonNotice").textContent=state.target===2026
    ? `2026 YTD (provisional)${levelMode?"":" vs. full-year 2025"}${dataThrough?` · Data through ${dataThrough}`:""}.`
    : "";
  for (const button of document.querySelectorAll(".metric-button")) {
    const isChange = button.dataset.metric !== "attendance";
    button.disabled = state.target <= state.baseline && isChange;
    const active = button.dataset.metric === state.metric;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  }
  renderAveragesSummary(levelMode,levelRows);
  renderMovers();
}

function schoolTrendSeries(id) {
  return Array.from({length:LAST_YEAR-FIRST_YEAR+1},(_,i)=>{
    const year=FIRST_YEAR+i, row=schoolIndex.get(`${id}:${year}`);
    return {year,average:row?.reported_home_games>0 ? row.average_reported_attendance : null,
      source:row?.attendance_source ?? null, reported:row?.reported_home_games ?? 0,
      completed:row?.completed_home_games ?? 0, missing:row?.missing_home_games ?? 0,
      exception:!!(row?.covid_exception||row?.partial_season)};
  });
}

function renderQuickTrend() {
  const svg=d3.select("#quickTrendChart");
  svg.selectAll("*").remove();
  const tip=$("quickTrendTooltip");
  tip.hidden=true;
  const empty=$("quickTrendEmpty"),expand=$("quickTrendExpand");
  if (state.schoolId===null) {
    svg.attr("hidden",true);empty.hidden=false;expand.hidden=true;
    return;
  }
  const item=cohort.find(s=>Number(s.school_id)===state.schoolId);
  const points=schoolTrendSeries(state.schoolId);
  const observed=points.filter(d=>Number.isFinite(d.average));
  if (!item || !observed.length) {
    svg.attr("hidden",true);empty.hidden=false;expand.hidden=true;return;
  }
  svg.attr("hidden",null);empty.hidden=true;expand.hidden=false;
  const palette=teamPalette(state.schoolId);
  const w=390,h=145,m={left:42,right:11,top:10,bottom:23};
  const x=d3.scaleLinear().domain([2001,2026]).range([m.left,w-m.right]);
  const ymax=d3.max(observed,d=>d.average)||50000;
  const y=d3.scaleLinear().domain([0,Math.max(20000,ymax*1.12)]).nice()
    .range([h-m.bottom,m.top]);
  svg.append("g").attr("class","quick-trend-axis")
    .attr("transform",`translate(0,${h-m.bottom})`)
    .call(d3.axisBottom(x).tickValues([2001,2010,2020,2026]).tickFormat(d3.format("d")));
  svg.append("g").attr("class","quick-trend-axis")
    .attr("transform",`translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(3).tickFormat(v=>Math.round(v/1000)+"k"));
  const regular=points.filter(d=>d.year<2026);
  const line=d3.line().defined(d=>d.average!==null).x(d=>x(d.year)).y(d=>y(d.average));
  svg.append("path").datum(regular).attr("class","chart-line")
    .attr("d",line).attr("stroke",palette.primary).attr("stroke-width",2.5);
  const p25=points.find(d=>d.year===2025),p26=points.find(d=>d.year===2026);
  if (p25?.average!==null && p26?.average!==null && p25&&p26) {
    svg.append("path").attr("d",`M${x(2025)},${y(p25.average)}L${x(2026)},${y(p26.average)}`)
      .attr("stroke",palette.primary).attr("stroke-width",2).attr("stroke-dasharray","3 4").attr("fill","none");
  }
  svg.selectAll(".quick-dot").data(observed).join("circle")
    .attr("class","quick-dot").attr("cx",d=>x(d.year)).attr("cy",d=>y(d.average))
    .attr("r",d=>d.year===2026?3.7:2.2)
    .attr("fill",d=>d.year===2026?themeColor("--paper"):palette.primary)
    .attr("stroke",palette.primary).attr("stroke-width",1.3);
  const showTrendTip=(event,d)=>{
    const context=disruptionsInSeason(disruptionRows,state.schoolId,d.year);
    tip.textContent=`${d.year}${d.year===2026?" YTD · provisional":""}: ${attendanceFormat(d.average)} / game`+
      (context.length?" · "+contextSummary(context):"");
    tip.hidden=false;
    svg.selectAll(".quick-dot").attr("r",p=>p.year===d.year?4.4:p.year===2026?3.7:2.2);
  };
  const hideTrendTip=()=>{
    tip.hidden=true;
    svg.selectAll(".quick-dot").attr("r",d=>d.year===2026?3.7:2.2);
  };
  svg.selectAll(".quick-dot-hit").data(observed).join("circle")
    .attr("class","quick-dot-hit")
    .attr("cx",d=>x(d.year)).attr("cy",d=>y(d.average))
    .attr("r",8).attr("fill","transparent").attr("tabindex",0)
    .attr("role","button")
    .attr("aria-label",d=>`${d.year}: ${attendanceFormat(d.average)} spectators per home game`)
    .on("mouseenter",showTrendTip).on("mousemove",showTrendTip)
    .on("mouseleave",hideTrendTip).on("focus",showTrendTip).on("blur",hideTrendTip);
  svg.selectAll(".quick-disruption").data(observed.filter(d=>
    disruptionsStarting(disruptionRows,state.schoolId,d.year).length)).join("circle")
    .attr("class","quick-disruption").attr("cx",d=>x(d.year)).attr("cy",d=>y(d.average))
    .attr("r",5.7).attr("fill","none").attr("stroke","#a46b37")
    .attr("stroke-width",1).attr("pointer-events","none");
  svg.attr("aria-label",`${item.school_name} reported annual home attendance, 2001 to 2026 provisional YTD; missing years omitted`);
}

function benchmarkTrendSeries(benchmark, school) {
  let data, members;
  if (benchmark.type==="historical") {
    data=historicalConferenceSchoolSeries(state.schoolId,membershipRows,historicalConferenceRows);
    members=cohort.filter(s=>s.conference_2026===school.conference_2026);
  } else if (benchmark.type==="fixed") {
    data=conferenceTrendSeries(conferenceRows,historicalConferenceRows,school.conference_2026,"fixed");
    members=cohort.filter(s=>s.conference_2026===school.conference_2026);
  } else if (benchmark.type==="selected") {
    data=conferenceTrendSeries(conferenceRows,historicalConferenceRows,benchmark.conference,
      "historical",benchmark.followLineage);
    members=cohort.filter(s=>s.conference_2026===benchmark.conference);
  } else if (benchmark.type==="custom") {
    members=customGroupMembers(cohort,state.groupIds);
    data=customGroupSeries(members,schoolIndex);
  } else throw new Error("Unknown benchmark type");
  const provisional=conference2026Ytd(members,schoolIndex);
  return data.map(d=>d.year===2026?{...d,...provisional}:d);
}

function renderTrendStats(series) {
  const tbody=$("trendStatsRows");tbody.replaceChildren();
  const fmt=v=>v===null||!Number.isFinite(v)?"—":attendanceFormat(v);
  for (const item of series) {
    const observed=item.data.filter(d=>d.year<=2025 && d.year!==2020 && d.average!==null);
    const first=item.data.find(d=>d.year===2001)?.average ?? null;
    const last=item.data.find(d=>d.year===2025)?.average ?? null;
    const ytd=item.data.find(d=>d.year===2026)?.average ?? null;
    const low=observed.reduce((best,d)=>!best||d.average<best.average?d:best,null);
    const high=observed.reduce((best,d)=>!best||d.average>best.average?d:best,null);
    const totalGames=observed.reduce((sum,d)=>sum+(d.reported||0),0);
    const weighted=totalGames?observed.reduce((sum,d)=>sum+d.average*(d.reported||0),0)/totalGames:null;
    const delta=first!==null&&last!==null&&first!==0?last-first:null;
    const pct=delta!==null?delta/first*100:null;
    const tr=document.createElement("tr");
    tr.className=item.benchmark?"benchmark-series":"school-series";
    tr.style.setProperty("--series-color",item.color);
    const cells=[
      item.name,fmt(first),fmt(last),fmt(ytd),
      delta===null?"—":(delta>0?"+":delta<0?"−":"")+attendanceFormat(Math.abs(delta))+
        " ("+(pct>0?"+":"")+pct.toFixed(1)+"%)",
      low?fmt(low.average)+" ("+low.year+")":"—",
      high?fmt(high.average)+" ("+high.year+")":"—",
      fmt(weighted),String(observed.length),
    ];
    cells.forEach((value,i)=>{
      const cell=document.createElement("td");
      if(i===0){const swatch=document.createElement("i");
        swatch.className="series-swatch"+(item.benchmark?" benchmark-swatch":"");
        swatch.style.background=seriesSwatch(item);cell.append(swatch);}
      if(i===3)cell.className="provisional";
      cell.append(document.createTextNode(value));
      tr.append(cell);
    });
    tbody.append(tr);
  }
}

function renderTrendChart() {
  const section=document.querySelector(".trends-section");
  const selected=cohort.find(s=>Number(s.school_id)===state.schoolId);
  if(!selected){section.hidden=true;return;}
  section.hidden=false;
  const schoolB=cohort.find(s=>Number(s.school_id)===state.schoolBId);
  $("schoolBFilter").value=schoolB?String(state.schoolBId):"";
  renderSuggestedComparisons();
  $("trendTitle").textContent=selected.school_name+(schoolB?" vs. "+schoolB.school_name:"")+" · historical attendance";
  const primary=state.benchmarks[0];
  const membershipDescription=primary?.type==="historical" ?
    "Conference colors follow historical membership." :
    primary?.type==="fixed" ?
    "The 2026 school group is held constant across seasons." :
    primary?.type==="selected" ?
    (primary.followLineage?"Includes documented predecessor conferences.":
      "Conference membership follows each season.") :
    "Custom school group held constant across seasons.";
  $("trendMembershipNote").textContent=membershipDescription;
  $("customGroupControls").hidden=$("conferenceMode").value!=="custom" &&
    !state.benchmarks.some(item=>item.type==="custom");
  renderBenchmarkChips(selected);
  const selectedPalette=teamPalette(state.schoolId);
  const secondPalette=schoolB?teamPalette(state.schoolBId):null;
  const similarSchoolColors=secondPalette &&
    colorsTooSimilar(selectedPalette.primary,secondPalette.primary);
  const series=[
    {key:"school",name:selected.school_name,short:selected.school_name,
      color:selectedPalette.primary,secondary:selectedPalette.secondary,
      width:2.7,data:schoolTrendSeries(state.schoolId),schoolId:state.schoolId,benchmark:false},
    ...(schoolB?[{key:"school-b",name:schoolB.school_name,short:schoolB.school_name,
      color:secondPalette.primary,secondary:secondPalette.secondary,
      dash:similarSchoolColors?"7 3":null,width:2.7,
      data:schoolTrendSeries(state.schoolBId),schoolId:state.schoolBId,benchmark:false}]:[]),
    ...state.benchmarks.map(entry=>({
      key:entry.key,name:benchmarkName(entry,selected),
      short:entry.type==="historical"?"Historical":entry.type==="fixed"?"Current cohort":
        entry.type==="custom"?"Custom group":entry.conference,
      color:benchmarkColor(entry,selected),dash:"5 4",width:2.1,
      data:benchmarkTrendSeries(entry,selected),benchmark:true,
      type:entry.type,followLineage:entry.followLineage,
    })),
  ];
  const key=$("trendSeriesKey");key.replaceChildren();
  series.forEach(item=>{
    const wrapper=document.createElement("span");
    const swatch=document.createElement("i");swatch.className="key-line";
    swatch.style.background=seriesSwatch(item);
    if(item.dash)swatch.classList.add("dashed");
    const label=document.createElement("span");label.textContent=item.name;
    wrapper.append(swatch,label);key.append(wrapper);
  });
  const withheld=new Set(series.filter(s=>s.benchmark).flatMap(s=>s.data
    .filter(d=>d.year<2026 && d.eligible>0 && d.average===null).map(d=>d.year)));
  const annotated=series.some(s=>!s.benchmark && s.data.some(d=>d.average!==null &&
    disruptionsStarting(disruptionRows,s.schoolId,d.year).length));
  const coverageNote=(withheld.size ?
    [...withheld].sort().map(year=>year===2020?"2020 unavailable":year+" benchmark unavailable").join(" · ") : "")+
    (annotated?(withheld.size?" · ":"")+"Amber rings mark documented attendance context.":"");
  $("trendCoverageNote").textContent=coverageNote;
  $("trendCoverageNote").hidden=!coverageNote;
  const svg=d3.select("#trendChart");svg.selectAll("*").remove();
  svg.attr("aria-label","Annual home attendance for "+series.map(s=>s.name).join(", ")+
    ", 2001–2026. Use left and right arrows to inspect years.");
  const w=1050,h=330,margin={top:35,right:112,bottom:33,left:66};
  const x=d3.scaleLinear().domain([FIRST_YEAR,LAST_YEAR]).range([margin.left,w-margin.right]);
  const observed=series.flatMap(s=>s.data).filter(d=>d.average!==null);
  const ymax=d3.max(observed,d=>d.average)||80000;
  const y=d3.scaleLinear().domain([0,Math.max(20000,ymax*1.12)]).nice()
    .range([h-margin.bottom,margin.top]);
  const plot=svg.append("g");
  const membershipByYear=new Map(membershipRows
    .filter(r=>Number(r.school_id)===state.schoolId)
    .map(r=>[Number(r.season),r.historical_conference]));
  const periods=[];
  let lastName=null,start=FIRST_YEAR;
  for(let year=FIRST_YEAR;year<=2026;year++){
    const name=year===2026?null:membershipByYear.get(year)||null;
    if(name!==lastName){
      if(lastName)periods.push({name:lastName,from:start,to:year-1});
      lastName=name;start=year;
    }
  }
  for(let i=0;i<periods.length;i++){
    const period=periods[i],left=Math.max(margin.left,x(period.from-.45));
    const right=Math.min(w-margin.right,x(period.to+.45));
    if(i%2===0)plot.append("rect").attr("class","conference-period-band")
      .attr("x",left).attr("y",margin.top).attr("width",Math.max(0,right-left))
      .attr("height",h-margin.top-margin.bottom);
    if(i>0)plot.append("line").attr("class","conference-period-boundary")
      .attr("x1",left).attr("x2",left).attr("y1",margin.top).attr("y2",h-margin.bottom);
    if(period.to-period.from>=1)plot.append("text").attr("class","period-label")
      .attr("x",(left+right)/2).attr("y",17).attr("text-anchor","middle").text(period.name);
  }
  plot.append("g").attr("class","chart-grid").attr("transform","translate("+margin.left+",0)")
    .call(d3.axisLeft(y).ticks(4).tickSize(-(w-margin.left-margin.right)).tickFormat(""));
  plot.append("g").attr("class","chart-axis").attr("transform","translate(0,"+(h-margin.bottom)+")")
    .call(d3.axisBottom(x).tickValues([2001,2005,2010,2015,2020,2026]).tickFormat(d3.format("d")));
  plot.append("g").attr("class","chart-axis").attr("transform","translate("+margin.left+",0)")
    .call(d3.axisLeft(y).ticks(4).tickFormat(v=>Math.round(v/1000)+"k"));
  const line=d3.line().defined(d=>d.average!==null).x(d=>x(d.year)).y(d=>y(d.average));
  for(const item of [...series.filter(s=>s.benchmark),...series.filter(s=>!s.benchmark)]){
    const historic=item.data.filter(d=>d.year<2026);
    if(item.benchmark && (item.type==="historical" ||
      (item.type==="selected" && item.followLineage))){
      const names=[...new Set(historic.map(d=>d.conference).filter(Boolean))];
      for(const name of names)plot.append("path")
        .datum(historic.map(d=>d.conference===name?d:{...d,average:null}))
        .attr("class","chart-line").attr("stroke",conferenceColor(name))
        .attr("stroke-width",item.width).attr("stroke-dasharray",item.dash)
        .attr("stroke-opacity",.9).attr("d",line);
      // Connect actual conference changes explicitly; retain the new era's color.
      for(let i=1;i<historic.length;i++) {
        const prior=historic[i-1],now=historic[i];
        if(prior.average===null || now.average===null ||
           !prior.conference || !now.conference || prior.conference===now.conference)continue;
        plot.append("path").attr("class","chart-line")
          .attr("d",`M${x(prior.year)},${y(prior.average)}L${x(now.year)},${y(now.average)}`)
          .attr("stroke",conferenceColor(now.conference))
          .attr("stroke-width",item.width).attr("stroke-dasharray",item.dash)
          .attr("stroke-opacity",.9);
      }
    }else{
      plot.append("path").datum(historic).attr("class","chart-line")
        .attr("stroke",item.color).attr("stroke-width",item.width)
        .attr("stroke-dasharray",item.dash||null)
        .attr("stroke-opacity",item.benchmark?.9:1).attr("d",line);
    }
    const point2025=item.data.find(d=>d.year===2025);
    const point2026=item.data.find(d=>d.year===2026);
    if(point2025?.average!==null && point2026?.average!==null &&
      point2025 && point2026 && Number.isFinite(point2026.average)){
      plot.append("path").attr("d","M"+x(2025)+","+y(point2025.average)+"L"+
        x(2026)+","+y(point2026.average))
        .attr("stroke",item.color).attr("stroke-width",1.8)
        .attr("stroke-dasharray",item.benchmark?"2 4":"4 4").attr("fill","none");
    }
    plot.selectAll(null).data(item.data.filter(d=>d.average!==null)).enter()
      .append("circle").attr("class","chart-dot")
      .attr("cx",d=>x(d.year)).attr("cy",d=>y(d.average))
      .attr("r",d=>d.year===2026?4.7:item.benchmark?2.3:3.2)
      .attr("fill",d=>d.year===2026||item.benchmark?themeColor("--paper"):item.color)
      .attr("stroke",d=>seriesPointColor(item,d))
      .attr("stroke-width",d=>d.year===2026?2.1:1.3);
    if(!item.benchmark){
      plot.selectAll(null).data(item.data.filter(d=>d.average!==null&&
        disruptionsStarting(disruptionRows,item.schoolId,d.year).length)).enter()
        .append("circle").attr("class","disruption-ring")
        .attr("cx",d=>x(d.year)).attr("cy",d=>y(d.average))
        .attr("r",6).attr("fill","none").attr("stroke","#a46b37")
        .attr("stroke-width",1.4).attr("pointer-events","none");
    }
  }
  // Place last-year direct labels in collision-free lanes, preserving chart height.
  const ends=series.map(item=>{
    const last=item.data.filter(d=>d.average!==null).at(-1);
    return last?{item,last,raw:y(last.average),display:y(last.average)}:null;
  }).filter(Boolean).sort((a,b)=>a.raw-b.raw);
  const minY=margin.top+12,maxY=h-margin.bottom-7,spacing=15;
  ends.forEach((e,i)=>e.display=Math.max(e.raw,i?ends[i-1].display+spacing:minY));
  if(ends.length&&ends.at(-1).display>maxY){
    ends.at(-1).display=maxY;
    for(let i=ends.length-2;i>=0;i--)ends[i].display=Math.min(ends[i].display,ends[i+1].display-spacing);
  }
  for(const e of ends){
    const xEnd=x(e.last.year),xLabel=x(2026)+12;
    plot.append("path").attr("class","chart-end-leader")
      .attr("d","M"+(xEnd+3)+","+e.raw+" L"+(xLabel-4)+","+e.display)
      .attr("stroke",e.item.color);
    plot.append("text").attr("x",xLabel).attr("y",e.display+3)
      .attr("fill",e.item.color).attr("font-size",10.5).text(e.item.short);
  }
  plot.append("text").attr("x",margin.left).attr("y",27).attr("fill",themeColor("--soft"))
    .attr("font-size",10).text("REPORTED SPECTATORS / HOME GAME");
  const hover=plot.append("g").attr("pointer-events","none").style("display","none");
  const rule=hover.append("line").attr("class","chart-hover-rule")
    .attr("y1",margin.top).attr("y2",h-margin.bottom);
  const dots=hover.append("g");
  let hoverYear=2025;
  function showYear(year){
    hoverYear=Math.max(FIRST_YEAR,Math.min(LAST_YEAR,year));
    rule.attr("x1",x(hoverYear)).attr("x2",x(hoverYear));
    hover.style("display",null);
    const points=series.map(item=>({item,d:item.data.find(d=>d.year===hoverYear)}))
      .filter(row=>row.d?.average!==null && row.d?.average!==undefined);
    dots.selectAll("circle").data(points,d=>d.item.key).join("circle")
      .attr("class","chart-hover-point").attr("cx",x(hoverYear))
      .attr("cy",d=>y(d.d.average)).attr("r",5)
      .attr("fill",d=>seriesPointColor(d.item,d.d));
    const tooltip=$("trendTooltip");tooltip.replaceChildren();
    const head=document.createElement("strong");
    head.textContent=hoverYear+(hoverYear===2026?" · provisional YTD":"");
    tooltip.append(head);
    for(const item of series){
      const d=item.data.find(row=>row.year===hoverYear);
      const row=document.createElement("div");row.className="tooltip-series";
      const name=document.createElement("span");
      const chip=document.createElement("i");chip.style.background=seriesPointColor(item,d);
      const conferenceSuffix=item.benchmark && (item.type==="historical" ||
        (item.type==="selected" && item.followLineage)) && d?.conference ?
        " ("+d.conference+")" : "";
      name.append(chip,document.createTextNode(item.name+conferenceSuffix));
      const value=document.createElement("b");
      value.textContent=d?.average===null||!d?"—":attendanceFormat(d.average);
      row.append(name,value);tooltip.append(row);
      if(!item.benchmark){
        const events=disruptionsInSeason(disruptionRows,item.schoolId,hoverYear);
        if(events.length){
          const flag=document.createElement("small");flag.className="disruption-tooltip-note";
          flag.textContent=item.name+" · "+contextSummary(events);
          tooltip.append(flag);
        }
      }
    }
    const note=document.createElement("small");
    if(hoverYear===2026) {
      const coverage=series.filter(item=>item.benchmark).map(item=>{
        const d=item.data.find(point=>point.year===2026);
        return item.short+": "+(d?.verified||0)+"/"+(d?.eligible||0)+
          " schools, "+(d?.reported||0)+"/"+(d?.completed||0)+" games";
      });
      note.textContent="Provisional YTD · "+(ytdThrough?.slice(0,10)||"date unavailable")+
        (coverage.length?" · "+coverage.join(" · "):"");
    } else {
      const sources=series.map(item=>{
        const d=item.data.find(point=>point.year===hoverYear);
        const source=d?.source||d?.attendanceSource;
        return d?.average!=null&&source?item.short+": "+sourceLabel(source):null;
      }).filter(Boolean);
      note.textContent=sources.length?"Sources · "+sources.join(" · "):
        "No source-qualified attendance reported for this season.";
    }
    tooltip.append(note);tooltip.hidden=false;
    positionTrendTooltip();
  }
  const chartViewport=svg.node().parentElement;
  function positionTrendTooltip(){
    const tooltip=$("trendTooltip");
    tooltip.style.right="auto";
    if(window.matchMedia("(max-width: 620px)").matches){
      const viewportRect=chartViewport.getBoundingClientRect();
      tooltip.style.position="fixed";
      tooltip.style.left=Math.max(8,viewportRect.right-tooltip.offsetWidth-8)+"px";
      tooltip.style.top=Math.max(8,Math.min(window.innerHeight-tooltip.offsetHeight-8,
        viewportRect.top+8))+"px";
      return;
    }
    tooltip.style.position="absolute";
    tooltip.style.top="45px";
    const left=Math.max(8,chartViewport.clientWidth-tooltip.offsetWidth-8);
    tooltip.style.left=(chartViewport.scrollLeft+left)+"px";
  }
  chartViewport.onscroll=()=>{
    if(!$("trendTooltip").hidden)positionTrendTooltip();
  };
  svg.on("pointermove",event=>{
    const [px]=d3.pointer(event,svg.node());
    if(px<margin.left||px>w-margin.right)return;
    showYear(Math.round(x.invert(px)));
  }).on("pointerleave",()=>{
    hover.style("display","none");$("trendTooltip").hidden=true;
  }).on("click",event=>{
    const [px]=d3.pointer(event,svg.node());
    if(px>=margin.left && px<=w-margin.right)showYear(Math.round(x.invert(px)));
  }).on("keydown",event=>{
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
    event.preventDefault();
    showYear(event.key==="Home"?FIRST_YEAR:event.key==="End"?LAST_YEAR:
      hoverYear+(event.key==="ArrowRight"?1:-1));
  }).on("focus",()=>showYear(hoverYear)).on("blur",()=>{
    hover.style("display","none");$("trendTooltip").hidden=true;
  });
  $("trendTooltip").hidden=true;
  renderTrendStats(series);
}

/** Cumulative 2026 average after each completed CFBD week, from official pilot reports. */
function renderPilotWeeklyChart(schoolId,year) {
  const wrap=$("weeklyTrendWrap"),svg=d3.select("#weeklyAverageChart");
  svg.selectAll("*").remove();
  const legend=$("weeklySeriesKey");legend.replaceChildren();
  const school=cohort.find(s=>Number(s.school_id)===schoolId);
  const palette=teamPalette(schoolId);
  if (weeklySeriesSchoolId!==schoolId){
    hiddenWeeklySeries.clear();weeklySeriesSchoolId=schoolId;
  }
  const points=year!==2026?[]:PUBLIC_BUILD
    ? weeklyReportedGroupSeries([schoolId],publicOfficialGames,publicWeeklyThroughWeek)
    : pilotWeekly.filter(r=>Number(r.school_id)===schoolId && Number(r.reported_home_games)>0)
      .map(r=>({week:Number(r.week),average:Number(r.average_reported_attendance),
        reportedGames:Number(r.reported_home_games),reportingSchools:1}))
      .filter(r=>Number.isFinite(r.average)).sort((a,b)=>a.week-b.week);
  wrap.hidden=!points.length;
  if (!points.length) return;
  const second=PUBLIC_BUILD?cohort.find(s=>Number(s.school_id)===state.schoolBId):null;
  const secondPalette=second?teamPalette(state.schoolBId):null;
  const sameColors=secondPalette && colorsTooSimilar(palette.primary,secondPalette.primary);
  const series=[
    {key:"school",name:school.school_name,points,color:palette.primary,width:2.7,primary:true},
    ...(second?[{key:"school-b",name:second.school_name,
      points:weeklyReportedGroupSeries([state.schoolBId],publicOfficialGames,publicWeeklyThroughWeek),
      color:secondPalette.primary,width:2.5,dash:sameColors?"7 3":null}]:[]),
    ...(PUBLIC_BUILD?state.benchmarks.map(entry=>({
      key:"benchmark:"+entry.key,name:benchmarkName(entry,school),
      points:weeklyReportedGroupSeries(weeklyBenchmarkSchoolIds(entry,school,cohort,state.groupIds),
        publicOfficialGames,publicWeeklyThroughWeek),
      color:benchmarkColor(entry,school),dash:"5 4",width:1.9,
    })):[]),
  ];
  const plotted=series.filter(item=>item.points.length>0);
  // Height follows selected series, not the temporarily hidden legend state.
  const width=1050,height=plotted.length>=3?230:178;
  const margin={top:24,right:95,bottom:33,left:68};
  svg.attr("viewBox","0 0 "+width+" "+height);
  const visible=plotted.filter(item=>!hiddenWeeklySeries.has(item.key));
  const values=visible.flatMap(item=>item.points);
  const min=d3.min(values,d=>d.average),max=d3.max(values,d=>d.average);
  const pad=Math.max(1800,(max-min)*.22);
  const lastWeek=d3.max(plotted.flatMap(item=>item.points),d=>d.week)||8;
  const x=d3.scaleLinear().domain([0,lastWeek]).range([margin.left,width-margin.right]);
  const y=d3.scaleLinear().domain([Math.max(0,min-pad),max+pad])
    .range([height-margin.bottom,margin.top]);
  svg.append("g").attr("class","chart-axis").attr("transform",
    "translate(0,"+(height-margin.bottom)+")")
    .call(d3.axisBottom(x).ticks(8).tickFormat(d=>Number.isInteger(d)?"W"+d:""));
  svg.append("g").attr("class","chart-axis").attr("transform",
    "translate("+margin.left+",0)")
    .call(d3.axisLeft(y).ticks(height>178?4:3).tickFormat(d=>Math.round(d/1000)+"k"));
  const line=d3.line().x(d=>x(d.week)).y(d=>y(d.average));
  for(const item of visible){
    const layer=svg.append("g").datum(item).attr("class","weekly-series");
    layer.append("path").datum(item.points).attr("class","chart-line")
      .attr("fill","none").attr("stroke",item.color)
      .attr("stroke-width",item.width).attr("stroke-dasharray",item.dash||null)
      .attr("d",line);
    layer.selectAll("circle").data(item.points).join("circle")
      .attr("cx",d=>x(d.week)).attr("cy",d=>y(d.average))
      .attr("r",item.primary?3.8:2.6)
      .attr("fill",item.color).append("title")
      .text(d=>item.name+" · W"+d.week+": "+attendanceFormat(d.average)+
        " fans/game (cumulative · "+d.reportedGames+" game"+
        (d.reportedGames===1?"":"s")+" · "+d.reportingSchools+" school"+
        (d.reportingSchools===1?"":"s")+" reporting)");
  }
  if(!hiddenWeeklySeries.has("school")){
    const last=points.at(-1);
    svg.append("text").attr("x",x(last.week)+9).attr("y",y(last.average)+4)
      .attr("fill",palette.primary).attr("font-size",12).attr("font-weight",600)
      .text(attendanceFormat(last.average));
  }
  for(const item of series){
    const available=item.points.length>0;
    const toggle=!item.primary&&available;
    const element=document.createElement(toggle?"button":"span");
    element.className="weekly-series-item"+
      (hiddenWeeklySeries.has(item.key)?" is-hidden":"");
    if(toggle){
      element.type="button";
      element.setAttribute("aria-pressed",String(!hiddenWeeklySeries.has(item.key)));
      element.setAttribute("aria-label",
        (hiddenWeeklySeries.has(item.key)?"Show ":"Hide ")+item.name+" on 2026 chart");
      element.addEventListener("click",()=>{
        if(hiddenWeeklySeries.has(item.key))hiddenWeeklySeries.delete(item.key);
        else hiddenWeeklySeries.add(item.key);
        renderPilotWeeklyChart(schoolId,year);
      });
      const focus=()=>svg.selectAll(".weekly-series")
        .style("opacity",d=>d.key===item.key?1:0.2);
      const reset=()=>svg.selectAll(".weekly-series").style("opacity",1);
      element.addEventListener("mouseenter",focus);
      element.addEventListener("mouseleave",reset);
      element.addEventListener("focus",focus);
      element.addEventListener("blur",reset);
    }
    const swatch=document.createElement("i");
    swatch.className="key-line"+(item.dash?" dashed":"");
    swatch.style.background=item.color;
    const label=document.createElement("span");
    label.textContent=item.name+(available?"":" (no 2026 reports)");
    element.append(swatch,label);
    legend.append(element);
  }
  svg.attr("aria-label","2026 cumulative reported home attendance: "+
    visible.map(item=>item.name).join(", ")+"; provisional");
  $("weeklyChartCaption").textContent=PUBLIC_BUILD
    ? "2026 cumulative fans per home game · reported games only · provisional"
    : "2026 cumulative average by week · provisional regular-season reports";
}

/** Public 2026 chart values originate in separately verified official reports. */
function renderPublicOfficialGameBars(schoolId) {
  const rows=publicOfficialGames.get(schoolId)||[];
  const tbody=$("gameDetailRows");
  tbody.replaceChildren();
  const maxAttendance=Math.max(1,...rows.map(row=>row[3]));
  for (const [week,date,opponent,attendance,sourceUrl] of rows) {
    const tr=document.createElement("tr");
    const dateCell=document.createElement("td");
    dateCell.className="game-date-cell";
    const displayDate=new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US",{
      month:"short",day:"numeric",timeZone:"UTC"
    });
    dateCell.textContent=`W${week} · ${displayDate}`;
    dateCell.setAttribute("aria-label",`${date}, week ${week}`);
    const opponentCell=document.createElement("td");
    opponentCell.textContent=opponent;
    const citation=document.createElement("a");
    citation.className="game-source-link";
    citation.href=sourceUrl;
    citation.target="_blank";
    citation.rel="noopener noreferrer";
    citation.textContent="Source";
    citation.setAttribute("aria-label",`Official attendance source for ${opponent} on ${date}`);
    opponentCell.append(citation);
    const attendanceCell=document.createElement("td");
    const content=document.createElement("div");
    content.className="game-attendance-cell";
    const number=document.createElement("span");
    number.className="game-attendance-number";
    number.textContent=attendanceFormat(attendance);
    const track=document.createElement("span");
    track.className="game-bar-track";
    const bar=document.createElement("span");
    bar.className="game-bar-fill";
    bar.style.width=(attendance/maxAttendance*100).toFixed(1)+"%";
    track.append(bar);content.append(number,track);attendanceCell.append(content);
    tr.append(dateCell,opponentCell,attendanceCell);tbody.append(tr);
  }
  return rows.length;
}

const HOME_GAME_TIMEZONES = {
  AL:"America/Chicago",AR:"America/Chicago",AZ:"America/Phoenix",
  CA:"America/Los_Angeles",CO:"America/Denver",CT:"America/New_York",
  DE:"America/New_York",FL:"America/New_York",GA:"America/New_York",
  HI:"Pacific/Honolulu",IA:"America/Chicago",ID:"America/Denver",
  IL:"America/Chicago",IN:"America/New_York",KS:"America/Chicago",
  KY:"America/New_York",LA:"America/Chicago",MA:"America/New_York",
  MD:"America/New_York",MI:"America/New_York",MN:"America/Chicago",
  MO:"America/Chicago",MS:"America/Chicago",MT:"America/Denver",
  NC:"America/New_York",ND:"America/Chicago",NE:"America/Chicago",
  NJ:"America/New_York",NM:"America/Denver",NV:"America/Los_Angeles",
  NY:"America/New_York",OH:"America/New_York",OK:"America/Chicago",
  OR:"America/Los_Angeles",PA:"America/New_York",RI:"America/New_York",
  SC:"America/New_York",SD:"America/Chicago",TN:"America/Chicago",
  TX:"America/Chicago",UT:"America/Denver",VA:"America/New_York",
  VT:"America/New_York",WA:"America/Los_Angeles",WI:"America/Chicago",
  WV:"America/New_York",WY:"America/Denver",DC:"America/New_York",
};
function localHomeGameDate(startDate, schoolId) {
  const loc=locations.get(schoolId),stateName=loc?.state,longitude=Number(loc?.longitude);
  let zone=HOME_GAME_TIMEZONES[stateName] || "America/New_York";
  if(stateName==="KY" && longitude < -86)zone="America/Chicago";
  if(stateName==="TN" && longitude > -86)zone="America/New_York";
  if(stateName==="TX" && longitude < -104)zone="America/Denver";
  try {
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:zone,year:"numeric",
      month:"2-digit",day:"2-digit"}).formatToParts(new Date(startDate));
    const part=type=>parts.find(p=>p.type===type)?.value;
    return part("year")+"-"+part("month")+"-"+part("day");
  } catch {return String(startDate||"").slice(0,10);}
}

/** A separate CFBD game-detail panel; never counted as an NCAA annual component. */
async function renderCfbdGameDetails() {
  const requestId=++gameRequestId;
  const section=document.querySelector(".game-details-section");
  if (state.schoolId===null) {section.hidden=true;return;}
  section.hidden=false;
  const year=state.target, schoolId=state.schoolId;
  const name=cohort.find(s=>Number(s.school_id)===schoolId)?.school_name || "School";
  const palette=teamPalette(schoolId);
  $("gameDetailTitle").textContent=PUBLIC_BUILD
    ? `${name} · 2026 Home Attendance` : `${name} · ${year} games`;
  $("gameDetailRows").replaceChildren();
  section.style.setProperty("--school-primary",palette.primary);
  $("weeklyTrendWrap").hidden=true;
  d3.select("#weeklyAverageChart").selectAll("*").remove();
  if (PUBLIC_BUILD) {
    // Always show 2026 verified game reports, independent of the map comparison years.
    $("gameDetailsSourceLink").href="./methodology.html#views";
    $("gameDetailsSourceLink").textContent="Methodology";
    $("gameSourceNote").hidden=true;
    const count=renderPublicOfficialGameBars(schoolId);
    section.querySelector(".game-table-wrap").hidden=count===0;
    const dataThrough=ytdDataThroughLabel();
    $("gameDetailStatus").textContent=(count
      ? `${count} home games reported`
      : "No home games reported yet")+
      ` · Provisional${dataThrough?` · Data through ${dataThrough}`:""}`;
    renderPilotWeeklyChart(schoolId,2026);
    return;
  }
  $("gameSourceNote").hidden=false;
  if ([2004,2005,2009,2010,2011].includes(year)) {
    $("gameDetailStatus").textContent="CFBD game attendance quarantined for known false zeros; bars withheld.";
    return;
  }
  $("gameDetailStatus").textContent=`Loading ${year} CFBD game records…`;
  let games;
  try {
    if (!gameSeasonCache.has(year))
      gameSeasonCache.set(year,d3.csv(DATA.historyGames(year)));
    games=await gameSeasonCache.get(year);
  } catch (error) {
    gameSeasonCache.delete(year);
    if (requestId===gameRequestId) $("gameDetailStatus").textContent="CFBD game records unavailable; nothing estimated.";
    return;
  }
  if (requestId!==gameRequestId) return;
  const displayedGames=year===2026 ? overlay2026OfficialGames(games,pilotGames) : games;
  const rows=cfbdHomeGameDetails(displayedGames,schoolId,year);
  const known=rows.filter(r=>r.attendance!==null);
  const official=year===2026 ? pilotGames.filter(r=>Number(r.school_id)===schoolId) : [];
  const officialLink=$("gameDetailsSourceLink");
  const sourceNote=$("gameSourceNote");
  officialLink.href=official.length?official[0].source_url:"https://collegefootballdata.com/";
  officialLink.textContent=official.length?(official[0].source_type==="official_school_2026"?"University game results":"Conference game reports"):"CFBD game data";
  sourceNote.textContent=official.length ?
    "2026 provisional official game reports · CFBD regular-season home-game schedule; NCAA final annual may differ." :
    "CFBD game reports · separate from annual school totals.";
  sourceNote.textContent+=" Sellout badges require an explicit university confirmation; unmarked games may also have sold out."
  renderPilotWeeklyChart(schoolId,year);
  const missing=rows.length-known.length;
  $("gameDetailStatus").textContent=rows.length ?
    rows.length+(year===2026?" completed regular-season home games (provisional)":" completed home games")+" · "+known.length+" with reported attendance"+
      (missing?" · "+missing+" unavailable":"") :
    "No completed non-neutral regular-season home games found.";
  if (!rows.length) return;
  const maxGame = d3.max(known,d=>d.attendance) || 1;
  const tbody=$("gameDetailRows");
  for (const game of rows) {
    const tr=document.createElement("tr");
    for (const label of [localHomeGameDate(game.startDate,schoolId),game.opponent]) {
      const td=document.createElement("td");td.textContent=label;tr.append(td);
    }
    const td=document.createElement("td");
    const cell=document.createElement("div");cell.className="game-attendance-cell";
    const value=document.createElement("span");
    value.className="game-attendance-number"+(game.attendance===null?" game-bar-unavailable":"");
    value.textContent=game.attendance===null?"Not reported":attendanceFormat(game.attendance);
    cell.append(value);
    const sellout=verifiedSelloutForGame(verifiedSellouts,game,schoolId,year);
    if(sellout) {
      const badge=document.createElement("a");
      badge.className="game-sellout-badge";
      badge.href=sellout.sourceUrl;
      badge.target="_blank";
      badge.rel="noopener noreferrer";
      badge.textContent="Sellout";
      badge.title="Officially verified sellout · view university source";
      badge.setAttribute("aria-label","Verified sellout: "+name+" vs "+game.opponent+
        " on "+localHomeGameDate(game.startDate,schoolId)+"; open university source");
      cell.append(badge);
    }
    if (game.attendance!==null) {
      const track=document.createElement("span");track.className="game-bar-track";
      const bar=document.createElement("span");bar.className="game-bar-fill";
      bar.style.width=(Math.max(0,game.attendance)/maxGame*100).toFixed(1)+"%";
      track.append(bar);cell.append(track);
    }
    td.append(cell);tr.append(td);tbody.append(tr);
  }
}

// A theme change redraws direct SVG colors without resetting filters or the selected school.
narrowMapQuery.addEventListener("change", () => {
  if(viewport && cohort.length && schoolIndex.size) renderMap();
});
window.addEventListener("attendance-theme-change", () => {
  if (viewport && cohort.length && schoolIndex.size) render();
});

function render() {
  if(state.schoolId===null){hiddenWeeklySeries.clear();weeklySeriesSchoolId=null;}
  syncMapFocusControls();
  mapPoints=selectedPrograms(cohort,schoolIndex,locations,{...state,conference:"All"});
  const ids=activeFocusIds();
  currentPoints=ids && state.mapFocus!=="school"
    ? mapPoints.filter(p=>ids.has(p.school_id)) : mapPoints;
  renderMap();renderSchoolCard();renderStats();renderConferenceComparison();renderQuickTrend();renderTrendChart();
  void renderCfbdGameDetails();
}

async function bootPublic() {
  if (!d3) throw new Error("Visualization library did not load. Check the network.");
  const data = await d3.json("./data/summary.json");
  if (data?.schema_version !== 1 || !Array.isArray(data.schools) ||
      data.schools.length < 2500 || !Array.isArray(data.memberships) ||
      !data.freshness?.data_through || data.freshness.status !== "provisional" ||
      data.weekly_2026?.season !== 2026 ||
      data.weekly_2026?.kind !== "cumulative_weekly_home_average" ||
      !Array.isArray(data.weekly_2026.schools) || !Array.isArray(data.weekly_2026.conferences) ||
      data.games_2026?.season !== 2026 || !Array.isArray(data.games_2026.schools))
    throw new Error("Validated public attendance summary is missing or incomplete");
  const mapData = await d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json").catch(()=>null);
  membershipRows = data.memberships;
  cohort = data.cohort;
  schools = data.schools.map(normalizeSchool);
  conferenceRows = data.current_conferences.map(normalizeConference);
  historicalConferenceRows = data.historical_conferences.map(normalizeConference);
  verifiedAnnualYears = new Set(data.years);
  candidateIndex = new Map(data.withheld_candidates.map(r=>[`${r.school_id}:${r.season}`,r]));
  locations = new Map(data.locations.map(normalizeLocation).map(g=>[g.school_id,g]));
  verifiedCapacities = new Map(data.capacities.map(row=>[Number(row.school_id),row]));
  disruptionRows = data.disruptions.map(normalizeDisruption);
  ytdThrough = data.freshness.data_through;
  publicWeeklyThroughWeek = Math.max(0,...data.weekly_2026.schools.flatMap(row=>
    row.points.map(point=>Number(point[0]))));
  publicOfficialGames = new Map(data.games_2026.schools.map(r=>[Number(r.school_id),r.points]));
  schoolIndex = schoolYearIndex(schools);
  if (cohort.length < 130 || locations.size < 130 ||
      conferenceRows.length < 20 || historicalConferenceRows.length < 20 ||
      disruptionRows.length < 9 || !verifiedAnnualYears.has(2026))
    throw new Error("Required public attendance summary dimensions are missing");
  initializeMap(mapData);setupControls();render();
}



async function boot() {
  return PUBLIC_BUILD ? bootPublic() : bootPrivate();
}

boot().catch(error=>{
  console.error("Attendance visualization initialization failed",error);
  $("mapStatus").textContent = "Could not load the validated attendance summaries.";
  $("comparisonNotice").textContent = "Required source-qualified annual attendance data are missing or invalid.";
  $("selectedCoverage").textContent = "Data unavailable; no estimates displayed.";
});
