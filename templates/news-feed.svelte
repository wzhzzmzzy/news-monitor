<script>
  // news-feed-shell-v1 — only public report data is read; no publishing credentials.
  import { onMount } from 'svelte';
  import { readMarkdown, callAction } from '@koala/page-runtime';

  let report = null;
  let latest = null;
  let day = '';
  let choices = [];
  let tab = 'picks';
  let query = '';
  let category = '全部主题';
  let limit = 40;
  let loading = true;
  let error = '';
  let sequence = 0;
  let requestedEdition = '';
  const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  const validEdition = (value) => /^(morning|evening|custom-\d{6})$/.test(value);
  function updateAddress(date = '', edition = '') {
    const url = new URL(window.location.href);
    url.searchParams.delete('date'); url.searchParams.delete('edition');
    if (date) url.searchParams.set('date', date);
    if (edition) url.searchParams.set('edition', edition);
    if (url.href !== window.location.href) window.history.pushState(null, '', url);
  }
  function chooseReport(choice) {
    requestedEdition = choice.path.split('/').pop();
    updateAddress(choice.data.date, requestedEdition); adopt(choice.data);
  }
  function chooseDay() {
    updateAddress(day, requestedEdition); void loadRoute();
  }
  function goLatest() { updateAddress(); void loadRoute(); }
  async function loadRoute() {
    const params = new URLSearchParams(window.location.search);
    const date = params.get('date'); const edition = params.get('edition');
    if (params.getAll('date').length > 1 || params.getAll('edition').length > 1 || (date !== null && !validDay(date)) || (edition !== null && (!date || !validEdition(edition)))) {
      ++sequence; loading = false; report = null; choices = []; day = ''; requestedEdition = ''; latest = null;
      error = '链接参数无效：date 使用 YYYY-MM-DD，edition 使用 morning 或 evening，并同时指定 date。'; return;
    }
    if (date) await loadDay(date, edition || '');
    else { requestedEdition = ''; await loadLatest(); }
  }
  const tabs = [{id:'picks', label:'精选'}, {id:'blogs', label:'博客'}, {id:'timeline', label:'时间线'}];
  const inTab = (item, id) => id === 'timeline' ? item.tier !== 'blogs' : item.tier === id;
  const rowId = (id) => `timeline-item-${encodeURIComponent(id)}`;
  function jumpTo(id) {
    const target = document.getElementById(id);
    if (!target) return;
    const day = target.closest('details');
    if (day) day.open = true;
    target.focus({preventScroll:true});
    target.scrollIntoView({block:'start', behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }
  const timestamp = (item) => typeof item.publishedAt === 'string' && Number.isFinite(Date.parse(item.publishedAt)) ? Date.parse(item.publishedAt) : null;
  function timelineGroups(entries) {
    const groups = new Map();
    const sorted = [...entries].sort((a,b) => (timestamp(b) ?? -Infinity) - (timestamp(a) ?? -Infinity) || a.id.localeCompare(b.id));
    for (const item of sorted) {
      const stamp = timestamp(item);
      const local = stamp === null ? '' : new Date(stamp + 8 * 3600000).toISOString();
      const date = local.slice(0,10) || 'unknown';
      if (!groups.has(date)) groups.set(date, {date, label: stamp === null ? '时间未知' : new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric'}).format(new Date(stamp)), weekday: stamp === null ? '' : new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'long'}).format(new Date(stamp)), hours:[], items:[]});
      const hour = local.slice(11,13);
      if (hour && !groups.get(date).hours.some(h => h.hour === hour)) groups.get(date).hours.push({hour, target:rowId(item.id)});
      groups.get(date).items.push({...item, clock: local.slice(11,16) || '—', dateTime: stamp === null ? undefined : new Date(stamp).toISOString()});
    }
    return [...groups.values()];
  }
  const editions = {morning:'早报', evening:'晚报', custom:'时段报告'};
  const kinds = {new:'新增', update:'进展', correction:'更正', watch:'观察'};
  const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10);
  const safe = (url) => { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
  function parse(content) {
    const match = content.match(/(?:^|\n)```json\r?\n([\s\S]*?)\r?\n```(?:\r?\n|$)/);
    if (!match) throw new Error('报告数据格式不正确');
    return JSON.parse(match[1]);
  }
  function check(data) {
    if (data?.version !== 'news-feed-reader-v1' || !Array.isArray(data.items) || !Array.isArray(data.sections) || typeof data.title !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Number.isFinite(Date.parse(data.cutoff))) throw new Error('报告数据格式不正确');
    if (data.items.some(i => !i || typeof i.id !== 'string' || typeof i.title !== 'string' || typeof i.source !== 'string' || typeof i.url !== 'string' || typeof i.category !== 'string' || !(i.summary === null || typeof i.summary === 'string') || !['picks','reading','other','blogs'].includes(i.tier))) throw new Error('新闻条目格式不正确');
    if (new Set(data.items.map(i => i.id)).size !== data.items.length || data.sections.some(s => typeof s.body !== 'string' || !Array.isArray(s.sources))) throw new Error('报告内容不完整');
    return data;
  }
  function adopt(data) { report = data; query = ''; category = '全部主题'; limit = 40; }
  async function reportsFor(date) {
    const files = await callAction('/_actions/db.markdown.byPrefix', {prefix:`/data/news-feed/${date}`, scope:'public'});
    if (!Array.isArray(files)) throw new Error('无法读取报告列表');
    return files.filter(f => f.renderer === 'markdown' && f.private === false && f.deletedAt == null && f.path.startsWith(`/data/news-feed/${date}/`)).map(f => ({path:f.path, data:check(parse(f.content))})).filter(f => f.data.date === date).sort((a,b) => Date.parse(b.data.cutoff) - Date.parse(a.data.cutoff));
  }
  async function loadLatest() {
    const run = ++sequence; loading = true; error = ''; report = null; choices = [];
    try {
      const file = await readMarkdown({prefix:'/data/news-feed', path:'/data/news-feed/latest', scope:'public'});
      const index = parse(file.content);
      if (index.version !== 'news-feed-latest-v1' || !/^\/data\/news-feed\/\d{4}-\d{2}-\d{2}\/(morning|evening|custom-\d{6})$/.test(index.path)) throw new Error('最新报告索引无效');
      const list = await reportsFor(index.date);
      const found = list.find(f => f.path === index.path && f.data.cutoff === index.cutoff);
      if (!found) throw new Error('最新一期尚未就绪，请稍后刷新');
      if (run !== sequence) return;
      latest = index; day = index.date; choices = list; adopt(found.data);
    } catch (e) { if (run === sequence) error = e.message || '读取失败，请重试'; }
    finally { if (run === sequence) loading = false; }
  }
  async function loadDay(date, edition = '') {
    const run = ++sequence; loading = true; error = ''; report = null; choices = []; latest = null;
    day = date; requestedEdition = edition;
    try {
      const list = await reportsFor(date);
      if (run !== sequence) return;
      choices = list;
      const found = edition ? list.find(f => f.path === `/data/news-feed/${date}/${edition}`) : list[0];
      if (found) adopt(found.data);
    } catch (e) { if (run === sequence) error = e.message || '读取失败，请重试'; }
    finally { if (run === sequence) loading = false; }
  }
  function selectTab(id) { tab = id; limit = 40; }
  $: items = report?.items || [];
  $: topics = ['全部主题', ...new Set(items.filter(i => inTab(i, tab)).map(i => i.category))];
  $: filtered = items.filter(i => inTab(i, tab) && (category === '全部主题' || i.category === category) && `${i.title} ${i.summary || ''} ${i.source}`.toLowerCase().includes(query.trim().toLowerCase()));
  $: timeline = timelineGroups(filtered);
  onMount(() => {
    if (window.origin === 'null') return;
    const navigate = () => { void loadRoute(); };
    window.addEventListener('popstate', navigate); navigate();
    return () => { ++sequence; window.removeEventListener('popstate', navigate); };
  });
</script>

<div class="reader">
  <div class="toolbar">
    <label class="date">日期 <input type="date" bind:value={day} onchange={chooseDay} aria-label="报告日期" /></label>
    <div class="editions" aria-label="选择报告">
      {#each choices as choice}
        <button class:chosen={report === choice.data} onclick={() => chooseReport(choice)} disabled={loading}>{editions[choice.data.edition] || '报告'}</button>
      {/each}
    </div>
    <button class="refresh" onclick={goLatest} disabled={loading}>{loading ? '读取中…' : '最新一期 ↗'}</button>
  </div>
  {#if error}<p class="error" role="alert">{error} <button onclick={loadRoute}>重试</button></p>{/if}
  {#if report}
    <header>
      <div class="dateline">{report.date.replaceAll('-', ' / ')} <span>北京时间 · {editions[report.edition]}</span></div>
      <h1>{report.title}</h1>
      {#if report.date !== today() && latest?.date === report.date}<p class="recent">今日尚无新报告，当前为最近一期。</p>{/if}
    </header>
    <section class="overview" aria-label="新闻综述">
      {#if report.summary.trim()}<p>{report.summary}</p>{/if}
      {#each report.sections as section}
        <article>
          {#if section.kind !== 'overview'}<h2><span>{kinds[section.kind] || ''}</span> {section.title}</h2>{/if}
          <p>{section.body}</p>
          <div class="citations">{#each section.sources as citation}<a href={safe(citation.url) || undefined} target="_blank" rel="noopener noreferrer" title={citation.title}>{citation.before ? '早前 · ' : ''}{citation.source} ↗</a>{/each}</div>
        </article>
      {/each}
    </section>
    <nav class="tabs" aria-label="阅读分类">
      {#each tabs as option}
        <button aria-pressed={tab === option.id} class:active={tab === option.id} onclick={() => { selectTab(option.id); category = '全部主题'; }}>{option.label}<span>{items.filter(i => inTab(i, option.id)).length}</span></button>
      {/each}
    </nav>
    <div class="filters">
      <input type="search" bind:value={query} oninput={() => limit = 40} placeholder="搜索标题、摘要、来源" aria-label="搜索新闻" />
      <select bind:value={category} onchange={() => limit = 40} aria-label="主题">{#each topics as topic}<option>{topic}</option>{/each}</select>
    </div>
    <section class="stories" aria-label={tabs.find(t => t.id === tab)?.label}>
      {#if tab === 'timeline'}
        <p class="timeline-note">发布时间 · 北京时间</p>
        <div class="timeline-layout">
          {#if timeline.length}
          <aside class="timeline-index">
            <nav aria-label="时间快速定位">
              <p class="index-label">快速定位</p>
              {#each timeline as group (group.date)}
                <div class="index-day">
                  <button class="index-date" onclick={() => jumpTo(`timeline-date-${group.date}`)}>{group.date === 'unknown' ? '时间未知' : group.date.slice(5).replace('-', ' / ')}</button>
                  <div class="index-hours">
                    {#each group.hours as entry (entry.hour)}
                      <button title={`${group.label} ${entry.hour}:00–${entry.hour}:59`} onclick={() => jumpTo(entry.target)}>{entry.hour}:00</button>
                    {/each}
                  </div>
                </div>
              {/each}
            </nav>
          </aside>
          {/if}
        <div class="timeline">
          {#each timeline as group (group.date)}
            <details class="timeline-day" open>
              <summary id={`timeline-date-${group.date}`} class="timeline-day-heading"><span>{group.label}</span><small>{group.weekday}{group.weekday ? ' · ' : ''}{group.items.length} 条</small></summary>
              <ol class="timeline-list">
                {#each group.items as item (item.id)}
                  <li id={rowId(item.id)} tabindex="-1" class="timeline-row">
                    <time class="timeline-clock" datetime={item.dateTime}>{item.clock}</time>
                    <article class="timeline-card">
                      <div class="timeline-meta"><span>{item.source}</span><span class="timeline-topic">{item.category}</span>{#if item.tier === 'picks'}<span class="timeline-picked">精选</span>{/if}</div>
                      <h3><a href={safe(item.url) || undefined} target="_blank" rel="noopener noreferrer">{item.title}</a></h3>
                      <p>{item.summary || '中文摘要待处理。'}</p>
                    </article>
                  </li>
                {/each}
              </ol>
            </details>
          {/each}
        </div>
        </div>
      {:else}
      {#each filtered.slice(0,limit) as item (item.id)}
        {#if tab === 'picks'}
          <article class="pick">
            <div class="meta"><span>{item.category}</span> {item.source}</div>
            <h2><a href={safe(item.url) || undefined} target="_blank" rel="noopener noreferrer">{item.title}</a></h2>
            <p>{item.summary || '中文摘要待处理。'}</p>
          </article>
        {:else}
          <details>
            <summary><span class="story-title">{item.title}</span><span class="source">{item.source}</span></summary>
            <div class="detail"><p>{item.summary || '中文摘要待处理。'}</p><a href={safe(item.url) || undefined} target="_blank" rel="noopener noreferrer">阅读原文 ↗</a></div>
          </details>
        {/if}
      {/each}
      {/if}
      {#if !filtered.length}<p class="empty">{query || category !== '全部主题' ? '没有匹配的内容。' : tab === 'blogs' ? '本期没有博客内容。' : '本分类暂无内容。'}</p>{/if}
      {#if tab !== 'timeline' && filtered.length > limit}<button class="more" onclick={() => limit += 40}>继续显示 · 还有 {filtered.length - limit} 条</button>{/if}
    </section>
  {:else if !loading && !error}<p class="empty">{day || '当前'}{requestedEdition ? ` ${editions[requestedEdition] || '时段报告'}` : ''} 暂无报告。<button onclick={goLatest}>查看最近一期</button></p>
  {:else if loading}<p class="empty" role="status">正在读取报告…</p>{/if}
</div>

<style>
  .reader{--ink:#253630;--muted:#768078;--line:#dde3de;--accent:#2d6851;color:var(--ink);font-family:system-ui,-apple-system,'PingFang SC',sans-serif;font-size:15px;line-height:1.75;width:100%;margin:0 auto;padding:8px 0 44px}
  button,input,select{font:inherit;color:inherit}button{cursor:pointer;border:0;background:transparent}button:disabled{opacity:.5;cursor:wait}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
  .toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:12px;border-bottom:1px solid var(--line);padding-bottom:16px;font-size:12px}.date{display:flex;align-items:center;gap:8px;color:var(--muted)}input[type=date]{width:138px;background:transparent;border:0;color:var(--ink)}.editions{display:flex;gap:3px}.editions button{padding:3px 9px;border-radius:4px}.chosen{background:#eaf1ec;color:var(--accent)}.refresh{margin-left:auto;color:var(--accent)}
  header{padding:28px 0 16px}.dateline{letter-spacing:.12em;font-size:11px;color:var(--muted);display:flex;justify-content:space-between;gap:10px}.dateline span{letter-spacing:0}h1{font-family:'Songti SC','Noto Serif CJK SC',serif;font-size:clamp(25px,4vw,35px);line-height:1.4;letter-spacing:.02em;margin:12px 0 0;font-weight:700}.recent{font-size:12px;color:var(--muted);margin:10px 0 0}.overview{padding-bottom:26px}.overview article+article{margin-top:20px}.overview p{margin:0;white-space:pre-wrap;line-height:1.95}.overview h2{font-size:16px;margin:12px 0}.overview h2 span{font-size:11px;color:var(--accent);margin-right:5px}.citations{display:flex;flex-wrap:wrap;gap:4px 15px;font-size:11px;color:var(--muted);margin-top:7px}
  .tabs{display:flex;overflow:auto;border-top:1px solid var(--line);border-bottom:1px solid var(--line);gap:22px}.tabs button{padding:14px 0 12px;white-space:nowrap;border-bottom:2px solid transparent;font-size:14px;color:var(--muted)}.tabs .active{color:var(--accent);border-color:var(--accent);font-weight:600}.tabs span{font-size:10px;margin-left:7px;font-weight:400}.filters{display:flex;gap:12px;padding:16px 0}.filters input{min-width:0;flex:1;border:0;border-bottom:1px solid var(--line);background:transparent;padding:7px 0;font-size:12px;border-radius:0}.filters select{max-width:120px;border:0;background:transparent;font-size:12px}.pick{padding:20px 0 24px;border-bottom:1px solid var(--line)}.pick h2{font-size:19px;line-height:1.65;margin:7px 0 10px;font-weight:600}.pick p,.detail p{margin:0;white-space:pre-wrap}.meta{font-size:11px;color:var(--muted)}.meta span{color:var(--accent);margin-right:10px}
  details{border-bottom:1px solid var(--line)}summary{cursor:pointer;padding:16px 0;font-size:14px;line-height:1.7}summary::marker{color:var(--accent);font-size:10px}.story-title{font-weight:500}.source{display:block;font-size:11px;color:var(--muted);margin-left:15px;margin-top:3px}.detail{padding:0 0 18px 15px;font-size:14px}.detail a{display:inline-block;margin-top:10px;font-size:12px;color:var(--accent)}.empty{padding:32px 0;color:var(--muted);text-align:center;font-size:13px}.empty button,.error button{color:var(--accent);text-decoration:underline}.more{display:block;margin:24px auto 0;border:1px solid var(--line);padding:8px 20px;border-radius:5px;font-size:12px}.error{padding:12px;border:1px solid #e7cfc4;color:#8a4d35;background:#fff7f2;font-size:13px}
  @media(max-width:520px){.reader{font-size:14px}.toolbar{gap:8px}.tabs{gap:18px}.tabs button{font-size:13px}.dateline{flex-direction:column;gap:2px}.pick h2{font-size:17px}.overview{padding-bottom:20px}}
  @media(prefers-color-scheme:dark){.reader{--ink:#dbe5dd;--muted:#a1ada4;--line:#3a4840;--accent:#91c6a8}.chosen{background:#2d4337}.error{background:#372b24;color:#e4bca3;border-color:#655043}}

  .timeline-note{font-size:11px;color:var(--muted);margin:4px 0 18px}.reader .timeline .timeline-day{border:0!important;border-radius:0;padding:0;margin:0 0 28px;box-shadow:none;background:transparent}.timeline-day-heading{scroll-margin-top:24px;display:flex;align-items:baseline;gap:14px;list-style:none;padding:6px 0 16px;font-size:16px;font-weight:600}.timeline-day-heading::-webkit-details-marker{display:none}.timeline-day-heading>span::after{content:'⌄';font-size:12px;color:var(--muted);margin-left:8px}.timeline-day:not([open]) .timeline-day-heading>span::after{content:'›'}.timeline-day-heading small{font-size:11px;font-weight:400;color:var(--muted)}.timeline-list{list-style:none;padding:0;margin:0}.timeline-row{scroll-margin-top:24px;position:relative;display:grid;grid-template-columns:50px minmax(0,1fr);gap:26px;padding-bottom:18px}.timeline-row::before{content:'';position:absolute;left:62px;top:0;bottom:0;width:1px;background:var(--line)}.timeline-row::after{content:'';position:absolute;left:59px;top:26px;width:7px;height:7px;border-radius:50%;background:var(--accent)}.timeline-row:last-child{padding-bottom:0}.timeline-row:last-child::before{bottom:calc(100% - 30px)}.timeline-clock{padding-top:20px;text-align:right;font:600 11px/20px ui-monospace,monospace;font-variant-numeric:tabular-nums;color:var(--muted)}.timeline-card{border:1px solid var(--line);border-radius:9px;background:var(--timeline-card,#ffffffb8);padding:18px 21px}.timeline-meta{display:flex;flex-wrap:wrap;gap:5px 10px;align-items:center;font-size:11px;color:var(--muted)}.timeline-topic{margin-left:auto;color:var(--accent)}.timeline-picked{font-size:10px;color:var(--accent);background:var(--line);padding:0 5px;border-radius:3px}.timeline-card h3{font-size:16px;line-height:1.7;margin:10px 0 8px;font-weight:600}.timeline-card p{font-size:13px;line-height:1.9;white-space:pre-wrap;margin:0;color:var(--muted);overflow-wrap:anywhere}.timeline-card h3 a{color:var(--ink);text-decoration:none}.timeline-card h3 a:hover{text-decoration:underline}
  @media(max-width:520px){.timeline-row{grid-template-columns:36px minmax(0,1fr);gap:18px}.timeline-row::before{left:44px}.timeline-row::after{left:41px}.timeline-clock{font-size:10px}.timeline-card{padding:14px}.timeline-card h3{font-size:15px}.timeline-day-heading{font-size:14px;gap:10px}.timeline-meta{gap:4px 7px}.timeline-topic{margin-left:0}}
  @media(prefers-color-scheme:dark){.reader{--timeline-card:#23352b}}

  .timeline-layout{display:grid;grid-template-columns:minmax(0,1fr) 80px;gap:24px;align-items:start}.timeline{grid-column:1;grid-row:1;min-width:0}.timeline-index{grid-column:2;grid-row:1;align-self:stretch}.timeline-index nav{position:sticky;top:24px;max-height:calc(100vh - 48px);overflow-y:auto;scrollbar-width:thin;padding:0 4px 12px}.index-label{font-size:11px;color:var(--muted);margin:5px 0 16px}.index-day{margin-bottom:17px}.timeline-index button{display:block;text-align:left;padding:4px 0;font:12px/1.7 ui-monospace,monospace;color:var(--muted);white-space:nowrap}.timeline-index .index-date{font-weight:600;color:var(--ink);margin-bottom:3px}.index-hours{padding-left:10px;border-left:1px solid var(--line)}.timeline-index button:hover,.timeline-index button:focus-visible{color:var(--accent);text-decoration:underline}
  @media(min-width:1200px){.timeline-layout{display:block;position:relative}.timeline-index{position:absolute;left:calc(100% + 28px);top:0;bottom:0;width:100px}}
  @media(max-width:600px){.timeline-layout{display:flex;flex-direction:column;gap:16px}.timeline-index{width:100%}.timeline-index nav{position:static;max-height:none;display:flex;gap:20px;overflow:auto;padding-bottom:8px}.index-label{display:none}.index-day{margin:0;flex-shrink:0}.index-hours{display:flex;gap:12px;padding-left:0;border:0}.timeline{width:100%}.timeline-index button{font-size:11px}}
</style>
