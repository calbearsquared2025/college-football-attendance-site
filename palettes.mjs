// Approximate editorial palettes keyed by stable CFBD school IDs, not names or conferences.
// Used only for UI styling; attendance data remains from separately attributed sources.
// Snapshot seeded from publicly distributed school-color metadata and curated for contrast.
// White and pale secondaries are displayed with a dark outline.
const SCHOOL_COLORS = Object.freeze({
  2: ["#03244D", "#F1F2F3"],
  5: ["#003B28", "#FFC845"],
  6: ["#003E7E", "#BF0D3E"],
  8: ["#9C1831", "#000000"],
  9: ["#8C1D40", "#FFC627"],
  12: ["#002449", "#00205B"],
  16: ["#00573C", "#CDB97D"],
  21: ["#BF2C37", "#A8996E"],
  23: ["#005893", "#FDBA31"],
  24: ["#A80532", "#FFFFFF"],
  25: ["#003262", "#FDB515"],
  26: ["#005C8E", "#FFC72C"],
  30: ["#AE2531", "#FFC72C"],
  36: ["#004537", "#FFC425"],
  38: ["#1F1F1F", "#CFB87C"],
  41: ["#001D40", "#F1F2F3"],
  48: ["#033594", "#E8CE31"],
  52: ["#782F40", "#CEB888"],
  55: ["#B50500", "#B5B7BA"],
  57: ["#0021A5", "#FA4616"],
  58: ["#004A36", "#231F20"],
  59: ["#003057", "#B3A369"],
  61: ["#CC0000", "#000000"],
  62: ["#003420", "#FFFFFF"],
  66: ["#660015", "#830B2C"],
  68: ["#09347A", "#D8D9DA"],
  77: ["#372286", "#D6CAC1"],
  84: ["#7D110C", "#EEEDEB"],
  87: ["#0C2340", "#C99700"],
  96: ["#005DAA", "#FFFFFF"],
  97: ["#AD000A", "#CCCCCC"],
  98: ["#F32026", "#B3B5B8"],
  99: ["#22005C", "#FDD023"],
  103: ["#88001A", "#A39161"],
  113: ["#971B2F", "#FFFFFF"],
  120: ["#D5002B", "#FFCD00"],
  127: ["#18453B", "#FFFFFF"],
  130: ["#00274C", "#FFCB05"],
  135: ["#7F011B", "#7A0019"],
  142: ["#000000", "#000000"],
  145: ["#001148", "#00205B"],
  150: ["#001A57", "#F1F2F3"],
  151: ["#4B1869", "#F0907B"],
  152: ["#EF1216", "#231F20"],
  153: ["#99BFE5", "#13294B"],
  154: ["#9E7E38", "#000000"],
  158: ["#F20017", "#F5F1E7"],
  164: ["#D21034", "#FFFFFF"],
  166: ["#891216", "#000000"],
  167: ["#000000", "#231F20"],
  183: ["#F37321", "#0D1D37"],
  189: ["#2B1000", "#492000"],
  193: ["#A4000C", "#F0F0F0"],
  194: ["#BB0000", "#666666"],
  195: ["#295A29", "#E4BB85"],
  197: ["#FF6500", "#FF9900"],
  201: ["#7B0000", "#CCCCCC"],
  202: ["#004371", "#EE3B33"],
  204: ["#C34500", "#DEA076"],
  213: ["#00265D", "#002E5C"],
  218: ["#A80532", "#A7A9AC"],
  221: ["#003263", "#231F20"],
  228: ["#F66733", "#522D80"],
  235: ["#002447", "#231F20"],
  238: ["#000000", "#231F20"],
  239: ["#004834", "#FFB81C"],
  242: ["#003D7D", "#D1D5D8"],
  245: ["#5C0025", "#FFFFFF"],
  248: ["#C90822", "#231F20"],
  249: ["#00853D", "#000000"],
  251: ["#EE7524", "#F0F0F0"],
  252: ["#001E4C", "#FFFFFF"],
  254: ["#890012", "#7E8083"],
  256: ["#450084", "#CBB778"],
  258: ["#00204E", "#002D62"],
  259: ["#74232D", "#C2C1BA"],
  264: ["#2B2F64", "#E8E3D3"],
  265: ["#94022A", "#6A747C"],
  275: ["#A00001", "#F7F7F7"],
  276: ["#186329", "#BE854C"],
  277: ["#FFC600", "#EAAA00"],
  278: ["#C41230", "#231F20"],
  290: ["#003775", "#F0F0F0"],
  295: ["#00507D", "#A1D2F1"],
  309: ["#CE181E", "#FFFFFF"],
  324: ["#007073", "#876447"],
  326: ["#4E1719", "#B4975A"],
  328: ["#003263", "#949CA1"],
  333: ["#690014", "#F1F2F3"],
  338: ["#000000", "#FDBB30"],
  344: ["#762123", "#C8C8C8"],
  349: ["#CE9C00", "#231F20"],
  356: ["#F77329", "#FA6300"],
  2005: ["#004A7B", "#FFFFFF"],
  2006: ["#00285E", "#84754E"],
  2026: ["#222222", "#FFCC00"],
  2032: ["#E81018", "#000000"],
  2050: ["#DA0000", "#FFFFFF"],
  2084: ["#041A9B", "#EBEBEB"],
  2116: ["#000000", "#231F20"],
  2117: ["#6A0032", "#FFFFFF"],
  2132: ["#000000", "#717073"],
  2199: ["#00331B", "#F0F0F0"],
  2226: ["#004B85", "#BB2F4C"],
  2229: ["#001538", "#C5960C"],
  2247: ["#1E539A", "#EBEBEB"],
  2294: ["#000000", "#FFE100"],
  2305: ["#0022B4", "#E8000D"],
  2306: ["#633194", "#E7D2AD"],
  2309: ["#002445", "#F0B510"],
  2335: ["#071740", "#A61F21"],
  2348: ["#002D65", "#D3313A"],
  2390: ["#004325", "#F0F0F0"],
  2393: ["#0079C2", "#C3C5C8"],
  2426: ["#131630", "#B6A77C"],
  2429: ["#0C562D", "#CFAB7A"],
  2433: ["#800029", "#E5BB4B"],
  2439: ["#000000", "#C2C4C6"],
  2440: ["#153E5F", "#8E9295"],
  2449: ["#01402A", "#FFFFFF"],
  2459: ["#F1122C", "#CC0000"],
  2483: ["#044520", "#FEE123"],
  2509: ["#1F1F1F", "#CEB888"],
  2534: ["#F78F1E", "#F78E1E"],
  2567: ["#E32F38", "#ECDCB9"],
  2572: ["#FFAA3C", "#FFC423"],
  2579: ["#670010", "#000000"],
  2623: ["#5F0000", "#E8E8E8"],
  2628: ["#3C377D", "#F1F2F3"],
  2633: ["#EE9627", "#FFFFFF"],
  2636: ["#002A5C", "#F47321"],
  2638: ["#002843", "#FF6F12"],
  2641: ["#C80025", "#231F20"],
  2649: ["#00488F", "#FFD51D"],
  2653: ["#AE0210", "#88898C"],
  2655: ["#005837", "#3BAF29"],
  2711: ["#B59966", "#BFA979"],
  2751: ["#533B22", "#FFFFFF"],
});

// Historical, conference-branded display hues, rather than an arbitrary category palette.
// Era-specific names retain distinct colors; predecessor/successor membership is handled by data.
export const CONFERENCE_COLORS = Object.freeze({
  "ACC": "#003DA5",
  "Big Ten": "#0088CE",
  "Big 12": "#C41230",
  "SEC": "#1D366C",
  "Pac-10": "#001489",
  "Pac-12": "#0057B7",
  "American Athletic": "#D81E05",
  "Big East": "#1A427D",
  "Sun Belt": "#F6A800",
  "Mid-American": "#046A38",
  "Mountain West": "#4F2D7F",
  "Conference USA": "#00263A",
  "FBS Independents": "#566A70",
  "Western Athletic": "#862633",
});
const CONFERENCE_ALIASES = Object.freeze({
  "Pac-8": "Pac-10",
});
const PAPER = "#FAF9F6";
const HEX = /^#[0-9a-f]{6}$/i;
const FALLBACK = ["#52636A", "#D1D7D2"];

function rgb(hex) {
  return [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
}
function brightness(hex) {
  const channels = rgb(hex).map(value => {
    const c = value / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
export function contrastRatio(foreground, background = PAPER) {
  if (!HEX.test(foreground) || !HEX.test(background)) return 0;
  const a = brightness(foreground), b = brightness(background);
  return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
}
// Keep hues recognizable but darken low-contrast colors for fine lines and text.
export function readableColor(color) {
  if (!HEX.test(color)) return FALLBACK[0];
  const original = rgb(color);
  for (let scale = 1; scale >= 0; scale -= .025) {
    const next = "#" + original.map(c => Math.round(c * scale).toString(16).padStart(2,"0")).join("");
    if (contrastRatio(next) >= 4.5) return next.toUpperCase();
  }
  return "#111111";
}
export function hasTeamPalette(schoolId) {
  return Object.hasOwn(SCHOOL_COLORS,Number(schoolId));
}
export function teamPalette(schoolId) {
  const pair = SCHOOL_COLORS[Number(schoolId)] ?? FALLBACK;
  return {primary: readableColor(pair[0]), secondary: pair[1]};
}
export function conferenceColor(conference) {
  const canonical = CONFERENCE_ALIASES[conference] || conference;
  return readableColor(CONFERENCE_COLORS[canonical] || FALLBACK[0]);
}
export function colorsTooSimilar(a, b) {
  if (!HEX.test(a) || !HEX.test(b)) return false;
  const ca = rgb(a), cb = rgb(b);
  return Math.hypot(...ca.map((c,i) => c - cb[i])) < 70;
}
