import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotifierService } from './notifier.js'
import nodemailer from 'nodemailer'

const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' })
const mockCreateTransport = vi.fn().mockReturnValue({
  sendMail: mockSendMail,
})

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (...args: any[]) => mockCreateTransport(...args),
  },
}))

describe('NotifierService', () => {
  const mockConfig: any = {
    smtpHost: 'smtp.test.com',
    smtpPort: 587,
    smtpUser: 'user',
    smtpPass: 'pass',
    emailFrom: 'from@test.com',
    emailTo: ['to@test.com'],
  }
  let notifier: NotifierService

  beforeEach(() => {
    vi.clearAllMocks()
    notifier = new NotifierService(mockConfig)
  })

  it('should send an email report', async () => {
    await notifier.sendReport('Daily Report', '# Hello World')
    
    expect(mockCreateTransport).toHaveBeenCalled()
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'from@test.com',
      to: 'to@test.com',
      subject: 'Daily Report',
    }))
  })

  it('should infer SMTP configuration from email domain', () => {
    const config: any = {
      smtpPass: 'pass',
      emailFrom: 'test@gmail.com',
      emailTo: ['to@test.com'],
    }
    new NotifierService(config)

    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: 'test@gmail.com',
        pass: 'pass',
      },
    }))
  })

  it('should infer SMTP configuration for QQ mail', () => {
    const config: any = {
      smtpPass: 'pass',
      emailFrom: 'test@qq.com',
      emailTo: ['to@test.com'],
    }
    new NotifierService(config)

    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.qq.com',
      port: 465,
      secure: true,
      auth: {
        user: 'test@qq.com',
        pass: 'pass',
      },
    }))
  })
})
