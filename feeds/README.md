# HN 热门博客订阅清单

排名来源：[HN Popularity Contest](https://popularity.refactoringenglish.com/?start=2016-09-15&end=2026-09-15)。窗口固定为 **2016-09-15 至 2026-09-15**，按 Total Score 降序取前 100 条，于 2026-09-22 从页面表格读取。十年用于选博客，不是承诺抓取十年全部文章。排名来源的[数据仓库](https://github.com/mtlynch/hn-popularity-contest-data)使用 CC0。

**100 条排名记录中，85 条对应已解析的 Feed，合并 Scott Aaronson 的两个域名后订阅 84 个不同 Feed；15 条暂不启用。** 可解析只证明当前读取成功，不证明全文完整、持续更新或永久可用。未启用的原因保存在 JSON 和来源状态中；连接失败不等于博客停更。

Paul Graham 官网链接的 Aaron Swartz Feed 可解析，但缺少[当前文章列表](https://paulgraham.com/articles.html)的后续文章，保留 manualHold 并停用，避免静默漏更。部分作者原站已迁移或多年未更新，保留其公开 Feed，并以条目时间展示。Substack 和付费站点只采集公开 RSS 所提供的内容。

`hn-popular-blogs.json` 是运行时清单；修改后重启 serve，或下一次独立 collect 时生效。默认与普通新闻共用归档和中文缓存，博客全部进入独立 Tab，不作为 Agent 新闻候选。

订阅探测脚本只更新 Feed 状态，不重抓排名：

```bash
node scripts/discover-blog-feeds.mjs feeds/hn-popular-blogs.json --unresolved
# Node 网络不通时，可用系统 curl 交叉核对：
node scripts/discover-blog-feeds.mjs feeds/hn-popular-blogs.json --unresolved --curl
```

脚本解析 HTML 的订阅链接，并尝试有限个常见路径；只有 XML 通过 RSS/Atom 解析才启用。manualHold 必须人工核验后删除才可启用。原始 HTML/XML 保存在 Git 忽略的 `archive/blog-discovery/`，运行归档也不提交。探测失败会停用该源，成功结果也仍需核对是否订阅了正确栏目。

| 排名 | 博客 | RSS/Atom | 状态 |
| --- | --- | --- | --- |
| 1 | [krebsonsecurity.com](https://krebsonsecurity.com/) | [Feed](https://krebsonsecurity.com/feed/) | 可用 |
| 2 | [simonwillison.net](https://simonwillison.net/) | [Feed](https://simonwillison.net/atom/everything/) | 可用 |
| 3 | [paulgraham.com](https://paulgraham.com/) | [Feed](http://www.aaronsw.com/2002/feeds/pgessays.rss) | 待修复 |
| 4 | [jeffgeerling.com](https://jeffgeerling.com/) | [Feed](https://www.jeffgeerling.com/blog.xml) | 可用 |
| 5 | [stratechery.com](https://stratechery.com/) | [Feed](https://stratechery.com/feed/) | 可用 |
| 6 | [jvns.ca](https://jvns.ca/) | [Feed](https://jvns.ca/atom.xml) | 可用 |
| 7 | [shkspr.mobi](https://shkspr.mobi/) | [Feed](https://shkspr.mobi/blog/feed/atom/) | 可用 |
| 8 | [danluu.com](https://danluu.com/) | [Feed](https://danluu.com/atom.xml) | 可用 |
| 9 | [righto.com](https://righto.com/) | [Feed](https://www.righto.com/feeds/posts/default) | 可用 |
| 10 | [rachelbythebay.com](https://rachelbythebay.com/) | 未验证 | 待修复 |
| 11 | [troyhunt.com](https://troyhunt.com/) | [Feed](https://www.troyhunt.com/rss/) | 可用 |
| 12 | [utcc.utoronto.ca/~cks](https://utcc.utoronto.ca/~cks/) | [Feed](https://utcc.utoronto.ca/~cks/space/blog/?atom) | 可用 |
| 13 | [ciechanow.ski](https://ciechanow.ski/) | [Feed](https://ciechanow.ski/atom.xml) | 可用 |
| 14 | [daringfireball.net](https://daringfireball.net/) | [Feed](https://daringfireball.net/feeds/main) | 可用 |
| 15 | [drewdevault.com](https://drewdevault.com/) | [Feed](https://drewdevault.com/blog/index.xml) | 可用 |
| 16 | [fabiensanglard.net](https://fabiensanglard.net/) | [Feed](https://fabiensanglard.net/rss.xml) | 可用 |
| 17 | [devblogs.microsoft.com/oldnewthing](https://devblogs.microsoft.com/oldnewthing/) | [Feed](https://devblogs.microsoft.com/oldnewthing/feed) | 可用 |
| 18 | [pluralistic.net](https://pluralistic.net/) | [Feed](https://pluralistic.net/feed/) | 可用 |
| 19 | [tbray.org](https://tbray.org/) | [Feed](https://www.tbray.org/ongoing/ongoing.atom) | 可用 |
| 20 | [daniel.haxx.se](https://daniel.haxx.se/) | [Feed](https://daniel.haxx.se/blog/feed/) | 可用 |
| 21 | [antirez.com](https://antirez.com/) | [Feed](https://antirez.com/rss) | 可用 |
| 22 | [dynomight.net](https://dynomight.net/) | [Feed](https://dynomight.net/feed.xml) | 可用 |
| 23 | [tonsky.me](https://tonsky.me/) | [Feed](https://tonsky.me/atom.xml) | 可用 |
| 24 | [gwern.net](https://gwern.net/) | 未验证 | 待修复 |
| 25 | [neal.fun](https://neal.fun/) | 未验证 | 待修复 |
| 26 | [lemire.me](https://lemire.me/) | [Feed](https://lemire.me/blog/feed/) | 可用 |
| 27 | [xeiaso.net](https://xeiaso.net/) | [Feed](https://xeiaso.net/blog.rss) | 可用 |
| 28 | [pragmaticengineer.com](https://pragmaticengineer.com/) | [Feed](https://blog.pragmaticengineer.com/rss/) | 可用 |
| 29 | [seangoedecke.com](https://seangoedecke.com/) | [Feed](https://www.seangoedecke.com/rss.xml) | 可用 |
| 30 | [martinfowler.com](https://martinfowler.com/) | [Feed](https://martinfowler.com/feed.atom) | 可用 |
| 31 | [filfre.net](https://filfre.net/) | [Feed](https://www.filfre.net/feed/) | 可用 |
| 32 | [nullprogram.com](https://nullprogram.com/) | [Feed](https://nullprogram.com/feed/) | 可用 |
| 33 | [mtlynch.io](https://mtlynch.io/) | [Feed](https://mtlynch.io/posts/index.xml) | 可用 |
| 34 | [kalzumeus.com](https://kalzumeus.com/) | [Feed](https://www.kalzumeus.com/feed/articles/) | 可用 |
| 35 | [blog.acolyer.org](https://blog.acolyer.org/) | [Feed](https://blog.acolyer.org/feed/) | 可用 |
| 36 | [blog.plover.com](https://blog.plover.com/) | 未验证 | 待修复 |
| 37 | [schneier.com](https://schneier.com/) | [Feed](https://www.schneier.com/feed/) | 可用 |
| 38 | [blog.samaltman.com](https://blog.samaltman.com/) | [Feed](https://blog.samaltman.com/posts.atom) | 可用 |
| 39 | [johndcook.com](https://johndcook.com/) | [Feed](https://www.johndcook.com/blog/feed/) | 可用 |
| 40 | [acoup.blog](https://acoup.blog/) | [Feed](https://acoup.blog/feed/) | 可用 |
| 41 | [justine.lol](https://justine.lol/) | 未验证 | 待修复 |
| 42 | [gatesnotes.com](https://gatesnotes.com/) | 未验证 | 待修复 |
| 43 | [astralcodexten.com](https://astralcodexten.com/) | [Feed](https://www.astralcodexten.com/feed) | 可用 |
| 44 | [buttondown.com/hillelwayne](https://buttondown.com/hillelwayne/) | [Feed](https://buttondown.com/hillelwayne/rss) | 可用 |
| 45 | [slatestarcodex.com](https://slatestarcodex.com/) | [Feed](https://slatestarcodex.com/feed/) | 可用 |
| 46 | [brendangregg.com](https://brendangregg.com/) | [Feed](https://www.brendangregg.com/blog/rss.xml) | 可用 |
| 47 | [lcamtuf.substack.com](https://lcamtuf.substack.com/) | 未验证 | 待修复 |
| 48 | [marginalia.nu](https://marginalia.nu/) | [Feed](https://www.marginalia.nu/index.xml) | 可用 |
| 49 | [matklad.github.io](https://matklad.github.io/) | [Feed](https://matklad.github.io/feed.xml) | 可用 |
| 50 | [hillelwayne.com](https://hillelwayne.com/) | [Feed](https://www.hillelwayne.com/index.xml) | 可用 |
| 51 | [mitchellh.com](https://mitchellh.com/) | [Feed](https://mitchellh.com/feed.xml) | 可用 |
| 52 | [lapcatsoftware.com](https://lapcatsoftware.com/) | [Feed](https://lapcatsoftware.com/articles/atom.xml) | 可用 |
| 53 | [austinhenley.com](https://austinhenley.com/) | [Feed](https://austinhenley.com/blog/feed.rss) | 可用 |
| 54 | [lucumr.pocoo.org](https://lucumr.pocoo.org/) | [Feed](https://lucumr.pocoo.org/feed.atom) | 可用 |
| 55 | [blog.jim-nielsen.com](https://blog.jim-nielsen.com/) | [Feed](https://blog.jim-nielsen.com/feed.xml) | 可用 |
| 56 | [jacquesmattheij.com](https://jacquesmattheij.com/) | [Feed](https://jacquesmattheij.com/rss.xml) | 可用 |
| 57 | [writings.stephenwolfram.com](https://writings.stephenwolfram.com/) | [Feed](https://writings.stephenwolfram.com/feed/) | 可用 |
| 58 | [tedium.co](https://tedium.co/) | [Feed](https://feed.tedium.co/) | 可用 |
| 59 | [filippo.io](https://filippo.io/) | [Feed](https://words.filippo.io/rss/) | 可用 |
| 60 | [randomascii.wordpress.com](https://randomascii.wordpress.com/) | [Feed](https://randomascii.wordpress.com/feed/) | 可用 |
| 61 | [sive.rs](https://sive.rs/) | [Feed](https://sive.rs/feed.xml) | 可用 |
| 62 | [idiallo.com](https://idiallo.com/) | [Feed](https://idiallo.com/feed.rss) | 可用 |
| 63 | [joshwcomeau.com](https://joshwcomeau.com/) | [Feed](https://www.joshwcomeau.com/rss.xml) | 可用 |
| 64 | [idlewords.com](https://idlewords.com/) | [Feed](https://idlewords.com/index.xml) | 可用 |
| 65 | [blog.cryptographyengineering.com](https://blog.cryptographyengineering.com/) | 未验证 | 待修复 |
| 66 | [mjg59.dreamwidth.org](https://mjg59.dreamwidth.org/) | [Feed](https://mjg59.dreamwidth.org/data/rss) | 可用 |
| 67 | [apenwarr.ca](https://apenwarr.ca/) | [Feed](https://apenwarr.ca/log/rss.php) | 可用 |
| 68 | [overreacted.io](https://overreacted.io/) | [Feed](https://overreacted.io/atom.xml) | 可用 |
| 69 | [berthub.eu](https://berthub.eu/) | [Feed](https://berthub.eu/articles/index.xml) | 可用 |
| 70 | [brandur.org](https://brandur.org/) | [Feed](https://brandur.org/articles.atom) | 可用 |
| 71 | [fasterthanli.me](https://fasterthanli.me/) | [Feed](https://fasterthanli.me/index.xml) | 可用 |
| 72 | [steveblank.com](https://steveblank.com/) | [Feed](https://steveblank.com/feed/) | 可用 |
| 73 | [computer.rip](https://computer.rip/) | [Feed](https://computer.rip/rss.xml) | 可用 |
| 74 | [ctrl.blog](https://ctrl.blog/) | [Feed](https://www.ctrl.blog/rss/) | 可用 |
| 75 | [mattstoller.substack.com](https://mattstoller.substack.com/) | 未验证 | 待修复 |
| 76 | [construction-physics.com](https://construction-physics.com/) | 未验证 | 待修复 |
| 77 | [eli.thegreenplace.net](https://eli.thegreenplace.net/) | [Feed](https://eli.thegreenplace.net/feeds/all.atom.xml) | 可用 |
| 78 | [backreaction.blogspot.com](https://backreaction.blogspot.com/) | [Feed](https://backreaction.blogspot.com/feeds/posts/default) | 可用 |
| 79 | [thebignewsletter.com](https://thebignewsletter.com/) | 未验证 | 待修复 |
| 80 | [susam.net](https://susam.net/) | [Feed](https://susam.net/feed.xml) | 可用 |
| 81 | [blog.benjojo.co.uk](https://blog.benjojo.co.uk/) | [Feed](https://blog.benjojo.co.uk/rss.xml) | 可用 |
| 82 | [xkcd.com](https://xkcd.com/) | [Feed](https://xkcd.com/atom.xml) | 可用 |
| 83 | [scottaaronson.blog](https://scottaaronson.blog/) | [Feed](https://scottaaronson.blog/?feed=rss2) | 可用 |
| 84 | [jgc.org](https://jgc.org/) | [Feed](https://blog.jgc.org/feeds/posts/default) | 可用 |
| 85 | [jefftk.com](https://jefftk.com/) | [Feed](https://www.jefftk.com/news.rss) | 可用 |
| 86 | [robertheaton.com](https://robertheaton.com/) | [Feed](https://robertheaton.com/feed.xml) | 可用 |
| 87 | [stephendiehl.com](https://stephendiehl.com/) | 未验证 | 待修复 |
| 88 | [hanselman.com](https://hanselman.com/) | [Feed](http://feeds.hanselman.com/ScottHanselman) | 可用 |
| 89 | [garymarcus.substack.com](https://garymarcus.substack.com/) | 未验证 | 待修复 |
| 90 | [scottaaronson.com](https://scottaaronson.com/) | [Feed](https://scottaaronson.blog/?feed=rss2) | 别名 → scottaaronson.blog |
| 91 | [research.swtch.com](https://research.swtch.com/) | [Feed](https://research.swtch.com/feed.atom) | 可用 |
| 92 | [aphyr.com](https://aphyr.com/) | [Feed](https://aphyr.com/posts.atom) | 可用 |
| 93 | [jsomers.net](https://jsomers.net/) | [Feed](https://jsomers.net/blog/feed) | 可用 |
| 94 | [oldvcr.blogspot.com](https://oldvcr.blogspot.com/) | [Feed](https://oldvcr.blogspot.com/feeds/posts/default) | 可用 |
| 95 | [patrick-breyer.de](https://patrick-breyer.de/) | [Feed](https://www.patrick-breyer.de/feed/) | 可用 |
| 96 | [wheresyoured.at](https://wheresyoured.at/) | [Feed](https://www.wheresyoured.at/rss/) | 可用 |
| 97 | [practical.engineering](https://practical.engineering/) | [Feed](https://practical.engineering/blog?format=rss) | 可用 |
| 98 | [terrytao.wordpress.com](https://terrytao.wordpress.com/) | [Feed](https://terrytao.wordpress.com/feed/) | 可用 |
| 99 | [bellard.org](https://bellard.org/) | 未验证 | 待修复 |
| 100 | [ben-evans.com](https://ben-evans.com/) | [Feed](https://www.ben-evans.com/benedictevans?format=rss) | 可用 |
