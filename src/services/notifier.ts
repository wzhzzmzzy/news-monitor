import nodemailer from 'nodemailer'
import type { Config } from '../types/index.js'
import logger from '../utils/logger.js'

export const SMTP_CONFIGS: Record<string, { server: string; port: number }> = {
  'gmail.com': { server: 'smtp.gmail.com', port: 587 },
  'qq.com': { server: 'smtp.qq.com', port: 465 },
  'foxmail.com': { server: 'smtp.qq.com', port: 465 },
  'outlook.com': { server: 'smtp-mail.outlook.com', port: 587 },
  'hotmail.com': { server: 'smtp-mail.outlook.com', port: 587 },
  'live.com': { server: 'smtp-mail.outlook.com', port: 587 },
  '163.com': { server: 'smtp.163.com', port: 465 },
  '126.com': { server: 'smtp.126.com', port: 465 },
  'sina.com': { server: 'smtp.sina.com', port: 465 },
  'sohu.com': { server: 'smtp.sohu.com', port: 465 },
  '189.cn': { server: 'smtp.189.cn', port: 465 },
  'aliyun.com': { server: 'smtp.aliyun.com', port: 465 },
}

export class NotifierService {
  private transporter: nodemailer.Transporter
  private config: Config

  constructor(config: Config) {
    this.config = config

    const domain = config.emailFrom.split('@').pop()?.toLowerCase() || ''
    const defaultSmtp = SMTP_CONFIGS[domain]

    const host = config.smtpHost || defaultSmtp?.server || `smtp.${domain}`
    const port = config.smtpPort || defaultSmtp?.port || 587

    logger.debug(`Using SMTP server: ${host}:${port} for ${domain}`)

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user: config.smtpUser || config.emailFrom,
        pass: config.smtpPass,
      },
    })
  }

  async sendReport(subject: string, content: string, recipientIndex?: number): Promise<void> {
    let recipients = this.config.emailTo
    if (recipientIndex !== undefined && recipientIndex >= 0 && recipientIndex < this.config.emailTo.length) {
      recipients = [this.config.emailTo[recipientIndex]]
    }

    logger.info(`Sending email report: ${subject} to ${recipients.join(', ')}`)

    const isHtml = content.trim().startsWith('<!DOCTYPE html>') || content.trim().startsWith('<html')

    const info = await this.transporter.sendMail({
      from: `"${this.config.emailFromName}" <${this.config.emailFrom}>`,
      to: recipients.join(', '),
      subject: subject,
      text: isHtml ? 'Please view this email in an HTML-compatible client.' : content,
      html: isHtml ? content : this.convertToHtml(content),
    })

    logger.success(`Email sent successfully: ${info.messageId}`)
  }

  private convertToHtml(markdown: string): string {
    // Better markdown-ish to HTML conversion for email
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.8; color: #2c3e50; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #ffffff;">
        ${markdown
          .replace(/^# (.*$)/gim, '<h1 style="color: #2c3e50; font-size: 28px; border-bottom: 2px solid #eee; padding-bottom: 10px; margin-top: 30px;">$1</h1>')
          .replace(/^## (.*$)/gim, '<h2 style="color: #1a73e8; font-size: 22px; border-left: 4px solid #1a73e8; padding-left: 12px; margin-top: 25px; margin-bottom: 15px;">$1</h2>')
          .replace(/^### (.*$)/gim, '<h3 style="color: #34495e; font-size: 18px; margin-top: 20px;">$1</h3>')
          .replace(/^\> (.*$)/gim, '<blockquote style="background: #f8f9fa; border-left: 4px solid #e9ecef; padding: 15px 20px; color: #6c757d; font-style: italic; margin: 20px 0;">$1</blockquote>')
          .replace(/\*\*(.*)\*\*/gim, '<strong style="color: #2c3e50;">$1</strong>')
          .replace(/\*(.*)\*/gim, '<em>$1</em>')
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #1a73e8; text-decoration: none; border-bottom: 1px solid #1a73e8; padding-bottom: 1px;">$1</a>')
          .replace(/^- (.*$)/gim, '<li style="margin-bottom: 8px;">$1</li>')
          .replace(/\n/g, '<br>')}
      </div>
    `
  }
}
