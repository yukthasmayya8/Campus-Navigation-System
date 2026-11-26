const config = require('../config');

async function sendMail({ to, subject, text }) {
  if (!config.smtpUrl) {
    if (config.isProd) throw new Error('SMTP_URL must be configured to send email in production');
    console.log(`[mail:dev] To: ${to}\nSubject: ${subject}\n${text}\n`); // no SMTP configured: log instead of sending
    return;
  }
  const nodemailer = require('nodemailer');
  await nodemailer.createTransport(config.smtpUrl).sendMail({ from: config.mailFrom, to, subject, text });
}
module.exports = { sendMail };
