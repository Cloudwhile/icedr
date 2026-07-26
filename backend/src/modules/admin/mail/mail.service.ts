import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { MailSettings } from '../settings/settings.dto';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly config: ConfigService,
  ) {}

  async sendTestMessage(recipientEmail: string) {
    const settings = await this.settingsService.getMailSettings();
    const siteName = await this.resolveSiteName();
    const safeSiteName = this.escapeHtml(siteName);
    await this.sendWithSettings(settings, {
      to: recipientEmail,
      subject: `${siteName} SMTP test`,
      text: `${siteName} mail delivery is configured and ready.`,
      html: `<p>${safeSiteName} mail delivery is configured and ready.</p>`,
    });
    return this.settingsService.markMailVerified();
  }

  async assertReady(settings?: MailSettings) {
    const resolvedSettings =
      settings ?? (await this.settingsService.getMailSettings());
    if (
      !this.settingsService.mailConfigured(resolvedSettings) ||
      !resolvedSettings.verifiedAt
    ) {
      throw new BadRequestException(
        'SMTP must be configured and verified before setup can be completed',
      );
    }
  }

  async sendShareAccessCode(input: {
    email: string;
    code: string;
    expiresAt: string;
    shareTitle: string;
  }) {
    const siteName = await this.resolveSiteName();
    const safeSiteName = this.escapeHtml(siteName);
    await this.sendMail({
      to: input.email,
      subject: `Your ${siteName} access code for ${input.shareTitle}`,
      text: [
        `Your ${siteName} access code is ${input.code}.`,
        `It expires at ${input.expiresAt}.`,
      ].join('\n'),
      html: [
        `<p>Your ${safeSiteName} access code is:</p>`,
        `<p style="font-size:24px;font-weight:700;letter-spacing:4px">${this.escapeHtml(input.code)}</p>`,
        `<p>It expires at ${this.escapeHtml(input.expiresAt)}.</p>`,
      ].join(''),
    });
  }

  async sendPasswordReset(input: {
    email: string;
    code: string;
    expiresAt: string;
    expiresInMinutes: number;
    locale: 'en' | 'zh';
  }) {
    const siteName = await this.resolveSiteName();
    const content = this.buildPasswordResetMessage({
      ...input,
      siteName,
      footer: this.buildMailFooter(siteName, input.locale),
    });

    await this.sendMail({
      to: input.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }

  async sendSecurityNotification(input: {
    email: string;
    event: 'login' | 'passkey-added' | 'passkey-removed';
    locale: 'en' | 'zh';
    occurredAt: string;
    deviceName: string;
    ipAddress: string;
  }) {
    const siteName = await this.resolveSiteName();
    const content = this.buildSecurityNotificationMessage({
      ...input,
      siteName,
    });
    await this.sendMail({
      to: input.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }

  async sendMail(message: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) {
    const settings = await this.settingsService.getMailSettings();
    await this.sendWithSettings(settings, message);
  }

  private async sendWithSettings(
    settings: MailSettings,
    message: {
      to: string;
      subject: string;
      text: string;
      html?: string;
    },
  ) {
    if (!this.settingsService.mailConfigured(settings)) {
      throw new ServiceUnavailableException('Mail delivery is not configured');
    }

    try {
      const transporter = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        auth: {
          user: settings.username,
          pass: settings.password,
        },
      });
      await transporter.sendMail({
        to: message.to,
        from: {
          name: settings.fromName,
          address: settings.fromEmail,
        },
        replyTo: settings.replyTo || undefined,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      this.logger.warn(
        `Mail delivery failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new ServiceUnavailableException(
        'Mail delivery failed. Check SMTP settings and try again.',
      );
    }
  }

  private async resolveSiteName() {
    const site = await this.settingsService.getPublicSiteSettings();
    return site.siteName.trim() || 'ICEDR';
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  private buildPasswordResetMessage(input: {
    siteName: string;
    code: string;
    expiresAt: string;
    expiresInMinutes: number;
    footer: MailFooterContent;
    locale: 'en' | 'zh';
  }) {
    const siteName = this.escapeHtml(input.siteName);
    const code = this.escapeHtml(input.code);
    const expiresIn = this.escapeHtml(
      input.locale === 'zh'
        ? `${input.expiresInMinutes} 分钟`
        : `${input.expiresInMinutes} minutes`,
    );

    if (input.locale === 'zh') {
      return {
        subject: `${input.siteName} 密码重置请求`,
        text: [
          `你的 ${input.siteName} 密码重置验证码是 ${input.code}。`,
          `该验证码 ${input.expiresInMinutes} 分钟内有效。`,
          '注意事项：',
          '请勿将验证码告诉任何人。',
          '验证码只能使用一次；重新发送后，旧验证码会失效。',
          '如果不是你本人操作，请忽略这封邮件。',
          input.footer.systemNoticeText,
          input.footer.copyrightText,
          `${input.footer.termsLabel}: ${input.footer.termsUrl}`,
          `${input.footer.privacyLabel}: ${input.footer.privacyUrl}`,
        ].join('\n'),
        html: this.wrapPasswordResetHtml({
          siteName,
          eyebrow: '密码重置',
          title: '验证码',
          intro: `使用下面的验证码为 ${siteName} 设置新密码。`,
          code,
          expiresLabel: '有效期',
          expiresValue: expiresIn,
          notesTitle: '注意事项',
          notes: [
            '请勿将验证码告诉任何人。',
            '验证码只能使用一次；重新发送后，旧验证码会失效。',
            '如果不是你本人操作，请忽略这封邮件。',
          ],
          footer: input.footer,
        }),
      };
    }

    return {
      subject: `${input.siteName} password reset request`,
      text: [
        `Your ${input.siteName} password reset code is ${input.code}.`,
        `This code is valid for ${input.expiresInMinutes} minutes.`,
        'Security notes:',
        'Do not share this code with anyone.',
        'This code can be used only once; requesting a new code invalidates the old one.',
        'If you did not request this, you can ignore this email.',
        input.footer.systemNoticeText,
        input.footer.copyrightText,
        `${input.footer.termsLabel}: ${input.footer.termsUrl}`,
        `${input.footer.privacyLabel}: ${input.footer.privacyUrl}`,
      ].join('\n'),
      html: this.wrapPasswordResetHtml({
        siteName,
        eyebrow: 'Password reset',
        title: 'Verification code',
        intro: `Use the code below to set a new password for ${siteName}.`,
        code,
        expiresLabel: 'Valid for',
        expiresValue: expiresIn,
        notesTitle: 'Security notes',
        notes: [
          'Do not share this code with anyone.',
          'This code can be used only once; requesting a new code invalidates the old one.',
          'If you did not request this, you can ignore this email.',
        ],
        footer: input.footer,
      }),
    };
  }

  private buildSecurityNotificationMessage(input: {
    siteName: string;
    event: 'login' | 'passkey-added' | 'passkey-removed';
    locale: 'en' | 'zh';
    occurredAt: string;
    deviceName: string;
    ipAddress: string;
  }) {
    const zhTitles = {
      login: '账号刚刚完成登录',
      'passkey-added': '账号添加了新的 Passkey',
      'passkey-removed': '账号移除了 Passkey',
    } as const;
    const enTitles = {
      login: 'A sign-in just completed',
      'passkey-added': 'A new Passkey was added',
      'passkey-removed': 'A Passkey was removed',
    } as const;
    const title =
      input.locale === 'zh' ? zhTitles[input.event] : enTitles[input.event];
    const labels =
      input.locale === 'zh'
        ? {
            device: '设备',
            ip: 'IP 地址',
            time: '时间',
            note: '如果这不是你的操作，请立即检查账号安全设置并撤销未知认证方式。',
          }
        : {
            device: 'Device',
            ip: 'IP address',
            time: 'Time',
            note: 'If this was not you, review account security and remove unknown authentication methods immediately.',
          };
    const rows = [
      `${labels.device}: ${input.deviceName}`,
      `${labels.ip}: ${input.ipAddress}`,
      `${labels.time}: ${input.occurredAt}`,
    ];
    return {
      subject: `${input.siteName}: ${title}`,
      text: [title, ...rows, labels.note].join('\n'),
      html: [
        `<h1 style="font-size:20px;line-height:1.4">${this.escapeHtml(title)}</h1>`,
        `<p>${this.escapeHtml(rows[0])}</p>`,
        `<p>${this.escapeHtml(rows[1])}</p>`,
        `<p>${this.escapeHtml(rows[2])}</p>`,
        `<p>${this.escapeHtml(labels.note)}</p>`,
      ].join(''),
    };
  }

  private wrapPasswordResetHtml(input: {
    siteName: string;
    eyebrow: string;
    title: string;
    intro: string;
    code: string;
    expiresLabel: string;
    expiresValue: string;
    notesTitle: string;
    notes: string[];
    footer: MailFooterContent;
  }) {
    const notes = input.notes
      .map(
        (note) =>
          `<li style="margin:0 0 6px;color:#5f6368;font-size:13px;line-height:1.6;">${this.escapeHtml(note)}</li>`,
      )
      .join('');

    return `
      <div style="margin:0;padding:0;background:#f5f6f6;color:#111217;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f5f6f6;">
          <tr>
            <td align="center" style="padding:28px 16px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:540px;border-collapse:collapse;background:#ffffff;border:1px solid #dadce0;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:16px 24px 14px;background:#ffffff;border-bottom:1px solid #eceff3;">
                    <div style="font-size:15px;line-height:1.35;color:#202124;font-weight:600;">${input.siteName}</div>
                    <div style="margin-top:4px;font-size:12px;line-height:1.4;color:#6b7280;">${input.eyebrow}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px;">
                    <h1 style="margin:0 0 12px;font-size:21px;line-height:1.35;font-weight:600;color:#202124;">${input.title}</h1>
                    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3c4043;">${input.intro}</p>
                    <div style="margin:0 0 18px;padding:18px 16px;border:1px solid #dfe3ea;border-radius:8px;background:#f8fafc;text-align:center;">
                      <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:30px;line-height:1.2;font-weight:700;letter-spacing:5px;color:#202124;">${input.code}</div>
                    </div>
                    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 0 18px;">
                      <tr>
                        <td style="font-size:13px;line-height:1.5;color:#5f6368;">${input.expiresLabel}</td>
                        <td align="right" style="font-size:13px;line-height:1.5;color:#202124;font-weight:600;">${input.expiresValue}</td>
                      </tr>
                    </table>
                    <div style="margin:0;padding-top:16px;border-top:1px solid #eceff3;">
                      <div style="margin:0 0 8px;color:#202124;font-size:13px;line-height:1.5;font-weight:600;">${input.notesTitle}</div>
                      <ul style="margin:0;padding-left:18px;">${notes}</ul>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 24px 22px;background:#f8fafc;border-top:1px solid #eceff3;color:#6b7280;font-size:12px;line-height:1.6;">
                    <p style="margin:0 0 8px;">${input.footer.systemNotice}</p>
                    <p style="margin:0 0 10px;">${input.footer.copyright}</p>
                    <p style="margin:0;">
                      <a href="${input.footer.termsUrl}" style="color:#5e6ad2;text-decoration:none;">${input.footer.termsLabel}</a>
                      <span style="color:#c4c8d0;"> · </span>
                      <a href="${input.footer.privacyUrl}" style="color:#5e6ad2;text-decoration:none;">${input.footer.privacyLabel}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `;
  }

  private buildMailFooter(
    siteName: string,
    locale: 'en' | 'zh',
  ): MailFooterContent {
    const baseUrl = this.mailWebBaseUrl();
    const year = new Date().getUTCFullYear();
    const safeSiteName = this.escapeHtml(siteName);
    const termsUrl = this.escapeHtml(`${baseUrl}/terms`);
    const privacyUrl = this.escapeHtml(`${baseUrl}/privacy`);

    if (locale === 'zh') {
      return {
        systemNotice: `这是一封来自 ${safeSiteName} 的系统邮件，请不要直接回复。`,
        systemNoticeText: `这是一封来自 ${siteName} 的系统邮件，请不要直接回复。`,
        copyright: `Copyright &copy; ${year} ${safeSiteName}. All rights reserved.`,
        copyrightText: `Copyright (c) ${year} ${siteName}. All rights reserved.`,
        termsLabel: '用户协议',
        termsUrl,
        privacyLabel: '隐私政策',
        privacyUrl,
      };
    }

    return {
      systemNotice: `This is an automated system email from ${safeSiteName}. Replies are not monitored.`,
      systemNoticeText: `This is an automated system email from ${siteName}. Replies are not monitored.`,
      copyright: `Copyright &copy; ${year} ${safeSiteName}. All rights reserved.`,
      copyrightText: `Copyright (c) ${year} ${siteName}. All rights reserved.`,
      termsLabel: 'User Agreement',
      termsUrl,
      privacyLabel: 'Privacy Policy',
      privacyUrl,
    };
  }

  private mailWebBaseUrl() {
    const origin =
      this.config.get<string>('api.corsOrigin') ?? 'http://localhost:13000';
    return origin.trim().replace(/\/$/, '') || 'http://localhost:13000';
  }
}

type MailFooterContent = {
  systemNotice: string;
  systemNoticeText: string;
  copyright: string;
  copyrightText: string;
  termsLabel: string;
  termsUrl: string;
  privacyLabel: string;
  privacyUrl: string;
};
