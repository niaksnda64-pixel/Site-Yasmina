const db = require('../db');

function getTransporter() {
  const nodemailer = require('nodemailer');
  const user = db.prepare("SELECT value FROM dev_config WHERE key='gmail_user'").get();
  const pass = db.prepare("SELECT value FROM dev_config WHERE key='gmail_app_password'").get();

  if (!user?.value || !pass?.value) {
    throw new Error('Gmail non configuré. Rendez-vous dans le panel dev.');
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: user.value, pass: pass.value },
  });
}

function getFromName() {
  const name = db.prepare("SELECT value FROM site_config WHERE key='site_name'").get();
  const user = db.prepare("SELECT value FROM dev_config WHERE key='gmail_user'").get();
  return { name: name?.value || 'MAISON', email: user?.value || '' };
}

// ─── CONFIRMATION COMMANDE ───────────────────────────────────
async function sendOrderConfirmation(order) {
  const from = getFromName();
  const transporter = getTransporter();

  const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
  const itemsHTML = items.map(i =>
    `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0ede8;">${i.name}${i.size ? ` <span style="color:#888;font-size:12px;">(${i.size})</span>` : ''}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f0ede8;text-align:right;">€ ${parseFloat(i.price).toFixed(2)}</td>
    </tr>`
  ).join('');

  const isRetrait = order.delivery_type === 'retrait';
  const deliveryInfo = isRetrait
    ? `<p style="margin:0;"><strong>Mode :</strong> Retrait en boutique<br>
       Un QR code est inclus dans cet email. Présentez-le en boutique pour récupérer votre commande.</p>`
    : `<p style="margin:0;"><strong>Livraison à :</strong> ${order.delivery_address}</p>`;

  const qrSection = isRetrait && order.qr_code
    ? `<div style="text-align:center;margin:32px 0;padding:24px;background:#f8f6f2;border-radius:4px;">
        <p style="margin:0 0 16px;font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#888;">Votre QR Code de retrait</p>
        <img src="${order.qr_code}" alt="QR Code" style="width:200px;height:200px;">
        <p style="margin:16px 0 0;font-size:12px;color:#aaa;">Commande N° ${order.order_number}</p>
      </div>`
    : '';

  const html = `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#f8f6f2;font-family:'Helvetica Neue',Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:white;">
      
      <!-- Header -->
      <div style="background:#0a0a0a;padding:40px;text-align:center;">
        <h1 style="margin:0;color:white;font-family:Georgia,serif;font-weight:300;font-size:32px;letter-spacing:8px;">${from.name}</h1>
      </div>

      <!-- Body -->
      <div style="padding:48px 40px;">
        <h2 style="font-family:Georgia,serif;font-weight:300;font-size:26px;color:#0a0a0a;margin:0 0 8px;">Merci pour votre commande</h2>
        <p style="color:#888;font-size:13px;letter-spacing:2px;text-transform:uppercase;margin:0 0 32px;">Commande confirmée · N° ${order.order_number}</p>

        <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 32px;">
          Bonjour <strong>${order.customer_name}</strong>,<br>
          Votre paiement a bien été reçu. Voici le récapitulatif de votre commande.
        </p>

        <!-- Items -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead>
            <tr>
              <th style="text-align:left;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#c9a96e;padding-bottom:12px;border-bottom:2px solid #f0ede8;">Article</th>
              <th style="text-align:right;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#c9a96e;padding-bottom:12px;border-bottom:2px solid #f0ede8;">Prix</th>
            </tr>
          </thead>
          <tbody>${itemsHTML}</tbody>
          <tfoot>
            ${order.shipping > 0 ? `<tr><td style="padding:10px 0;color:#888;font-size:13px;">Livraison</td><td style="padding:10px 0;text-align:right;color:#888;font-size:13px;">€ ${parseFloat(order.shipping).toFixed(2)}</td></tr>` : '<tr><td style="padding:10px 0;color:#2ecc71;font-size:13px;">Livraison</td><td style="padding:10px 0;text-align:right;color:#2ecc71;font-size:13px;">Offerte</td></tr>'}
            <tr>
              <td style="padding:16px 0 0;font-weight:600;font-size:16px;">Total payé</td>
              <td style="padding:16px 0 0;text-align:right;font-weight:600;font-size:16px;">€ ${parseFloat(order.total).toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        <!-- Livraison -->
        <div style="background:#f8f6f2;padding:20px;margin-bottom:24px;border-left:3px solid #c9a96e;">
          ${deliveryInfo}
        </div>

        ${qrSection}

        <!-- Note -->
        ${order.notes ? `<div style="background:#fffdf9;border:1px solid #f0ede8;padding:16px;margin-bottom:24px;font-size:13px;color:#555;">${order.notes}</div>` : ''}

        <p style="font-size:13px;color:#888;line-height:1.7;">
          Pour toute question, répondez à cet email ou contactez notre service client.<br>
          Nous restons à votre disposition.
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#f8f6f2;padding:24px 40px;text-align:center;border-top:1px solid #e8e4dc;">
        <p style="margin:0;font-size:11px;color:#aaa;letter-spacing:2px;text-transform:uppercase;">${from.name} · Tous droits réservés</p>
      </div>
    </div>
  </body>
  </html>`;

  await transporter.sendMail({
    from: `"${from.name}" <${from.email}>`,
    to: order.customer_email,
    subject: `Confirmation de commande · ${order.order_number}`,
    html,
  });

  // Log
  db.prepare("INSERT INTO email_log (to_email, subject, status) VALUES (?, ?, 'sent')").run(
    order.customer_email,
    `Confirmation de commande · ${order.order_number}`
  );
}

// ─── EMAIL CUSTOM (admin) ────────────────────────────────────
async function sendCustomEmail(to, subject, message, sent_by) {
  const from = getFromName();
  const transporter = getTransporter();

  const html = `
  <!DOCTYPE html>
  <html><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#f8f6f2;font-family:'Helvetica Neue',Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;background:white;">
      <div style="background:#0a0a0a;padding:32px 40px;text-align:center;">
        <h1 style="margin:0;color:white;font-family:Georgia,serif;font-weight:300;font-size:28px;letter-spacing:8px;">${from.name}</h1>
      </div>
      <div style="padding:40px;">
        <div style="font-size:15px;color:#333;line-height:1.8;">${message.replace(/\n/g, '<br>')}</div>
      </div>
      <div style="background:#f8f6f2;padding:20px 40px;text-align:center;border-top:1px solid #e8e4dc;">
        <p style="margin:0;font-size:11px;color:#aaa;letter-spacing:2px;text-transform:uppercase;">${from.name} · Tous droits réservés</p>
      </div>
    </div>
  </body></html>`;

  await transporter.sendMail({
    from: `"${from.name}" <${from.email}>`,
    to,
    subject,
    html,
  });

  db.prepare("INSERT INTO email_log (to_email, subject, status, sent_by) VALUES (?, ?, 'sent', ?)").run(
    to, subject, sent_by || null
  );
}

module.exports = { sendOrderConfirmation, sendCustomEmail };
