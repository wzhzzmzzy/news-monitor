import type { DailyReportData, HistoricalReportData } from '../types/index.js'

export function renderDailyReport(data: DailyReportData): string {
  const { date, summary, topics, sourceNames = {} } = data

  const getSourceName = (id: string) => sourceNames[id] || id

  const topicsHtml = topics
    .map((topic) => {
      const newsTitlesHtml = topic.news.slice(0, 3).map(item => {
        const otherLinks = (item.otherPlatforms || [])
          .map(p => `<a href="${p.url}" style="color: #1a73e8; text-decoration: none; font-size: 11px; margin-left: 4px; background: #f1f3f4; padding: 1px 4px; border-radius: 2px;">${getSourceName(p.platform)}</a>`)
          .join('')
        
        return `
          <div style="margin-bottom: 8px; font-size: 14px; line-height: 1.4;">
            <a href="${item.url}" style="color: #1a73e8; text-decoration: none; font-weight: 500;">• ${item.title}</a>
            <span style="color: #9aa0a6; font-size: 12px; margin-left: 8px;">${getSourceName(item.source)}</span>
            ${otherLinks}
          </div>
        `
      }).join('')

      const newsLinks = topic.news
        .map((item, index) => {
          return `<a href="${item.url}" title="${item.title} | ${item.source}" style="display: inline-block; width: 24px; height: 24px; line-height: 24px; text-align: center; background-color: #e8f0fe; color: #1a73e8; text-decoration: none; border-radius: 4px; margin-right: 8px; margin-top: 4px; font-size: 13px; font-weight: bold;">${index + 1}</a>`
        })
        .join('')

      const longTermBadge = topic.isLongTerm 
        ? '<span style="background-color: #e8f0fe; color: #1a73e8; font-size: 12px; padding: 2px 8px; border-radius: 4px; margin-left: 10px; vertical-align: middle;">持续关注</span>' 
        : ''

      return `
        <div style="margin-bottom: 40px; border-bottom: 1px solid #eee; padding-bottom: 20px;">
          <h2 style="color: #202124; font-size: 18px; margin-bottom: 12px; display: flex; align-items: center;">
            ${topic.title} (热度: ${topic.score})${longTermBadge}
          </h2>
          <div style="color: #5f6368; line-height: 1.6; margin-bottom: 16px; font-size: 15px;">
            ${topic.analysis}
          </div>
          
          ${newsTitlesHtml ? `<div style="margin-bottom: 16px; padding-left: 4px; border-left: 2px solid #e8f0fe;">${newsTitlesHtml}</div>` : ''}

          <div style="margin-top: 12px; display: flex; align-items: flex-start; flex-wrap: wrap;">
            <span style="color: #9aa0a6; font-size: 13px; margin-right: 12px; margin-top: 6px;">全部来源:</span>
            <div style="display: flex; flex-wrap: wrap;">
              ${newsLinks}
            </div>
          </div>
        </div>
      `
    })
    .join('')

  const orphansHtml = data.orphans && data.orphans.length > 0 
    ? `
      <section style="margin-top: 40px; padding-top: 20px; border-top: 2px dashed #eee;">
        <h3 style="color: #5f6368; font-size: 16px; margin-bottom: 16px;">🔍 值得关注的其他新闻 (Orphan News)</h3>
        <ul style="list-style: none; padding: 0; margin: 0;">
          ${data.orphans.map(item => `
            <li style="margin-bottom: 10px; font-size: 14px;">
              <span style="display: inline-block; padding: 2px 6px; background: #f1f3f4; border-radius: 4px; font-size: 11px; color: #5f6368; margin-right: 8px;">
                Rank ${item.maxRank > 0 ? item.maxRank : '-'}
              </span>
              <a href="${item.url || '#'}" style="color: #1a73e8; text-decoration: none; font-weight: 500;">
                ${item.title}
              </a>
              <span style="color: #9aa0a6; font-size: 12px; margin-left: 6px;">
                (Sources: ${item.sourceCount})
              </span>
            </li>
          `).join('')}
        </ul>
      </section>
    ` 
    : ''

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #3c4043; background-color: #f8f9fa; margin: 0; padding: 20px;">
      <div style="max-width: 800px; margin: 0 auto; background-color: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <header style="margin-bottom: 40px; text-align: center;">
          <h1 style="color: #1a73e8; margin-bottom: 10px; font-size: 28px;">今日趋势报告</h1>
          <div style="color: #70757a; font-size: 14px;">${date}</div>
        </header>

        <section style="background-color: #f1f3f4; padding: 20px; border-radius: 8px; margin-bottom: 40px;">
          <h3 style="margin-top: 0; color: #202124; font-size: 16px;">执行摘要</h3>
          <div style="color: #3c4043; font-size: 15px;">${summary}</div>
        </section>

        <main>
          ${topicsHtml}
        </main>

        ${orphansHtml}

        <footer style="margin-top: 60px; text-align: center; color: #70757a; font-size: 12px; border-top: 1px solid #eee; padding-top: 20px;">
          多平台热点新闻趋势分析
        </footer>
      </div>
    </body>
    </html>
  `
}

export function renderHistoricalReport(data: HistoricalReportData): string {
  const { timeRange, summary, topics, sourceNames = {} } = data
  const getSourceName = (id: string) => sourceNames[id] || id

  const topicsHtml = topics.map(topic => {
    const timelineHtml = topic.timeline.map(entry => `
      <div style="display: flex; margin-bottom: 8px; font-size: 13px;">
        <div style="width: 80px; color: #9aa0a6; flex-shrink: 0;">${entry.date}</div>
        <div style="flex-grow: 1; padding-left: 12px; border-left: 2px solid #e8f0fe;">
          <span style="color: #202124;">${entry.event}</span>
          <span style="color: #1a73e8; font-size: 11px; margin-left: 6px;">热度: ${entry.heatScore}</span>
        </div>
      </div>
    `).join('')

    const newsHtml = topic.news.map(item => `
      <div style="margin-bottom: 6px; font-size: 13px;">
        <a href="${item.url}" style="color: #1a73e8; text-decoration: none;">• ${item.title}</a>
        <span style="color: #9aa0a6; font-size: 11px; margin-left: 6px;">(${getSourceName(item.source)})</span>
      </div>
    `).join('')

    return `
      <div style="margin-bottom: 40px; border-bottom: 1px solid #eee; padding-bottom: 20px;">
        <h2 style="color: #202124; font-size: 18px; margin-bottom: 8px;">${topic.title} (热度: ${topic.score})</h2>
        
        <div style="background: #f8f9fa; border-radius: 4px; padding: 12px; margin-bottom: 16px;">
          <div style="font-weight: bold; color: #5f6368; font-size: 12px; text-transform: uppercase; margin-bottom: 4px;">趋势演变</div>
          <div style="color: #202124; font-size: 14px; line-height: 1.5;">${topic.evolution}</div>
        </div>

        <div style="margin-bottom: 20px;">
          <div style="font-weight: bold; color: #5f6368; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">时间轴回溯</div>
          ${timelineHtml}
        </div>

        <div>
          <div style="font-weight: bold; color: #5f6368; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">代表性报道</div>
          ${newsHtml}
        </div>
      </div>
    `
  }).join('')

  const modeName = timeRange.mode === 'historical' ? '历史趋势报告' : '今日新闻总结'

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #3c4043; background-color: #f8f9fa; margin: 0; padding: 20px;">
      <div style="max-width: 800px; margin: 0 auto; background-color: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <header style="margin-bottom: 40px; text-align: center;">
          <h1 style="color: #1a73e8; margin-bottom: 10px; font-size: 28px;">${modeName}</h1>
          <div style="color: #70757a; font-size: 14px;">${timeRange.start} 至 ${timeRange.end}</div>
        </header>

        <section style="background-color: #e8f0fe; padding: 20px; border-radius: 8px; margin-bottom: 40px;">
          <h3 style="margin-top: 0; color: #1a73e8; font-size: 16px;">宏观演变摘要</h3>
          <div style="color: #202124; font-size: 15px;">${summary}</div>
        </section>

        <main>
          ${topicsHtml}
        </main>

        <footer style="margin-top: 60px; text-align: center; color: #70757a; font-size: 12px; border-top: 1px solid #eee; padding-top: 20px;">
          历史趋势演变分析
        </footer>
      </div>
    </body>
    </html>
  `
}
