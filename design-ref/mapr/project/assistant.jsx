/* MAPR Assistant — natural-language query engine grounded on the live feed,
   plus the bottom-center composer + conversation thread (Codex/Claude style). */
const { useState: aUS, useEffect: aUE, useRef: aUR } = React;

/* ============================================================
   1. KNOWLEDGE — lexicons for grounding queries on the dataset
   ============================================================ */

const ISO_NAME = {
  JPN:"Japan", TUR:"Türkiye", USA:"United States", BEL:"Belgium", SGP:"Singapore",
  FRA:"France", ARG:"Argentina", IND:"India", EGY:"Egypt", UKR:"Ukraine", ISR:"Israel",
  SSD:"South Sudan", CHN:"China", AUS:"Australia", GBR:"United Kingdom", COD:"DR Congo",
  YEM:"Yemen", HKG:"Hong Kong", MEX:"Mexico", DEU:"Germany", ZAF:"South Africa",
  UZB:"Uzbekistan", BRA:"Brazil", RUS:"Russia", KOR:"South Korea", SVN:"Slovenia",
  CHL:"Chile", IRQ:"Iraq", ITA:"Italy", CHE:"Switzerland", ETH:"Ethiopia", BGD:"Bangladesh",
};

// country / city / alias -> ISO
const NAME_ISO = {
  japan:"JPN", honshu:"JPN", sendai:"JPN", tokyo:"JPN",
  turkey:"TUR", "türkiye":"TUR", turkiye:"TUR", marmara:"TUR",
  usa:"USA", "united states":"USA", america:"USA", american:"USA", washington:"USA", texas:"USA", florida:"USA", gulf:"USA",
  belgium:"BEL", brussels:"BEL",
  singapore:"SGP",
  france:"FRA", french:"FRA", paris:"FRA",
  argentina:"ARG", "buenos aires":"ARG",
  india:"IND", indian:"IND", delhi:"IND", maharashtra:"IND", mumbai:"IND",
  egypt:"EGY", egyptian:"EGY", cairo:"EGY",
  ukraine:"UKR", ukrainian:"UKR", kyiv:"UKR", kharkiv:"UKR",
  israel:"ISR", israeli:"ISR", levant:"ISR",
  "south sudan":"SSD",
  china:"CHN", chinese:"CHN", beijing:"CHN", shanghai:"CHN", yangtze:"CHN",
  australia:"AUS", "australian":"AUS", sydney:"AUS", nsw:"AUS",
  uk:"GBR", britain:"GBR", british:"GBR", "united kingdom":"GBR", london:"GBR", england:"GBR",
  congo:"COD", drc:"COD", "dr congo":"COD", equateur:"COD",
  yemen:"YEM", "bab-el-mandeb":"YEM", "red sea":"YEM",
  "hong kong":"HKG",
  mexico:"MEX", "mexico city":"MEX",
  germany:"DEU", german:"DEU", berlin:"DEU",
  "south africa":"ZAF", "cape town":"ZAF",
  uzbekistan:"UZB", tajik:"UZB", kyrgyz:"UZB",
  brazil:"BRA", brazilian:"BRA", "rio":"BRA", "são paulo":"BRA", "sao paulo":"BRA",
  russia:"RUS", russian:"RUS", moscow:"RUS",
  korea:"KOR", "south korea":"KOR", seoul:"KOR",
  slovenia:"SVN",
  chile:"CHL", santiago:"CHL",
  iraq:"IRQ", baghdad:"IRQ", "green zone":"IRQ",
  italy:"ITA", italian:"ITA", rome:"ITA",
  switzerland:"CHE", swiss:"CHE",
  ethiopia:"ETH", amhara:"ETH", "addis":"ETH",
  bangladesh:"BGD", dhaka:"BGD",
};

// region groups -> ISO sets
const GROUP_ISO = {
  europe:["FRA","BEL","GBR","DEU","ITA","CHE","SVN","UKR"],
  "western europe":["FRA","BEL","GBR","DEU","ITA","CHE"],
  "eastern europe":["UKR","RUS"],
  mena:["ISR","EGY","YEM","IRQ"],
  "middle east":["ISR","IRQ","YEM"],
  africa:["SSD","COD","ZAF","ETH","EGY"],
  "sub-saharan":["SSD","COD","ZAF","ETH"],
  asia:["JPN","SGP","IND","CHN","HKG","KOR","UZB","BGD"],
  "east asia":["JPN","CHN","HKG","KOR"],
  "south asia":["IND","BGD"],
  "southeast asia":["SGP","HKG"],
  latam:["ARG","BRA","CHL","MEX"],
  "latin america":["ARG","BRA","CHL","MEX"],
  "south america":["ARG","BRA","CHL"],
  "north america":["USA","MEX"],
  americas:["USA","MEX","ARG","BRA","CHL"],
  oceania:["AUS"],
  cis:["RUS","UZB","UKR"],
};

const CAT_KEYWORDS = {
  conflict:["conflict","war","military","frontier","escalation","rocket","drone","strike on","artillery","clash","clashes","armed","offensive","ceasefire","troops"],
  cyber:["cyber","ransomware","hack","hacked","breach","intrusion","malware","phishing","apt","ddos","data broker","exploit","vulnerability","outage"],
  unrest:["protest","protests","unrest","demonstration","riot","march","rally","strike","walkout","picket","civil"],
  seismic:["earthquake","quake","seismic","tremor","tsunami","aftershock","magnitude"],
  weather:["weather","storm","flood","flooding","hurricane","typhoon","cyclone","heatwave","bushfire","wildfire","rainfall","avalanche","drought"],
  economic:["economic","economy","market","markets","inflation","currency","forex","rate","repo","gilts","stocks","bond","yuan","pound","won","franc"],
  health:["health","outbreak","disease","cholera","dengue","virus","viral","fever","epidemic","pandemic","hemorrhagic","measles"],
  maritime:["maritime","vessel","ship","shipping","strait","naval","navy","tanker","port","harbour","harbor"],
  tech:["tech","launch","orbital","rocket launch","satellite","space","cloud"],
};
const CAT_LABEL = {
  conflict:"conflict", cyber:"cyber", unrest:"civil unrest", seismic:"seismic",
  weather:"weather", economic:"economic", health:"public-health", maritime:"maritime", tech:"tech",
};

const TIER_WORDS = {
  black:["black","catastrophic","catastrophe"],
  red:["red","critical","severe","high-severity","high severity","high priority","worst","serious"],
  amber:["amber","moderate","medium","elevated"],
  green:["green","low","minor","routine","nominal"],
};

const STOP = new Set("the a an of in on at to for and or is are was show me find list any what whats what's are there how many events event give all current right now happening on map me about with from over near around please tell".split(/\s+/));

/* ============================================================
   2. PARSE — extract a structured query from free text
   ============================================================ */

function parseWindow(q){
  const named = { "15m":0.25,"15 min":0.25,"15 minutes":0.25,"1h":1,"hour":1,"6h":6,"6 hours":6,"24h":24,"day":24,"today":24,"72h":72,"3 days":72,"week":168,"7d":168 };
  // "last/past N hours|minutes|days"
  const m = q.match(/(?:last|past|within)\s+(\d+)\s*(min|minute|minutes|h|hr|hour|hours|d|day|days|week|weeks)/);
  if (m){
    const n = parseInt(m[1],10); const u = m[2];
    if (/min/.test(u)) return { hrs:n/60, label:`last ${n} min` };
    if (/^h|hr|hour/.test(u)) return { hrs:n, label:`last ${n}h` };
    if (/^d|day/.test(u)) return { hrs:n*24, label:`last ${n}d` };
    if (/week/.test(u)) return { hrs:n*168, label:`last ${n}w` };
  }
  if (/last hour|past hour|this hour/.test(q)) return { hrs:1, label:"last 1h" };
  if (/today|last day|past day|24 ?h/.test(q)) return { hrs:24, label:"last 24h" };
  if (/this week|past week|last week|7 ?d/.test(q)) return { hrs:168, label:"last 7d" };
  if (/last 6 ?h|past 6 ?h|6 hours/.test(q)) return { hrs:6, label:"last 6h" };
  return null;
}

function parseQuery(text){
  const q = " " + text.toLowerCase().trim() + " ";
  const tiers = [];
  for (const [t,words] of Object.entries(TIER_WORDS))
    if (words.some(w => q.includes(" "+w) || q.includes(w+" "))) tiers.push(t);

  const cats = [];
  for (const [c,words] of Object.entries(CAT_KEYWORDS))
    if (words.some(w => q.includes(w))) cats.push(c);

  // regions: groups first, then country/city names
  const regions = new Set();
  for (const [g,iso] of Object.entries(GROUP_ISO)) if (q.includes(g)) iso.forEach(i=>regions.add(i));
  for (const [name,iso] of Object.entries(NAME_ISO)) if (q.includes(" "+name) || q.includes(name+" ")) regions.add(iso);

  // min severity
  let minSev = 0;
  const sm = q.match(/(?:sev|severity|score)\s*(?:>=|>|above|over|at least)?\s*(\d+(?:\.\d+)?)/) ||
             q.match(/(?:above|over|at least|greater than)\s+(\d+(?:\.\d+)?)/);
  if (sm) minSev = parseFloat(sm[1]);

  // top N
  let topN = null;
  const tn = q.match(/top\s+(\d+)/) || q.match(/(\d+)\s+(?:most|worst|highest|biggest)/);
  if (tn) topN = parseInt(tn[1],10);

  const win = parseWindow(q);

  // intents
  const intent =
    /anomal|spik|surg|unusual|trend|spiking/.test(q) ? "anomalies" :
    /watchlist|hotspot|which (regions|countries)|top (regions|countries|hotspots)|where.*(worst|most)/.test(q) ? "regions" :
    /how many|count|number of|tally/.test(q) ? "count" :
    /brief|sitrep|summar|overview|rundown|catch me up|what'?s (going on|happening)|situation/.test(q) ? "brief" :
    /top|worst|most severe|highest|biggest|priorit/.test(q) ? "top" :
    "filter";

  // free-text keyword tokens (for title search fallback)
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s-]/g," ").split(/\s+/)
    .filter(w => w.length>=4 && !STOP.has(w));

  return { tiers, cats, regions:[...regions], minSev, topN, win, intent, tokens, raw:text };
}

/* ============================================================
   3. APPLY — filter events + craft a grounded reply
   ============================================================ */

const TIER_RANK = { black:4, red:3, amber:2, green:1 };
const fmtAgo = (ts)=>window.MAPR_SHELL.ago(ts);

function applyFilters(events, p, defaultWindowMs){
  const now = Date.now();
  const winMs = p.win ? p.win.hrs*3600*1000 : defaultWindowMs;
  let evs = events.filter(e => (now - e.ts) <= winMs);
  if (p.tiers.length) evs = evs.filter(e => p.tiers.includes(e.tier));
  if (p.cats.length)  evs = evs.filter(e => p.cats.includes(e.cat));
  if (p.regions.length) evs = evs.filter(e => p.regions.includes(e.iso));
  if (p.minSev>0) evs = evs.filter(e => e.sev >= p.minSev);
  // keyword fallback only when no structured facet matched at all
  if (!p.tiers.length && !p.cats.length && !p.regions.length && p.minSev===0 && p.tokens.length){
    const kw = evs.filter(e => p.tokens.some(t =>
      e.title.toLowerCase().includes(t) || (e.summary||"").toLowerCase().includes(t) || e.cat.includes(t)));
    if (kw.length) evs = kw;
  }
  return evs.sort((a,b)=> b.sev - a.sev || b.ts - a.ts);
}

function describeScope(p){
  const bits = [];
  if (p.tiers.length) bits.push(p.tiers.map(t=>t).join("/") + "-tier");
  if (p.cats.length) bits.push(p.cats.map(c=>CAT_LABEL[c]).join(" / "));
  else bits.push("events");
  if (p.minSev>0) bits.push("sev ≥ " + p.minSev);
  let scope = bits.join(" ");
  if (p.regions.length){
    const names = p.regions.length<=2 ? p.regions.map(i=>ISO_NAME[i]||i).join(" & ") : `${p.regions.length} regions`;
    scope += " · " + names;
  }
  if (p.win) scope += " · " + p.win.label;
  return scope;
}

function tierBreak(evs){
  const c = { black:0, red:0, amber:0, green:0 };
  evs.forEach(e=>c[e.tier]++);
  const parts = [];
  if (c.black) parts.push(`${c.black} black`);
  if (c.red) parts.push(`${c.red} red`);
  if (c.amber) parts.push(`${c.amber} amber`);
  if (c.green) parts.push(`${c.green} green`);
  return parts.join(" · ");
}

function topRegions(evs, n=3){
  const m = new Map();
  evs.forEach(e=>{ const k=e.iso; if(!m.has(k)) m.set(k,0); m.set(k,m.get(k)+1); });
  return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,n)
    .map(([iso,ct])=>`${ISO_NAME[iso]||iso} (${ct})`);
}

function interpret(text, EVENTS, DATA, defaultWindowMs){
  const p = parseQuery(text);
  const winLabel = p.win ? p.win.label : "last 24h";

  // ---- anomalies ----
  if (p.intent === "anomalies"){
    const items = DATA.ANOMALIES;
    const sharp = items[0];
    return {
      reply: `${items.length} signals are running hot against the 14-day baseline. Sharpest right now: ${sharp.label} at ${sharp.delta}. Tap any signal to pivot the feed.`,
      info: { kind:"anomaly", items },
      mapEvents: undefined, scope: null,
    };
  }
  // ---- regions / watchlist ----
  if (p.intent === "regions"){
    const items = [...DATA.REGIONS].sort((a,b)=>b.avg-a.avg).slice(0,6);
    const lead = items[0];
    return {
      reply: `Top hotspots by mean severity: ${lead.name} leads at ${lead.avg.toFixed(1)} across ${lead.count} events, followed by ${items[1].name} (${items[1].avg.toFixed(1)}). Select a region to open its dossier.`,
      info: { kind:"region", items },
      mapEvents: undefined, scope: null,
    };
  }

  const matched = applyFilters(EVENTS, p, defaultWindowMs);
  const scope = describeScope(p);

  // ---- count ----
  if (p.intent === "count"){
    if (!matched.length) return { reply:`No ${scope} in the feed for that window.`, events:[], mapEvents:[], scope };
    return {
      reply: `${matched.length} ${scope} — ${tierBreak(matched)}. Concentrated in ${topRegions(matched,3).join(", ")}.`,
      events: matched.slice(0,6), mapEvents: matched, scope,
    };
  }

  // ---- brief / sitrep ----
  if (p.intent === "brief"){
    const top = matched.slice(0,4);
    if (!matched.length) return { reply:`Nothing matching that scope in the ${winLabel}.`, events:[], mapEvents:[], scope };
    return {
      reply: `${matched.length} events in the ${winLabel}${p.cats.length||p.regions.length?` matching ${scope}`:""} — ${tierBreak(matched)}. Leading developments: ${top.map((e,i)=>`(${i+1}) ${e.title.split(";")[0]}`).join("  ")}.`,
      events: top, mapEvents: matched, scope: p.cats.length||p.regions.length||p.tiers.length ? scope : `feed · ${winLabel}`,
    };
  }

  // ---- top / worst ----
  if (p.intent === "top"){
    const n = p.topN || 5;
    const top = matched.slice(0,n);
    if (!top.length) return { reply:`No ${scope} to rank in that window.`, events:[], mapEvents:[], scope };
    const lead = top[0];
    return {
      reply: `The ${top.length} highest-severity ${p.cats.length?CAT_LABEL[p.cats[0]]+" ":""}events right now, led by ${lead.title.split(";")[0]} — ${lead.tier.toUpperCase()} · sev ${lead.sev.toFixed(1)} in ${ISO_NAME[lead.iso]||lead.iso}.`,
      events: top, mapEvents: top, scope: scope + (p.topN?"":" · top "+n),
    };
  }

  // ---- filter / show (default) ----
  if (!matched.length){
    // graceful miss — surface nearest activity
    const nearest = [...EVENTS].sort((a,b)=>b.sev-a.sev).slice(0,3);
    return {
      reply: `No events match ${scope}. Nothing on the board fits that exactly — the most active threads overall are ${nearest.map(e=>e.title.split(";")[0]).slice(0,2).join("; ")}.`,
      events: [], mapEvents: [], scope,
    };
  }
  const lead = matched[0];
  let reply = `${matched.length} ${scope}. `;
  if (matched.length === 1){
    reply += `${lead.title} — ${lead.tier.toUpperCase()} · sev ${lead.sev.toFixed(1)}, ${ISO_NAME[lead.iso]||lead.iso}, ${fmtAgo(lead.ts)} ago.`;
  } else {
    reply += `Most severe: ${lead.title.split(";")[0]} (${lead.tier.toUpperCase()} · ${lead.sev.toFixed(1)}, ${ISO_NAME[lead.iso]||lead.iso}). ${matched.length>1?`Also active in ${topRegions(matched,3).join(", ")}.`:""}`;
  }
  return { reply, events: matched.slice(0,8), mapEvents: matched, scope };
}

/* ============================================================
   4. UI — composer + thread + result cards
   ============================================================ */

const SUGGESTIONS = [
  "Brief me on the last hour",
  "Red-tier conflict events",
  "Cyber activity in Europe",
  "What's spiking right now?",
  "Top 5 by severity",
];

const SendIco = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>;
const SparkIco = <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z"/><circle cx="18.5" cy="17.5" r="1.6"/><circle cx="6" cy="18" r="1.2"/></svg>;

function ResultCard({ e, onOpen }){
  return (
    <button className="asst-card" onClick={()=>onOpen(e)}>
      <span className={`sev-pill sev-${e.tier}`}>{e.tier.toUpperCase()}·{e.sev.toFixed(1)}</span>
      <span className="asst-card-body">
        <span className="asst-card-title">{e.title}</span>
        <span className="asst-card-meta">{e.cat.toUpperCase()} · {ISO_NAME[e.iso]||e.iso} · {fmtAgo(e.ts)} ago · {e.src.split("·")[0]}</span>
      </span>
    </button>
  );
}

function AnomalyCards({ items, onPick }){
  const { Sparkline } = window.MAPR_SHELL;
  return (
    <div className="asst-info">
      {items.map((a,i)=>(
        <button key={i} className="asst-anom" onClick={()=>onPick && onPick(a)}>
          <Sparkline data={a.data} color={a.dir==="up"?"var(--sev-red)":"var(--sev-green)"} w={40} h={18}/>
          <span className="asst-anom-label">{a.label}</span>
          <span className={`asst-anom-delta ${a.dir==="down"?"neg":""}`}>{a.delta}</span>
        </button>
      ))}
    </div>
  );
}

function RegionCards({ items, onPick }){
  return (
    <div className="asst-info">
      {items.map(r=>(
        <button key={r.iso} className="asst-region" onClick={()=>onPick(r.iso)}>
          <span className="code">{r.iso}</span>
          <span className="name">{r.name}</span>
          <span className="avg" style={{color: r.avg>=6?"var(--sev-red)":r.avg>=4?"var(--sev-amber)":"var(--sev-green)"}}>{r.avg.toFixed(1)}</span>
          <span className="ct">{r.count} evt</span>
        </button>
      ))}
    </div>
  );
}

function MapAssistant({ events, defaultWindowMs, onResult, onOpenEvent, onGotoRegion }){
  const [messages, setMessages] = aUS([]);
  const [input, setInput] = aUS("");
  const [thinking, setThinking] = aUS(false);
  const threadRef = aUR(null);
  const taRef = aUR(null);

  aUE(()=>{ if(threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [messages, thinking]);

  const DATA = window.MAPR_DATA;

  const submit = (text)=>{
    const q = (text ?? input).trim();
    if (!q || thinking) return;
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    setMessages(m => [...m, { role:"user", text:q, id:Date.now()+"u" }]);
    setThinking(true);
    // brief synthetic latency so it reads as "thinking", then ground the answer
    setTimeout(()=>{
      const res = interpret(q, events, DATA, defaultWindowMs);
      setMessages(m => [...m, { role:"assistant", id:Date.now()+"a", ...res }]);
      setThinking(false);
      if (res.mapEvents !== undefined) onResult(res.mapEvents, res.scope);
    }, 420 + Math.random()*260);
  };

  const clearThread = ()=>{ setMessages([]); onResult(null, null); };

  const onKey = (e)=>{
    if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); submit(); }
  };
  const grow = (e)=>{
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(120, e.target.scrollHeight) + "px";
  };

  const hasThread = messages.length>0 || thinking;

  return (
    <div className="composer-wrap">
      {hasThread && (
        <div className="asst-thread-card">
          <div className="asst-thread-head">
            <span className="dot"/>ASSISTANT
            <span className="spacer"/>
            <span className="asst-ground">grounded · live feed</span>
            <button onClick={clearThread} title="Clear conversation">{window.MAPR_SHELL.Ico.close}</button>
          </div>
          <div className="asst-thread" ref={threadRef}>
            {messages.map(m => m.role === "user" ? (
              <div key={m.id} className="asst-user"><span>{m.text}</span></div>
            ) : (
              <div key={m.id} className="asst-reply">
                <div className="asst-reply-mark">{SparkIco}</div>
                <div className="asst-reply-body">
                  <p className="asst-reply-text">{m.reply}</p>
                  {m.scope && (m.events && m.events.length>0) && (
                    <div className="asst-scope-chip">◑ {m.scope}</div>
                  )}
                  {m.events && m.events.length>0 && (
                    <div className="asst-cards">
                      {m.events.map(e => <ResultCard key={e.id} e={e} onOpen={onOpenEvent}/>)}
                    </div>
                  )}
                  {m.info && m.info.kind==="anomaly" && <AnomalyCards items={m.info.items}/>}
                  {m.info && m.info.kind==="region" && <RegionCards items={m.info.items} onPick={onGotoRegion}/>}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="asst-reply">
                <div className="asst-reply-mark">{SparkIco}</div>
                <div className="asst-typing"><span/><span/><span/></div>
              </div>
            )}
          </div>
        </div>
      )}

      {!hasThread && (
        <div className="composer-suggest">
          {SUGGESTIONS.map(s => (
            <button key={s} className="suggest-chip" onClick={()=>submit(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="composer">
        <span className="composer-lead">{SparkIco}</span>
        <textarea
          ref={taRef}
          rows={1}
          value={input}
          onChange={grow}
          onKeyDown={onKey}
          placeholder="Ask Mapr about the live feed — e.g. “red-tier cyber in the last hour”"
        />
        <button className="composer-send" data-ready={input.trim().length>0} onClick={()=>submit()} title="Send (↵)">{SendIco}</button>
      </div>
      <div className="composer-foot">
        <span>{SparkIco}<b>MAPR ASSIST</b> · grounded on {events.length} live events</span>
        <span>↵ send · ⇧↵ newline</span>
      </div>
    </div>
  );
}

window.MAPR_ASSIST = { MapAssistant, interpret, ISO_NAME };
