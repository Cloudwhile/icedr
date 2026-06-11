import { ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

describe('MailService', () => {
  const settings = {
    enabled: true,
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    username: 'mailer',
    password: 'secret',
    fromName: 'Mail Sender',
    fromEmail: 'noreply@example.com',
    replyTo: '',
    verifiedAt: null,
  };

  function createService(configured = true) {
    const sendMail = jest.fn(() => Promise.resolve());
    jest.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail,
    } as never);
    const settingsService = {
      getMailSettings: jest.fn(() => Promise.resolve(settings)),
      mailConfigured: jest.fn(() => configured),
      markMailVerified: jest.fn(() =>
        Promise.resolve({
          enabled: settings.enabled,
          host: settings.host,
          port: settings.port,
          secure: settings.secure,
          username: settings.username,
          fromName: settings.fromName,
          fromEmail: settings.fromEmail,
          replyTo: settings.replyTo,
          configured: true,
          passwordConfigured: true,
          verifiedAt: new Date(0).toISOString(),
        }),
      ),
      getPublicSiteSettings: jest.fn(() =>
        Promise.resolve({
          siteName: 'Northstar',
          authLogoDataUrl: null,
        }),
      ),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'api.corsOrigin' ? 'https://drive.example.com' : undefined,
      ),
    };
    return {
      service: new MailService(settingsService as never, config as never),
      sendMail,
      settingsService,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends a test message and returns safe settings without a password', async () => {
    const { service, sendMail, settingsService } = createService();

    const response = await service.sendTestMessage('admin@example.com');

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@example.com',
        from: { name: 'Mail Sender', address: 'noreply@example.com' },
        subject: 'Northstar SMTP test',
        text: 'Northstar mail delivery is configured and ready.',
        html: '<p>Northstar mail delivery is configured and ready.</p>',
      }),
    );
    expect(settingsService.markMailVerified).toHaveBeenCalled();
    expect(response).not.toHaveProperty('password');
    expect(response.passwordConfigured).toBe(true);
  });

  it('rejects delivery when SMTP is not configured', async () => {
    const { service } = createService(false);

    await expect(
      service.sendShareAccessCode({
        email: 'reviewer@example.com',
        code: '123456',
        expiresAt: new Date(0).toISOString(),
        shareTitle: 'Roadmap',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sends a share access code with the configured site name', async () => {
    const { service, sendMail } = createService();

    await service.sendShareAccessCode({
      email: 'reviewer@example.com',
      code: '123456',
      expiresAt: new Date(0).toISOString(),
      shareTitle: 'Roadmap',
    });

    const message = sendMail.mock.calls[0][0];
    expect(message.subject).toBe('Your Northstar access code for Roadmap');
    expect(message.text).toContain('Your Northstar access code is 123456.');
    expect(message.html).toContain('Your Northstar access code is:');
    expect(message.html).toContain('123456');
  });

  it('sends an English password reset code email with branded HTML', async () => {
    const { service, sendMail } = createService();

    await service.sendPasswordReset({
      email: 'user@example.com',
      code: 'A1B2C3',
      expiresAt: '2026-05-26T12:00:00.000Z',
      expiresInMinutes: 15,
      locale: 'en',
    });

    const message = sendMail.mock.calls[0][0];
    expect(message.subject).toBe('Northstar password reset request');
    expect(message.text).toContain('A1B2C3');
    expect(message.text).toContain('valid for 15 minutes');
    expect(message.text).toContain('Do not share this code with anyone.');
    expect(message.html).toContain('Verification code');
    expect(message.html).toContain('A1B2C3');
    expect(message.html).toContain('15 minutes');
    expect(message.html).toContain('Security notes');
    expect(message.html).toContain('Copyright');
    expect(message.html).toContain('User Agreement');
    expect(message.html).toContain('https://drive.example.com/terms');
    expect(message.html).toContain('Privacy Policy');
    expect(message.html).not.toContain('2026-05-26T12:00:00.000Z');
  });

  it('sends a Chinese password reset code email and escapes HTML values', async () => {
    const { service, sendMail, settingsService } = createService();
    settingsService.getPublicSiteSettings.mockResolvedValue({
      siteName: 'Cloud <Portal>',
      authLogoDataUrl: null,
    });

    await service.sendPasswordReset({
      email: 'user@example.com',
      code: '<A&1>',
      expiresAt: '2026-05-26T12:00:00.000Z',
      expiresInMinutes: 15,
      locale: 'zh',
    });

    const message = sendMail.mock.calls[0][0];
    expect(message.subject).toBe('Cloud <Portal> 密码重置请求');
    expect(message.text).toContain('<A&1>');
    expect(message.text).toContain('15 分钟内有效');
    expect(message.text).toContain('请勿将验证码告诉任何人。');
    expect(message.html).toContain('Cloud &lt;Portal&gt;');
    expect(message.html).toContain('&lt;A&amp;1&gt;');
    expect(message.html).toContain('验证码');
    expect(message.html).toContain('15 分钟');
    expect(message.html).toContain('注意事项');
    expect(message.html).toContain('Copyright');
    expect(message.html).toContain('用户协议');
    expect(message.html).toContain('https://drive.example.com/terms');
    expect(message.html).toContain('隐私政策');
    expect(message.html).not.toContain('<A&1>');
    expect(message.html).not.toContain('2026-05-26T12:00:00.000Z');
  });
});
